// Where answers come from: live indexer, recorded set, and the switch between them. fetch is replaced in every test, so no
// test here touches the network. A fetch that throws if it is called stands in for "the network is blocked".
import { afterEach, describe, expect, it, vi } from 'vitest'
import ledger from '../ledger.json'
import { INDEXER_URL, MAX_FILE_BYTES, RECENT_LIMIT } from '../src/config.ts'
import { createData, demos, LookupError, ourIds, savedOn, type Problem } from '../src/data.ts'
import { decryptOutput, listen } from '../src/decrypt.ts'
import { txFromHash, type TxView } from '../src/chain.ts'

interface Expected {
  outputs: { output: string; reader: string | null; value?: string; memo?: string | null }[]
}
const keys = ledger.keys as Record<string, { viewSecret: string }>
const txs = ledger.txs as unknown as { key: string; id: string; kind: string; reply: unknown; expected: Expected }[]
const bobTx = txs[0] // Bob, 0.666 tTARI, "The candle went out. Did you do that?"
const unknownId = 'ab'.repeat(32)

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Error' })
const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fn = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => impl(String(url)))
  vi.stubGlobal('fetch', fn)
  return fn
}
const blocked = () => stubFetch(() => Promise.reject(new TypeError('fetch failed')))
const never = () => stubFetch(() => new Promise<Response>(() => {}))

// A fake indexer: its list of latest transactions at /transactions/recent, and one answer per id at /transactions/<id>.
const idN = (n: number): string => n.toString(16).padStart(64, '0')
const LISTED = Array.from({ length: RECENT_LIMIT }, (_, i) => ({ transaction_id: idN(i + 1), created_at: '2026-10-29 17:21:00.0' }))
const indexer = (byId: (id: string) => Promise<Response> | Response, list: () => Promise<Response> | Response = () => json({ transactions: LISTED })) =>
  stubFetch((url) => (url.includes('/transactions/recent') ? list() : byId(url.slice(url.lastIndexOf('/') + 1))))
type Spy = ReturnType<typeof stubFetch>
const urls = (spy: Spy): string[] => spy.mock.calls.map((c) => String(c[0]))
const byIdUrls = (spy: Spy): string[] => urls(spy).filter((u) => !u.includes('/transactions/recent'))
const askedFor = (spy: Spy, id: string): number => byIdUrls(spy).filter((u) => u.endsWith(`/${id}`)).length

/** The view reads as the recording says: the expected reader gets the amount and the memo, and nobody else hears anything. */
async function expectsReading(view: TxView, tx: (typeof txs)[number]): Promise<void> {
  expect(view.id).toBe(tx.id)
  for (const e of tx.expected.outputs) {
    const [s, i] = e.output.split('.').map(Number)
    const output = view.statements[s].outputs[i]
    for (const [name, k] of Object.entries(keys)) {
      const plain = await decryptOutput(k.viewSecret, output)
      if (name === e.reader) {
        expect(plain?.value).toBe(BigInt(e.value!))
        expect(plain?.memo ?? null).toBe(e.memo ?? null)
      } else expect(plain).toBeNull()
    }
  }
}

async function fails(p: Promise<unknown>): Promise<Problem> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  )
  expect(e).toBeInstanceOf(LookupError)
  return (e as LookupError).kind
}

