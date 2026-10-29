// Where answers come from: live indexer, recorded set, and the switch between them. fetch is replaced in every test, so no
// test here touches the network. A fetch that throws if it is called stands in for "the network is blocked".
import { afterEach, describe, expect, it, vi } from 'vitest'
import ledger from '../ledger.json'
import { INDEXER_URL, LIST_KEPT_MS, MAX_FILE_BYTES, RECENT_LIMIT } from '../src/config.ts'
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
// Two transactions that are not ours and not demos: a stranger's, as the indexer's list holds them.
const strangers = ledger.recent.transactions as unknown as { transaction_id: string }[]
const [inList, notInList] = strangers.map((t) => t.transaction_id)

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Error' })
const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fn = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => impl(String(url)))
  vi.stubGlobal('fetch', fn)
  return fn
}
const blocked = () => stubFetch(() => Promise.reject(new TypeError('fetch failed')))
const never = () => stubFetch(() => new Promise<Response>(() => {}))

// A fake indexer: its list of latest transactions at /transactions/recent (by default 40 made-up ids and one stranger's real one), and one answer per id at /transactions/<id>.
const idN = (n: number): string => n.toString(16).padStart(64, '0')
const LISTED = [...Array.from({ length: RECENT_LIMIT - 1 }, (_, i) => ({ transaction_id: idN(i + 1), created_at: '2026-10-29 17:21:00.0' })), strangers[0]]
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
  it('a demo is asked for by id, one request to the indexer, as before', async () => {
    const fetchSpy = indexer(() => json(bobTx.reply))
    const shown = await createData().lookup(bobTx.id)
    expect(shown).toMatchObject({ mode: 'live', fellBack: false })
    expect(shown.list).toBeUndefined()
    await expectsReading(shown.view, bobTx)
    expect(urls(fetchSpy)).toEqual([`${INDEXER_URL}/transactions/${bobTx.id}`])
  })

  it('summon makes one request for the recent list and picks a transaction that has sealed notes', async () => {
    const fetchSpy = stubFetch(() => json({ transactions: ledger.recent.transactions }))
    const data = createData({ pick: () => 0 })
    const shown = await data.recent()
    expect(shown).toMatchObject({ mode: 'live', fellBack: false, quietChain: false, list: { size: ledger.recent.transactions.length, found: false } })
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
    expect(await fails(data.lookup(unknownId, { askAnyway: true }))).toBe('not-found')
    expect(data.mode).toBe('live')
  })

  it('any other client error is "bad id", not a fallback', async () => {
    indexer(() => json({ error: 'bad request' }, 400))
    const data = createData()
    expect(await fails(data.lookup(unknownId, { askAnyway: true }))).toBe('bad-id')
    expect(data.mode).toBe('live')
  })

  it('an answer in a shape this page does not know is "format", not a fallback', async () => {
    indexer(() => json({ transaction: { nothing: 'useful' } }))
    const data = createData()
    expect(await fails(data.lookup(unknownId, { askAnyway: true }))).toBe('format')
    expect(data.mode).toBe('live')
  })
})

