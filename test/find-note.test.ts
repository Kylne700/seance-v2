// "Send the Seance a secret": the page side. The visitor's payment is found in the list of latest transactions by the commitment of its note.
// fetch is replaced in every test and no test asks for an id: a fetch for anything but the list fails the test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ledger from '../ledger.json'
import fixture from './fixtures/wallet-send.json'
import { INDEXER_URL, LIST_KEPT_MS, RECENT_LIMIT } from '../src/config.ts'
import { parseTransaction } from '../src/chain.ts'
import { bobAddress, createData, demoKeys, LookupError, ourIds } from '../src/data.ts'
import { listen } from '../src/decrypt.ts'
import { createNetlog } from '../src/netlog.ts'
import { GAP_MS, sendSecret, waitForNote, type Provider } from '../src/wallet.ts'

const COMMITMENT = 'a4e5b2d45401da7fcff14d2bf19028c5dfb1dd980ea0bbe96215dc16f88c8d43' // Bob's note in the fixture: 31415, "spike test"
const decoys = ledger.recent.transactions as unknown[]
const entry = fixture as unknown

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Error' })

/** A fake indexer that serves only the list. `list(n)` gives the nth answer (1 for the first); an id request fails the test. */
function listOnly(list: (n: number) => Response | Promise<Response>) {
  let n = 0
  const spy = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url)
    if (!u.includes('/transactions/recent')) throw new Error(`asked for something that is not the list: ${u}`)
    return list(++n)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}
const urls = (spy: ReturnType<typeof listOnly>): string[] => spy.mock.calls.map((c) => String(c[0]))
const withIt = (extra: unknown[] = []): Response => json({ transactions: [...extra, ...decoys] })
const without = (): Response => json({ transactions: decoys })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the fixture is what the spike saw', () => {
  it('has Bob\'s note under the commitment the wallet reports, and is not one of our own transactions', () => {
    const view = parseTransaction(fixture)
    expect(view.outputs.map((o) => o.commitment)).toContain(COMMITMENT)
    expect(ourIds.has(view.id)).toBe(false)
    expect(decoys.length).toBeGreaterThan(0)
    expect(bobAddress).toMatch(/^otl_esm_1/)
  })
})