describe('recorded mode (the switch is on, or the network is blocked)', () => {
  it('answers every demo transaction without one request, and each one reads as recorded', async () => {
    const fetchSpy = blocked()
    const data = createData()
    data.setMode('recorded')
    for (const tx of txs) {
      const shown = await data.lookup(tx.id)
      expect(shown).toMatchObject({ mode: 'recorded', fellBack: false, quietChain: false })
      await expectsReading(shown.view, tx)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the demo list matches the ledger, in order: the audit-key demos first, then the TARI ones, numbered from 1', () => {
    expect(demos.map((d) => d.id)).toEqual([...(ledger.hero as { id: string }[]), ...txs].map((t) => t.id))
    expect(demos.map((d) => d.n)).toEqual(demos.map((_, i) => i + 1))
    expect(demos.filter((d) => d.kind === 'audited').length).toBe(ledger.hero.length)
  })

  it('knows the recent sample too, but says "not recorded" for any other id, with no request', async () => {
    const fetchSpy = blocked()
    const data = createData()
    data.setMode('recorded')
    const sampleId = ledger.recent.transactions[0].transaction_id
    expect((await data.lookup(sampleId)).view.id).toBe(sampleId)
    expect(await fails(data.lookup(unknownId))).toBe('not-recorded')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('summon works from the recorded sample, with no request', async () => {
    const fetchSpy = blocked()
    const data = createData({ pick: () => 0 })
    data.setMode('recorded')
    const shown = await data.recent()
    expect(shown.mode).toBe('recorded')
    expect(shown.view.outputs.length).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a pasted id is cleaned up (spaces, capitals) and a malformed one is refused before anything else', async () => {
    const fetchSpy = blocked()
    const data = createData()
    data.setMode('recorded')
    expect((await data.lookup(`  ${bobTx.id.toUpperCase()}\n`)).view.id).toBe(bobTx.id)
    for (const bad of ['', 'abc', 'zz'.repeat(32), bobTx.id + '0', bobTx.id.slice(1)]) expect(await fails(data.lookup(bad))).toBe('bad-id')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a #tx= link works with the id in capitals or mixed case, and the same id comes out in lower case', () => {
    const id = bobTx.id
    expect(txFromHash(`#tx=${id}`)).toBe(id) // lower case first: the case that always worked
    expect(txFromHash(`#tx=${id.toUpperCase()}`)).toBe(id)
    const mixed = [...id].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('')
    expect(mixed).not.toBe(id)
    expect(txFromHash(`#tx=${mixed}`)).toBe(id)
    expect(txFromHash(`#TX=${id.toUpperCase()}`)).toBe(id)
  })

  it('an address that carries no valid id gives null, so the page does not look anything up', () => {
    const id = bobTx.id
    for (const bad of ['', '#', '#tx=', '#tx=abc', `#tx=${id}0`, `#tx=${id.slice(1)}`, `#tx=${'zz'.repeat(32)}`, `#tx=${id}&x=1`, `#id=${id}`, id, `#tx= ${id}`]) expect(txFromHash(bad)).toBeNull()
  })
})

describe('live mode', () => {
  it('asks only the indexer: first for its list of latest transactions, then for the id together with 7 others, all alike', async () => {
    const fetchSpy = indexer(() => json(bobTx.reply))
    const shown = await createData().lookup(bobTx.id)
    expect(shown).toMatchObject({ mode: 'live', fellBack: false, crowd: { size: 8, inWindow: false, listed: RECENT_LIMIT } })
    await expectsReading(shown.view, bobTx)
    expect(fetchSpy).toHaveBeenCalledTimes(1 + 8)
    expect(urls(fetchSpy)[0]).toBe(`${INDEXER_URL}/transactions/recent?limit=${RECENT_LIMIT}`)
    const asked = byIdUrls(fetchSpy)
    const head = `${INDEXER_URL}/transactions/`
    expect(asked).toHaveLength(8)
    expect(new Set(asked).size).toBe(8)
    expect(asked.every((u) => u.startsWith(head) && /^[0-9a-f]{64}$/.test(u.slice(head.length)))).toBe(true)
    expect(askedFor(fetchSpy, bobTx.id)).toBe(1)
    // nothing marks the one you care about: the same method, headers and options on all 8
    const inits = fetchSpy.mock.calls.slice(1).map((c) => JSON.stringify({ ...c[1], signal: undefined }))
    expect(new Set(inits).size).toBe(1)
  })

  it('summon makes one request for the recent list and picks a transaction that has sealed notes', async () => {
    const fetchSpy = stubFetch(() => json({ transactions: ledger.recent.transactions }))
    const data = createData({ pick: () => 0 })
    const shown = await data.recent()
    expect(shown).toMatchObject({ mode: 'live', fellBack: false, quietChain: false })
    expect(shown.view.outputs.length).toBeGreaterThan(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchSpy.mock.calls[0][0]))
    expect(url.origin).toBe(INDEXER_URL)
    expect(url.pathname).toBe('/transactions/recent')
    expect(url.searchParams.get('limit')).toBe(String(RECENT_LIMIT))
    expect(urls(fetchSpy).some((u) => /[0-9a-f]{64}/.test(u))).toBe(false) // no id of any kind goes out
  })

  it('summon prefers a settled transaction over a rejected one', async () => {
    const rejected = structuredClone(ledger.recent.transactions[0]) as unknown as Record<string, unknown>
    rejected.summary = null
    rejected.rejected_reason = 'Execution failure (InsufficientFunds)'
    stubFetch(() => json({ transactions: [rejected, ledger.recent.transactions[1]] }))
    const shown = await createData({ pick: () => 0 }).recent()
    expect(shown.view.id).toBe(ledger.recent.transactions[1].transaction_id)
    expect(shown.view.outcome).toBe('Commit')
  })

  it('summon prefers a stranger over one of ours, even a rejected stranger, even when ours comes first', async () => {
    const stranger = ledger.recent.transactions[1]
    stubFetch(() => json({ transactions: [bobTx.reply, stranger] }))
    const shown = await createData({ pick: () => 0 }).recent()
    expect(shown.view.id).toBe(stranger.transaction_id)
    expect(shown.ours).toBe(false)
    const rejected = { ...structuredClone(stranger), summary: null, rejected_reason: 'Execution failure (InsufficientFunds)' }
    stubFetch(() => json({ transactions: [bobTx.reply, rejected] }))
    const again = await createData({ pick: () => 0 }).recent()
    expect(again.view.id).toBe(stranger.transaction_id)
    expect(again.view.outcome).toBeNull()
  })

  it('summon with only our own transactions in the live list: shows one of ours, live, and flags it', async () => {
    stubFetch(() => json({ transactions: [bobTx.reply] }))
    const shown = await createData({ pick: () => 0 }).recent()
    expect(shown).toMatchObject({ mode: 'live', fellBack: false, quietChain: false, ours: true })
    expect(shown.view.id).toBe(bobTx.id)
  })

  it('summon never serves one of ours from the recorded sample while the sample holds strangers', async () => {
    const sampleSize = ledger.recent.transactions.length
    for (const live of [false, true]) {
      if (live) stubFetch(() => json({ transactions: [] }))
      for (let k = 0; k < sampleSize; k++) {
        const data = createData({ pick: (n) => k % n })
        if (!live) data.setMode('recorded')
        const shown = await data.recent()
        expect(ourIds.has(shown.view.id), `pick ${k}`).toBe(false)
        expect(shown.ours).toBe(false)
      }
    }
  })

  it('ourIds covers every transaction id the ledger records outside the network sample', () => {
    const { recent: _sample, ...own } = ledger
    const found: string[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if ((k === 'id' || k === 'transaction_id') && typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) found.push(x)
          else walk(x)
        }
      }
    }
    walk(own)
    expect(found.length).toBeGreaterThanOrEqual(txs.length)
    expect(found.filter((id) => !ourIds.has(id))).toEqual([])
  })

  it('a live chain with no private transfer in it: the recorded sample is used, labelled, and the page stays live', async () => {
    stubFetch(() => json({ transactions: [] }))
    const data = createData({ pick: () => 0 })
    const shown = await data.recent()
    expect(shown).toMatchObject({ mode: 'recorded', fellBack: false, quietChain: true })
    expect(shown.view.outputs.length).toBeGreaterThan(0)
    expect(data.mode).toBe('live')
  })

  it('an id the indexer does not know is "not found", not a fallback', async () => {
    indexer(() => json({ error: 'not known to this indexer' }, 404))
    const data = createData()
    expect(await fails(data.lookup(unknownId))).toBe('not-found')
    expect(data.mode).toBe('live')
  })

  it('any other client error is "bad id", not a fallback', async () => {
    indexer(() => json({ error: 'bad request' }, 400))
    const data = createData()
    expect(await fails(data.lookup(unknownId))).toBe('bad-id')
    expect(data.mode).toBe('live')
  })

  it('an answer in a shape this page does not know is "format", not a fallback', async () => {
    indexer(() => json({ transaction: { nothing: 'useful' } }))
    const data = createData()
    expect(await fails(data.lookup(unknownId))).toBe('format')
    expect(data.mode).toBe('live')
  })
})