describe('crowd first: a lookup looks in the indexer\'s list before it names an id', () => {
  const askAnywayFor = (spy: Spy, id: string) => urls(spy).filter((u) => u.endsWith(`/transactions/${id}`)).length

  it('an id that is in the list is read from the list: one request for the list, none by id, and the id is in no address', async () => {
    const fetchSpy = indexer(() => json({ error: 'must not be asked' }, 500))
    const data = createData()
    const shown = await data.lookup(inList)
    expect(shown).toMatchObject({ mode: 'live', fellBack: false, forgotten: false, list: { size: RECENT_LIMIT, found: true } })
    expect(shown.view.id).toBe(inList)
    expect(urls(fetchSpy)).toEqual([`${INDEXER_URL}/transactions/recent?limit=${RECENT_LIMIT}`])
    expect(urls(fetchSpy).some((u) => u.includes(inList))).toBe(false)
  })

  it('what is read from the list is the transaction the indexer would give for that id', async () => {
    indexer(() => json(strangers[0]), () => json({ transactions: LISTED }))
    const data = createData()
    const fromList = await data.lookup(inList)
    const byId = await data.lookup(inList, { askAnyway: true })
    expect(fromList.view).toEqual(byId.view)
  })

  it('the id may be typed in capitals or with spaces, and is still found in the list', async () => {
    const fetchSpy = indexer(() => json({}, 500))
    expect((await createData().lookup(`  ${inList.toUpperCase()}\n`)).view.id).toBe(inList)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('an id that is not in the list is not asked for: the visitor is told, and nothing by id is sent however often they try', async () => {
    const fetchSpy = indexer(() => json(strangers[1]))
    const data = createData()
    for (let i = 0; i < 3; i++) {
      const e = await data.lookup(notInList).catch((x: unknown) => x)
      expect(e).toBeInstanceOf(LookupError)
      expect((e as LookupError).kind).toBe('not-listed')
      expect((e as LookupError).message).toBe(`This id is not among the indexer's latest ${RECENT_LIMIT} transactions. Asking the indexer for it by id would show it this id, together with your IP address and the time.`)
    }
    expect(data.mode).toBe('live')
    expect(byIdUrls(fetchSpy)).toEqual([])
    expect(urls(fetchSpy).some((u) => u.includes(notInList))).toBe(false)
  })

  it('then, when the visitor says so, the id is asked for: exactly one request by id', async () => {
    const fetchSpy = indexer(() => json(strangers[1]))
    const data = createData()
    expect(await fails(data.lookup(notInList))).toBe('not-listed')
    expect(byIdUrls(fetchSpy)).toHaveLength(0)
    const shown = await data.lookup(notInList, { askAnyway: true })
    expect(shown).toMatchObject({ mode: 'live', fellBack: false })
    expect(shown.list).toBeUndefined()
    expect(shown.view.id).toBe(notInList)
    expect(byIdUrls(fetchSpy)).toEqual([`${INDEXER_URL}/transactions/${notInList}`])
    expect(askAnywayFor(fetchSpy, notInList)).toBe(1)
  })

  it('"ask anyway" goes straight to the indexer by id: it needs no list', async () => {
    const fetchSpy = indexer(() => json(strangers[1]), () => json({ error: 'must not be asked' }, 500))
    await createData().lookup(notInList, { askAnyway: true })
    expect(urls(fetchSpy)).toEqual([`${INDEXER_URL}/transactions/${notInList}`])
  })

  it('every demo is asked for by id at once, with no list: they are our public transactions', async () => {
    const fetchSpy = indexer((id) => json(demos.map((d) => [...txs, ...ledger.hero].find((t) => t.id === d.id)!.reply).find((r) => (r as { transaction: { transaction_id: string } }).transaction.transaction_id === id)))
    const data = createData()
    for (const d of demos) expect((await data.lookup(d.id)).view.id, `demo ${d.n}`).toBe(d.id)
    expect(urls(fetchSpy)).toEqual(demos.map((d) => `${INDEXER_URL}/transactions/${d.id}`))
  })

  it('the list is asked for once and shared: Summon and lookups within a minute use the same copy', async () => {
    let clock = 1_000_000
    const fetchSpy = indexer(() => json({}, 500))
    const data = createData({ now: () => clock, pick: () => 0 })
    await data.recent()
    await data.lookup(inList)
    await data.recent()
    await fails(data.lookup(notInList))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    clock += LIST_KEPT_MS - 1
    await data.lookup(inList)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    clock += 1 // a minute has passed: the next one asks again
    await data.lookup(inList)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('two lookups started together share one request for the list', async () => {
    const fetchSpy = indexer(() => json({}, 500))
    const data = createData()
    const [a, b] = await Promise.all([data.lookup(inList), fails(data.lookup(notInList))])
    expect(a.view.id).toBe(inList)
    expect(b).toBe('not-listed')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('a list that failed is not kept: asking again asks the indexer again', async () => {
    let down = true
    const fetchSpy = indexer(() => json({}, 500), () => (down ? json({ error: 'down' }, 503) : json({ transactions: LISTED })))
    const data = createData()
    expect((await data.lookup(inList)).fellBack).toBe(true)
    down = false
    data.setMode('live')
    expect(await data.lookup(inList)).toMatchObject({ mode: 'live', list: { found: true } })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('an empty list means the id is not in it', async () => {
    indexer(() => json({}, 500), () => json({ transactions: [] }))
    const e = await createData().lookup(inList).catch((x: unknown) => x)
    expect((e as LookupError).kind).toBe('not-listed')
    expect((e as LookupError).message).toContain('latest 0 transactions')
  })

  it('an answer that is no list counts as no answer: recorded data takes over, after that one request', async () => {
    for (const odd of [{}, { transactions: 'x' }, { transactions: null }]) {
      const fetchSpy = indexer(() => json({}, 500), () => json(odd))
      expect(await createData().lookup(inList)).toMatchObject({ mode: 'recorded', fellBack: true })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    }
  })

  it('a list full of entries this page cannot use means the id is not in it', async () => {
    const fetchSpy = indexer(() => json({}, 500), () => json({ transactions: [null, 7, 'a', { transaction_id: 5 }] }))
    expect(await fails(createData().lookup(inList))).toBe('not-listed')
    expect(byIdUrls(fetchSpy)).toHaveLength(0)
  })

  it('an entry this page cannot read is "format", not a fallback', async () => {
    indexer(() => json({}, 500), () => json({ transactions: [{ transaction_id: inList, transaction: { nothing: 'useful' } }] }))
    const data = createData()
    expect(await fails(data.lookup(inList))).toBe('format')
    expect(data.mode).toBe('live')
  })

  it('in recorded mode nothing is asked, listed or not', async () => {
    const fetchSpy = blocked()
    const data = createData()
    data.setMode('recorded')
    expect((await data.lookup(inList)).mode).toBe('recorded')
    expect(await fails(data.lookup(unknownId))).toBe('not-recorded')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('opening a saved transaction file', () => {
  const file = (text: string) => new Blob([text])

  it('shows the transaction in the file, asks nobody, and leaves the page as it was', async () => {
    const fetchSpy = blocked()
    const data = createData()
    const shown = await data.fromFile(file(JSON.stringify(bobTx.reply)))
    expect(shown).toMatchObject({ mode: 'file', fellBack: false, forgotten: false, quietChain: false, ours: false, preview: false })
    expect(shown.list).toBeUndefined()
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
    it(`${name}: a stranger's id switches the page to recorded after the list request alone, and says so`, async () => {
      const fetchSpy = arrange()
      const data = createData({ timeoutMs: 40 })
      const shown = await data.lookup(inList)
      expect(shown).toMatchObject({ mode: 'recorded', fellBack: true, forgotten: false })
      expect(shown.list).toBeUndefined()
      expect(shown.view.id).toBe(inList)
      expect(data.mode).toBe('recorded')
      // the list of latest transactions was the only thing asked: the id left the page in no request
      expect(urls(fetchSpy)).toEqual([`${INDEXER_URL}/transactions/recent?limit=${RECENT_LIMIT}`])
    })

    it(`${name}: a demo, asked for by id, switches the page to recorded, says so, and still reads right`, async () => {
      const fetchSpy = arrange()
      const data = createData({ timeoutMs: 40 })
      const shown = await data.lookup(bobTx.id)
      expect(shown).toMatchObject({ mode: 'recorded', fellBack: true, forgotten: false })
      expect(shown.list).toBeUndefined()
      expect(data.mode).toBe('recorded')
      expect(urls(fetchSpy)).toEqual([`${INDEXER_URL}/transactions/${bobTx.id}`])
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
    expect(fetchSpy).toHaveBeenCalledTimes(1)
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

  it('every demo is served that way, asked for once each', async () => {
    const fetchSpy = indexer(gone)
    const data = createData()
    for (const d of demos) {
      expect(await data.lookup(d.id), `demo ${d.n}`).toMatchObject({ mode: 'recorded', forgotten: true, fellBack: false })
      expect(askedFor(fetchSpy, d.id), `demo ${d.n}`).toBe(1)
    }
    expect(byIdUrls(fetchSpy)).toHaveLength(demos.length)
    expect(data.mode).toBe('live')
  })

  it('the next call still asks the indexer: a demo it holds comes back live, an unknown id gets its own "not found"', async () => {
    const fetchSpy = indexer((id) => (id === txs[1].id ? json(txs[1].reply) : gone()))
    const data = createData()
    expect((await data.lookup(bobTx.id)).forgotten).toBe(true)
    expect(await data.lookup(txs[1].id)).toMatchObject({ mode: 'live', forgotten: false })
    const e = await data.lookup(unknownId, { askAnyway: true }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(LookupError)
    expect((e as LookupError).kind).toBe('not-found')
    expect((e as LookupError).message).toMatch(/old id may be gone/)
    expect(data.mode).toBe('live')
    expect([bobTx.id, txs[1].id, unknownId].map((id) => askedFor(fetchSpy, id))).toEqual([1, 1, 1])
    expect(byIdUrls(fetchSpy)).toHaveLength(3)
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
    expect(await fails(createData().lookup(unknownId, { askAnyway: true }))).toBe('not-found')
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