describe('findNote', () => {
  it('finds the payment by the commitment of its note, in the list, and asks for no id', async () => {
    const spy = listOnly(() => withIt([entry]))
    const data = createData()
    const shown = await data.findNote(COMMITMENT)
    expect(shown).toMatchObject({ mode: 'live', fellBack: false, forgotten: false, quietChain: false, ours: false, preview: false })
    expect(shown?.view.id).toBe((fixture as { transaction_id: string }).transaction_id)
    expect(shown?.list).toEqual({ size: decoys.length + 1, found: true })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(urls(spy)[0]).toContain('/transactions/recent')
  })

  it('makes the same request as Summon', async () => {
    const spy = listOnly(() => withIt([entry]))
    const data = createData({ pick: () => 0 })
    await data.recent()
    await data.findNote(COMMITMENT, { fresh: true })
    const [summon, watch] = urls(spy)
    expect(watch).toBe(summon)
    expect(summon).toContain(`limit=${RECENT_LIMIT}`)
  })

  it('makes every look a real download: it asks with `cache: \'no-store\'`, which Summon\'s request does not', async () => {
    const spy = listOnly(() => withIt([entry]))
    const data = createData({ pick: () => 0 })
    await data.recent()
    await data.findNote(COMMITMENT, { fresh: true })
    expect(spy.mock.calls.map((c) => c[1]?.cache)).toEqual([undefined, 'no-store'])
  })

  it('reads the commitment in either case', async () => {
    listOnly(() => withIt([entry]))
    expect((await createData().findNote(COMMITMENT.toUpperCase()))?.view.id).toBe((fixture as { transaction_id: string }).transaction_id)
  })

  it('says null when the payment is not in the list, and shows nobody else\'s transaction', async () => {
    listOnly(without)
    expect(await createData().findNote(COMMITMENT)).toBeNull()
  })

  it('does not take a transaction whose notes only look alike', async () => {
    const other = JSON.parse(JSON.stringify(fixture).replaceAll(COMMITMENT, COMMITMENT.replace(/^a4e5/, 'a4e6'))) as { transaction_id: string }
    listOnly(() => withIt([other]))
    expect(await createData().findNote(COMMITMENT)).toBeNull()
  })

  it('skips an entry it cannot read instead of failing', async () => {
    listOnly(() => json({ transactions: [{ transaction_id: '12'.repeat(32) }, 'junk', null, entry] }))
    expect((await createData().findNote(COMMITMENT))?.view.id).toBe((fixture as { transaction_id: string }).transaction_id)
  })

  it('without `fresh` it shares the kept list, with `fresh` it asks again', async () => {
    let clock = 1_000
    const spy = listOnly(() => withIt([entry]))
    const data = createData({ now: () => clock })
    await data.findNote(COMMITMENT)
    clock += LIST_KEPT_MS - 1
    await data.findNote(COMMITMENT)
    expect(spy).toHaveBeenCalledTimes(1)
    await data.findNote(COMMITMENT, { fresh: true })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('leaves the page in live mode when the list cannot be had, and the next look works', async () => {
    const spy = listOnly((n) => (n === 1 ? json({}, 503) : withIt([entry])))
    const data = createData()
    await expect(data.findNote(COMMITMENT)).rejects.toBeDefined()
    expect(data.mode).toBe('live')
    expect((await data.findNote(COMMITMENT))?.view.id).toBe((fixture as { transaction_id: string }).transaction_id)
    expect(spy).toHaveBeenCalledTimes(2) // the failed copy was not kept
  })

  it('in recorded mode it asks nobody and says so', async () => {
    const spy = listOnly(() => withIt([entry]))
    const data = createData()
    data.setMode('recorded')
    const e = await data.findNote(COMMITMENT).then(() => null, (x: unknown) => x)
    expect(e).toBeInstanceOf(LookupError)
    expect((e as LookupError).kind).toBe('not-recorded')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('the whole send, with a mock wallet and a fake indexer', () => {
  const wallet: Provider = {
    async request({ method }) {
      if (method === 'tari_requestAccounts') return [{ address: 'otl_esm_1visitor' }]
      if (method === 'tari_getNetwork') return 'esmeralda'
      if (method === 'tari_getCapabilities') return { privateSpend: true }
      if (method === 'tari_createTransactionRequest') return { requestId: 'r1' }
      if (method === 'tari_getTransactionRequest') return { status: 'approved' }
      if (method === 'tari_submitTransactionRequest') return { transactionId: (fixture as { transaction_id: string }).transaction_id, recipientCommitment: COMMITMENT, minimumValuePromise: '0' }
      throw new Error(`unexpected ${method}`)
    },
  }

  it('sends, watches the list until the note is there, and Bob\'s key reads the amount and the words', async () => {
    const spy = listOnly((n) => (n < 3 ? without() : withIt([entry]))) // not there at the first two looks, there at the third
    const netlog = createNetlog({ siteHost: 'localhost:4173', indexerHost: new URL(INDEXER_URL).host })
    vi.stubGlobal('fetch', netlog.wrap(globalThis.fetch.bind(globalThis)))
    const data = createData()
    const sent = sendSecret(wallet, { recipient: bobAddress, memo: 'spike test' })
    await vi.advanceTimersByTimeAsync(1000)
    const commitment = await sent
    expect(commitment).toBe(COMMITMENT)
    const watching = waitForNote(() => data.findNote(commitment, { fresh: true }))
    await vi.advanceTimersByTimeAsync(3 * GAP_MS + 500)
    const watched = await watching
    expect(watched).toMatchObject({ checks: 3, failed: 0, stopped: null })
    expect(spy).toHaveBeenCalledTimes(3) // the kept copy of the list (60 s) was bypassed: 3 looks, 3 requests
    expect(spy.mock.calls.every((c) => c[1]?.cache === 'no-store')).toBe(true) // and the browser's own cache (30 s) too, so each look is a real download
    expect(urls(spy).every((u) => u.includes('/transactions/recent'))).toBe(true)
    // The ghost log lists each of them like Summon's request, and none names an id.
    expect(netlog.entries().map((e) => e.kind)).toEqual(['list', 'list', 'list'])
    expect(netlog.summary()).toMatchObject({ requests: 3, hosts: 1, named: 0, leaked: false })
    vi.useRealTimers() // the wasm that opens the note
    const shown = watched.found
    expect(shown?.view.id).toBe((fixture as { transaction_id: string }).transaction_id)
    const bob = await listen(demoKeys.bob.viewSecret, shown!.view.outputs)
    expect(bob).toHaveLength(1)
    expect(bob[0].plain.value).toBe(31415n)
    expect(bob[0].plain.memo).toBe('spike test')
    // Not his: the other demo keys hear nothing.
    expect(await listen(demoKeys.carol.viewSecret, shown!.view.outputs)).toEqual([])
    expect(await listen(demoKeys.eve.viewSecret, shown!.view.outputs)).toEqual([])
  })

  it('looks 9 times, 20 s after each look ended, then says so; "Look again" is one more look; no id is ever asked for', async () => {
    const spy = listOnly(async () => {
      await new Promise((r) => setTimeout(r, 800)) // a slow list
      return without()
    })
    const data = createData()
    const starts: number[] = []
    const ends: number[] = []
    const watching = waitForNote(async () => {
      starts.push(Date.now())
      try {
        return await data.findNote(COMMITMENT, { fresh: true })
      } finally {
        ends.push(Date.now())
      }
    })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const watched = await watching
    expect(watched).toEqual({ found: null, checks: 9, failed: 0, stopped: null })
    expect(spy).toHaveBeenCalledTimes(9)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - ends[i - 1]).toBeGreaterThanOrEqual(GAP_MS)
    const again = data.findNote(COMMITMENT, { fresh: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await again).toBeNull()
    expect(spy).toHaveBeenCalledTimes(10)
    expect(urls(spy).every((u) => u.includes('/transactions/recent'))).toBe(true)
  })

  it('stops watching when the page goes to recorded data, with no further request', async () => {
    const spy = listOnly(without)
    const data = createData()
    const watching = waitForNote(() => data.findNote(COMMITMENT, { fresh: true }), { stop: () => (data.mode === 'live' ? null : 'recorded data') })
    await vi.advanceTimersByTimeAsync(GAP_MS) // look 1
    expect(spy).toHaveBeenCalledTimes(1)
    data.setMode('recorded')
    await vi.advanceTimersByTimeAsync(GAP_MS)
    expect(await watching).toEqual({ found: null, checks: 1, failed: 0, stopped: 'recorded data' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('a list that cannot be had at some looks does not end the watch', async () => {
    const spy = listOnly((n) => (n < 3 ? json({}, 503) : withIt([entry])))
    const data = createData()
    const watching = waitForNote(() => data.findNote(COMMITMENT, { fresh: true }))
    await vi.advanceTimersByTimeAsync(4 * GAP_MS)
    const watched = await watching
    expect(watched).toMatchObject({ checks: 3, failed: 2, stopped: null })
    expect(watched.found?.view.id).toBe((fixture as { transaction_id: string }).transaction_id)
    expect(spy).toHaveBeenCalledTimes(3)
    expect(data.mode).toBe('live')
  })
})