describe('asking in a crowd (a lookup)', () => {
  it('starts all 8 requests together, before any answer is back, so the indexer sees one burst', async () => {
    const waiting: ((r: Response) => void)[] = []
    const fetchSpy = indexer(() => new Promise<Response>((resolve) => waiting.push(resolve)))
    const done = createData().lookup(bobTx.id)
    await vi.waitFor(() => expect(waiting).toHaveLength(8))
    expect(fetchSpy).toHaveBeenCalledTimes(1 + 8)
    waiting.forEach((resolve) => resolve(json(bobTx.reply)))
    expect((await done).crowd?.size).toBe(8)
  })

  it('is done as soon as the answer for the id is back: slow or dead decoys cost nothing', async () => {
    indexer((id) => (id === bobTx.id ? json(bobTx.reply) : new Promise<Response>(() => {})))
    expect(await createData().lookup(bobTx.id)).toMatchObject({ mode: 'live', fellBack: false, crowd: { size: 8 } })
  })

  it('a decoy that fails, in any way, changes nothing and leaves no unhandled error behind', async () => {
    indexer((id) => {
      if (id === bobTx.id) return json(bobTx.reply)
      if (id.endsWith('1')) return json({ error: 'boom' }, 500)
      if (id.endsWith('2')) return Promise.reject(new TypeError('fetch failed'))
      return json({ error: 'not known to this indexer' }, 404)
    })
    const data = createData()
    for (let i = 0; i < 20; i++) expect(await data.lookup(bobTx.id)).toMatchObject({ mode: 'live', fellBack: false, forgotten: false })
    expect(data.mode).toBe('live')
  })

  it('the id you asked for is in the crowd exactly once, whether or not the list already holds it', async () => {
    const inside = LISTED[5].transaction_id
    const fetchSpy = indexer(() => json(bobTx.reply))
    const shown = await createData().lookup(inside)
    expect(shown.crowd).toMatchObject({ size: 8, inWindow: true })
    expect(askedFor(fetchSpy, inside)).toBe(1)
    expect(byIdUrls(fetchSpy)).toHaveLength(8)
  })

  it('a short list makes a smaller crowd, and says so', async () => {
    const fetchSpy = indexer(() => json(bobTx.reply), () => json({ transactions: LISTED.slice(0, 3) }))
    expect((await createData().lookup(bobTx.id)).crowd).toMatchObject({ size: 4, listed: 3 })
    expect(byIdUrls(fetchSpy)).toHaveLength(4)
  })

  it('an empty, missing or odd list sends the id alone, and says so', async () => {
    for (const list of [{ transactions: [] }, {}, { transactions: 'x' }]) {
      const fetchSpy = indexer(() => json(bobTx.reply), () => json(list))
      expect((await createData().lookup(bobTx.id)).crowd).toMatchObject({ size: 1, listed: 0 })
      expect(byIdUrls(fetchSpy)).toEqual([`${INDEXER_URL}/transactions/${bobTx.id}`])
    }
  })

  it('a list the indexer refuses with a client error stops the lookup ("no crowd"): nothing about the id is sent and the page stays live', async () => {
    const fetchSpy = indexer(() => json(bobTx.reply), () => json({ error: 'forbidden' }, 403))
    const data = createData()
    const e = await data.lookup(bobTx.id).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(LookupError)
    expect((e as LookupError).kind).toBe('no-crowd')
    expect((e as LookupError).message).toMatch(/Nothing was asked about your id/)
    expect(data.mode).toBe('live')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(urls(fetchSpy).some((u) => u.includes(bobTx.id))).toBe(false)
  })

  it('a 404 on the list is not mistaken for "not found" or for a demo the indexer forgot', async () => {
    indexer(() => json(bobTx.reply), () => json({ error: 'not known to this indexer' }, 404))
    expect(await fails(createData().lookup(bobTx.id))).toBe('no-crowd')
    expect(await fails(createData().lookup(unknownId))).toBe('no-crowd')
  })

  it('the id failing after the list worked: the page goes recorded, and still says the id went out in a crowd', async () => {
    const fetchSpy = indexer((id) => (id === bobTx.id ? json({ error: 'down' }, 503) : json(bobTx.reply)))
    const data = createData()
    const shown = await data.lookup(bobTx.id)
    expect(shown).toMatchObject({ mode: 'recorded', fellBack: true, crowd: { size: 8 } })
    expect(data.mode).toBe('recorded')
    expect(byIdUrls(fetchSpy)).toHaveLength(8)
  })

  it('the id taking too long counts as an outage too, after the timeout, without waiting for the decoys', async () => {
    indexer(() => new Promise<Response>(() => {}))
    const data = createData({ timeoutMs: 40 })
    expect(await data.lookup(bobTx.id)).toMatchObject({ mode: 'recorded', fellBack: true, crowd: { size: 8 } })
  })

  it('the crowd is new every time: two lookups of one id do not ask for the same set', async () => {
    const fetchSpy = indexer(() => json(bobTx.reply))
    const data = createData()
    await data.lookup(bobTx.id)
    const first = new Set(byIdUrls(fetchSpy))
    await data.lookup(bobTx.id)
    const second = byIdUrls(fetchSpy).slice(8)
    expect(second).toHaveLength(8)
    expect(second.every((u) => first.has(u))).toBe(false) // the chance of the same 7 out of 39 is about 1 in 15 million
  })
})

describe('opening a saved transaction file', () => {
  const file = (text: string) => new Blob([text])

  it('shows the transaction in the file, asks nobody, and leaves the page as it was', async () => {
    const fetchSpy = blocked()
    const data = createData()
    const shown = await data.fromFile(file(JSON.stringify(bobTx.reply)))
    expect(shown).toMatchObject({ mode: 'file', fellBack: false, forgotten: false, quietChain: false, ours: false, preview: false })
    expect(shown.crowd).toBeUndefined()
    await expectsReading(shown.view, bobTx)
    expect(data.mode).toBe('live')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('also takes the bare transaction (an item of the list), and works while the page is recorded', async () => {
    const fetchSpy = blocked()
    const data = createData()
    data.setMode('recorded')
    const shown = await data.fromFile(file(JSON.stringify((bobTx.reply as { transaction: unknown }).transaction)))
    expect(shown.mode).toBe('file')
    expect(shown.view.id).toBe(bobTx.id)
    expect(data.mode).toBe('recorded')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('opens every saved demo answer, and each reads as the recording says', async () => {
    const fetchSpy = blocked()
    const data = createData()
    for (const tx of txs) await expectsReading((await data.fromFile(file(JSON.stringify(tx.reply)))).view, tx)
    for (const h of ledger.hero) expect((await data.fromFile(file(JSON.stringify(h.reply)))).view.id).toBe(h.id)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses what is not a saved transaction, each in its own words, and asks nobody', async () => {
    const fetchSpy = blocked()
    const data = createData()
    const refuse = async (blob: Blob, words: RegExp): Promise<void> => {
      const e = await data.fromFile(blob).catch((x: unknown) => x)
      expect(e).toBeInstanceOf(LookupError)
      expect((e as LookupError).kind).toBe('format')
      expect((e as LookupError).message).toMatch(words)
    }
    await refuse(file('not json {'), /not JSON/)
    await refuse(file(''), /not JSON/)
    for (const odd of ['{"hello":1}', '[]', 'null', '7', '"text"']) await refuse(file(odd), /not the indexer's answer for one transaction/)
    await refuse(file(JSON.stringify({ transactions: ledger.recent.transactions })), /list of transactions/)
    await refuse(file(JSON.stringify({ transaction: { transaction_id: 'nope' } })), /not the indexer's answer for one transaction/)
    await refuse(new Blob(['x'.repeat(MAX_FILE_BYTES + 1)]), /larger than 1 MB/)
    expect(data.mode).toBe('live')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('automatic fallback to recorded data', () => {
  const cases: [string, () => Spy][] = [ // [name, arrange]: the indexer is unusable
    ['the connection is refused', () => blocked()],
    ['the indexer does not answer in time', () => never()],
    ['the indexer answers 500', () => stubFetch(() => json({ error: 'boom' }, 500))],
    ['the indexer answers 503', () => stubFetch(() => json({ error: 'down' }, 503))],
    ['the indexer throttles us (429)', () => stubFetch(() => json({ error: 'slow down' }, 429))],
  ]
  for (const [name, arrange] of cases) {
    it(`${name}: the page switches to recorded, says so, and the demo still reads right`, async () => {
      const fetchSpy = arrange()
      const data = createData({ timeoutMs: 40 })
      const shown = await data.lookup(bobTx.id)
      expect(shown).toMatchObject({ mode: 'recorded', fellBack: true, forgotten: false })
      expect(shown.crowd).toBeUndefined()
      expect(data.mode).toBe('recorded')
      // the list of latest transactions was the only thing asked: nothing about the id left the page
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(urls(fetchSpy).some((u) => u.includes(bobTx.id))).toBe(false)
      await expectsReading(shown.view, bobTx)
      // end to end: the very same words reach the medium
      const heard = await listen(keys.bob.viewSecret, shown.view.outputs)
      expect(heard).toHaveLength(1)
      expect(heard[0].plain).toEqual({ value: 666000n, memo: 'The candle went out. Did you do that?' })
    })
  }

  it('the switch sticks: later calls do not ask the indexer again', async () => {
    const fetchSpy = blocked()
    const data = createData()
    await data.lookup(bobTx.id)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const again = await data.lookup(txs[1].id)
    expect(again).toMatchObject({ mode: 'recorded', fellBack: false })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('summon falls back too when the indexer is down', async () => {
    blocked()
    const data = createData({ pick: () => 0 })
    const shown = await data.recent()
    expect(shown).toMatchObject({ mode: 'recorded', fellBack: true, forgotten: false })
    expect(data.mode).toBe('recorded')
  })

  it('an id that is neither a demo nor in the sample and cannot be asked for is "not recorded"', async () => {
    blocked()
    expect(await fails(createData().lookup(unknownId))).toBe('not-recorded')
  })

  it('says why when the id is unknown because the indexer was down, not only what recorded mode holds', async () => {
    blocked()
    const e = await createData()
      .lookup(unknownId)
      .catch((x: unknown) => x)
    expect(e).toBeInstanceOf(LookupError)
    expect((e as LookupError).message).toMatch(/^The indexer did not answer, and this id is not among the recorded transactions/)
  })

  it('the way back works: switching to live asks the indexer again', async () => {
    const fetchSpy = indexer(() => json(bobTx.reply))
    const data = createData()
    data.setMode('recorded')
    await data.lookup(bobTx.id)
    expect(fetchSpy).not.toHaveBeenCalled()
    data.setMode('live')
    expect((await data.lookup(bobTx.id)).mode).toBe('live')
    expect(fetchSpy).toHaveBeenCalledTimes(1 + 8)
  })
})

describe('a demo the indexer no longer holds (it answers 404)', () => {
  const gone = () => json({ error: 'not known to this indexer' }, 404)

  it('only that answer comes from the recording: labelled, still readable, and the page stays live', async () => {
    indexer(gone)
    const data = createData()
    const shown = await data.lookup(bobTx.id)
    expect(shown).toMatchObject({ mode: 'recorded', fellBack: false, forgotten: true, preview: false })
    expect(data.mode).toBe('live')
    await expectsReading(shown.view, bobTx)
  })

  it('every demo is served that way, asked for once each among its crowd', async () => {
    const fetchSpy = indexer(gone)
    const data = createData()
    for (const d of demos) {
      expect(await data.lookup(d.id), `demo ${d.n}`).toMatchObject({ mode: 'recorded', forgotten: true, fellBack: false, crowd: { size: 8 } })
      expect(askedFor(fetchSpy, d.id), `demo ${d.n}`).toBe(1)
    }
    expect(byIdUrls(fetchSpy)).toHaveLength(8 * demos.length)
    expect(data.mode).toBe('live')
  })

  it('the next call still asks the indexer: a demo it holds comes back live, an unknown id gets its own "not found"', async () => {
    const fetchSpy = indexer((id) => (id === txs[1].id ? json(txs[1].reply) : gone()))
    const data = createData()
    expect((await data.lookup(bobTx.id)).forgotten).toBe(true)
    expect(await data.lookup(txs[1].id)).toMatchObject({ mode: 'live', forgotten: false })
    const e = await data.lookup(unknownId).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(LookupError)
    expect((e as LookupError).kind).toBe('not-found')
    expect((e as LookupError).message).toMatch(/old id may be gone/)
    expect(data.mode).toBe('live')
    expect([bobTx.id, txs[1].id, unknownId].map((id) => askedFor(fetchSpy, id))).toEqual([1, 1, 1])
    expect(byIdUrls(fetchSpy)).toHaveLength(3 * 8)
  })

  it('an indexer that comes back with its history is believed again', async () => {
    let holds = false
    indexer(() => (holds ? json(bobTx.reply) : gone()))
    const data = createData()
    expect((await data.lookup(bobTx.id)).forgotten).toBe(true)
    holds = true
    expect(await data.lookup(bobTx.id)).toMatchObject({ mode: 'live', forgotten: false })
  })

  it('is no outage: an id it is not "forgotten" for is not served from the recording', async () => {
    indexer(gone)
    expect(await fails(createData().lookup(unknownId))).toBe('not-found')
  })
})

describe("the page's starting example", () => {
  it('is demo 1 from the recording, asks nobody, and leaves the page live', async () => {
    const fetchSpy = blocked()
    const data = createData()
    const shown = data.example()
    expect(shown).toMatchObject({ mode: 'recorded', preview: true, fellBack: false, forgotten: false, quietChain: false, ours: false })
    expect(shown.view.id).toBe(demos[0].id)
    expect(demos[0].kind).toBe('audited') // the one example where all three ghosts have something to read
    expect(data.mode).toBe('live')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads as the recording says: the recipient opens one note, the stranger and a wrong key hear nothing', async () => {
    const shown = createData().example()
    const hero = ledger.hero[0]
    const heard = await listen(keys[hero.to].viewSecret, shown.view.outputs)
    expect(heard).toHaveLength(1)
    expect(heard[0].plain).toEqual({ value: BigInt(hero.amount), memo: hero.memo })
    expect(await listen(keys.eve.viewSecret, shown.view.outputs)).toHaveLength(0)
  })

  it('no other answer is marked as the starting example', async () => {
    indexer(() => json(bobTx.reply))
    const data = createData({ pick: () => 0 })
    expect((await data.lookup(bobTx.id)).preview).toBe(false)
    expect((await data.recent()).preview).toBe(false)
  })
})

describe('the date of the recorded copies', () => {
  it('every recorded answer was made on savedOn, the day the pages say', () => {
    const made = [...ledger.txs, ...ledger.hero].map((t) => (t.reply as { transaction: { created_at: string } }).transaction.created_at)
    made.push(...ledger.recent.transactions.map((t) => t.created_at))
    expect(made.length).toBe(ledger.txs.length + ledger.hero.length + ledger.recent.transactions.length)
    for (const c of made) expect(c.startsWith(savedOn), c).toBe(true)
  })
})
