// The ghost log: every request is written down when it is made, a key in a request is caught, and the headline says only what is true.
// fetch is replaced in every test, so none of this touches the network.
import { afterEach, describe, expect, it, vi } from 'vitest'
import ledger from '../ledger.json'
import { INDEXER_URL, RECENT_LIMIT } from '../src/config.ts'
import { createData, demoKeys, demos } from '../src/data.ts'
import { decryptOutput } from '../src/decrypt.ts'
import { createNetlog, type Timing } from '../src/netlog.ts'

afterEach(() => vi.unstubAllGlobals())

const SITE = 'example.test'
const INDEXER = new URL(INDEXER_URL).host
const idN = (n: number): string => n.toString(16).padStart(64, '0')
const LISTED = Array.from({ length: RECENT_LIMIT }, (_, i) => ({ transaction_id: idN(i + 1), created_at: '2026-10-29 17:21:00.0' }))
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
const settle = () => new Promise<void>((r) => setTimeout(r, 0)) // lets the copy of every answer be counted

let t = 0
const newLog = () => {
  t = 0
  return createNetlog({ siteHost: SITE, indexerHost: INDEXER, clock: () => ++t })
}
/** A fetch that answers 200 with a body of the given text, and remembers what it was asked. */
const echo = (body = '{}') => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(body))

const secrets = Object.values(demoKeys).map((k) => k.viewSecret)

describe('the demo keys are in none of the requests', () => {
  it('lookups of every kind, summon and a saved file with the demo keys in use: not one request holds a key, and the log says so', async () => {
    const log = newLog()
    secrets.forEach((s) => log.watch(s))
    const strangers = ledger.recent.transactions
    const replies = new Map<string, unknown>([...ledger.txs, ...ledger.hero].map((x) => [x.id, x.reply]))
    for (const s of strangers) replies.set(s.transaction_id, s)
    const fake = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url)
      if (u.includes('/transactions/recent')) return json({ transactions: [strangers[0], ...LISTED] })
      const reply = replies.get(u.slice(u.lastIndexOf('/') + 1))
      return reply ? json(reply) : json({ error: 'not found' }, 404)
    })
    vi.stubGlobal('fetch', log.wrap(fake))
    const data = createData()

    for (const d of demos) {
      const shown = await data.lookup(d.id) // asked for by id
      // the keys are used on the page while the lookups run: reading the sealed notes with each of them
      for (const key of secrets) for (const s of shown.view.statements) for (const o of s.outputs) await decryptOutput(key, o)
    }
    await data.lookup(strangers[0].transaction_id) // found in the list
    await data.recent() // summon, from the list kept a moment ago
    await expect(data.lookup(strangers[1].transaction_id)).rejects.toThrow(/not among the indexer's latest/) // not listed: nothing by id
    await data.lookup(strangers[1].transaction_id, { askAnyway: true }) // the visitor said so
    await data.fromFile(new Blob([JSON.stringify(ledger.hero[0].reply)])) // a saved file
    await settle()

    // what really went out, searched for every key (any case): the request address, its headers and its body
    expect(fake.mock.calls.length).toBe(demos.length + 1 + 1) // every demo by id, the list once, the one id asked for anyway
    const wire = fake.mock.calls.map(([url, init]) => `${String(url)} ${JSON.stringify(init?.headers ?? {})} ${String(init?.body ?? '')}`.toLowerCase()).join('\n')
    for (const s of secrets) expect(wire.includes(s.toLowerCase())).toBe(false)

    // and the log saw every one of those requests, flagged nothing, and says what the brief says it must
    const entries = log.entries()
    expect(entries).toHaveLength(fake.mock.calls.length)
    expect(entries.every((e) => e.warn === null)).toBe(true)
    expect(entries.every((e) => e.host === INDEXER)).toBe(true)
    expect(entries.filter((e) => e.kind === 'list')).toHaveLength(1)
    expect(JSON.stringify(entries).toLowerCase().includes(secrets[0].toLowerCase())).toBe(false)
    expect(log.summary()).toMatchObject({ requests: fake.mock.calls.length, hosts: 1, leaked: false, strays: 0 })
    expect(log.headline()).toBe(`This page sent ${fake.mock.calls.length} requests to 1 host; your keys were in none of them.`)
  })

  it('has teeth: a key in the address, in a header or in a body is caught, whatever its case', async () => {
    const key = demoKeys.bob.viewSecret
    for (const send of [
      (f: typeof fetch) => f(`https://${INDEXER}/transactions/recent?k=${key}`),
      (f: typeof fetch) => f(`https://${INDEXER}/transactions/recent?k=${key.toUpperCase()}`),
      (f: typeof fetch) => f(`https://${INDEXER}/x`, { headers: { 'x-note': key } }),
      (f: typeof fetch) => f(`https://${INDEXER}/x`, { headers: new Headers({ 'x-note': key }) }),
      (f: typeof fetch) => f(`https://${INDEXER}/x`, { method: 'POST', body: JSON.stringify({ k: key }) }),
      (f: typeof fetch) => f(`https://${INDEXER}/x`, { method: 'POST', body: new URLSearchParams({ k: key }) }),
      (f: typeof fetch) => f(new Request(`https://${INDEXER}/x`, { headers: { 'x-note': key } })),
    ]) {
      const log = newLog()
      log.watch(key)
      await send(log.wrap(echo()))
      expect(log.summary().leaked).toBe(true)
      expect(log.entries()[0].warn).toContain('a key this page was given')
      expect(log.headline()).toMatch(/^Warning: a key this page was given appears in a request it sent/)
      expect(log.headline()).not.toContain('none of them')
    }
  })

  it('a key that is watched after the request was made still flags it', async () => {
    const log = newLog()
    await log.wrap(echo())(`https://${INDEXER}/transactions/recent?k=${demoKeys.eve.viewSecret}`)
    expect(log.summary().leaked).toBe(false)
    log.watch(demoKeys.eve.viewSecret)
    expect(log.summary().leaked).toBe(true)
  })

  it('does not search for something too short to be a key, and ignores a repeat', async () => {
    const log = newLog()
    log.watch('abc')
    log.watch('   ')
    await log.wrap(echo())(`https://${INDEXER}/transactions/abc`)
    expect(log.summary().leaked).toBe(false)
    log.watch(demoKeys.bob.viewSecret)
    log.watch(demoKeys.bob.viewSecret)
    expect(log.summary().leaked).toBe(false)
  })
})

describe('the fetch wrapper', () => {
  it('hands back the very same answer: the page can still read it after the log has counted it', async () => {
    const log = newLog()
    const res = await log.wrap(echo('{"hello":"world"}'))(`https://${INDEXER}/transactions/recent?limit=40`)
    expect(await res.json()).toEqual({ hello: 'world' })
  })

  it('writes the request down before it goes out, and fills in the answer when it arrives', async () => {
    const log = newLog()
    let answer!: (r: Response) => void
    const slow = vi.fn((_url: string | URL | Request, _init?: RequestInit) => new Promise<Response>((r) => (answer = r)))
    const pending = log.wrap(slow)(`https://${INDEXER}/transactions/recent?limit=40`)
    expect(log.entries()).toHaveLength(1)
    expect(log.entries()[0]).toMatchObject({ n: 1, host: INDEXER, kind: 'list', path: '/transactions/recent?limit=40', status: null, in: null, viaWrapper: true, warn: null })
    answer(new Response('x'.repeat(1234), { status: 200 }))
    await pending
    await settle()
    expect(log.entries()[0]).toMatchObject({ status: 200, in: 1234 })
  })

  it('counts the bytes it sent: the address, and the body of anything that has one', async () => {
    const log = newLog()
    const f = log.wrap(echo())
    const url = `https://${INDEXER}/transactions/recent?limit=40`
    await f(url)
    await f(url, { method: 'POST', body: 'héllo' }) // 6 bytes: é takes two
    await f(url, { method: 'POST', body: new Uint8Array(10) })
    await f(url, { method: 'POST', body: new Blob(['abc']) })
    await f(url, { method: 'POST', body: new FormData() }) // not known without reading it
    const out = log.entries().map((e) => e.out)
    expect(out).toEqual([url.length, url.length + 6, url.length + 10, url.length + 3, null])
  })

  it('a failed request is logged with status 0, and the caller still gets the failure', async () => {
    const log = newLog()
    const down = vi.fn((_url: string | URL | Request, _init?: RequestInit) => Promise.reject(new TypeError('fetch failed')))
    await expect(log.wrap(down)(`https://${INDEXER}/transactions/recent?limit=40`)).rejects.toThrow('fetch failed')
    await settle()
    expect(log.entries()[0]).toMatchObject({ status: 0, in: null })
  })

  it('an answer that is an error is logged with its status', async () => {
    const log = newLog()
    await log.wrap(vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('no', { status: 404 })))(`https://${INDEXER}/transactions/${idN(5)}`)
    await settle()
    expect(log.entries()[0]).toMatchObject({ status: 404, in: 2, kind: 'transaction' })
  })

  it('anything that is not a plain ask is flagged: another method, or any body', async () => {
    const log = newLog()
    const f = log.wrap(echo())
    const list = `https://${INDEXER}/transactions/recent?limit=40`
    await f(list)
    await f(list, { method: 'POST' })
    await f(list, { method: 'get', body: 'x' })
    await f(new Request(list, { method: 'PUT', body: 'x' }))
    const [get, post, body, put] = log.entries()
    expect(get.warn).toBeNull()
    for (const e of [post, body, put]) expect(e.warn).toContain('sends data')
  })

  it('a data: or blob: address is no request: the answer comes back and nothing is written down', async () => {
    const log = newLog()
    const f = log.wrap(echo('inline'))
    expect(await (await f('data:text/plain;base64,aGk=')).text()).toBe('inline')
    await f('blob:https://example.test/0f0f')
    expect(log.entries()).toEqual([])
    expect(log.summary()).toMatchObject({ requests: 0, hosts: 0 })
  })

  it('takes a URL object or a Request as well as a string', async () => {
    const log = newLog()
    const f = log.wrap(echo())
    await f(new URL(`https://${INDEXER}/transactions/recent?limit=3`))
    await f(new Request(`https://${INDEXER}/transactions/recent?limit=4`))
    expect(log.entries().map((e) => e.path)).toEqual(['/transactions/recent?limit=3', '/transactions/recent?limit=4'])
  })
})

describe('what a request is called', () => {
  const kinds = async (urls: string[]) => {
    const log = newLog()
    const f = log.wrap(echo())
    for (const u of urls) await f(u)
    return log.entries().map((e) => [e.kind, e.path, e.warn === null])
  }

  it('the indexer list, one transaction (its id shortened), a page file, and a host this page is not built for', async () => {
    const id = 'ab'.repeat(32)
    expect(
      await kinds([`https://${INDEXER}/transactions/recent?limit=40`, `https://${INDEXER}/transactions/${id}`, `https://${SITE}/seance-v2/assets/app.js`, 'https://elsewhere.test/pixel.gif']),
    ).toEqual([
      ['list', '/transactions/recent?limit=40', true],
      ['transaction', '/transactions/ababab…ababab', true],
      ['page', '/seance-v2/assets/app.js', true],
      ['other', '/pixel.gif', false],
    ])
  })

  it('the same path on another host is not the indexer, and the #fragment is not part of what is asked', async () => {
    expect(await kinds([`https://elsewhere.test/transactions/recent?limit=40`, `https://${SITE}/seance-v2/#tx=${'cd'.repeat(32)}`])).toEqual([
      ['other', '/transactions/recent?limit=40', false],
      ['page', '/seance-v2/', true],
    ])
  })

  it('says what each host learns, in plain words', async () => {
    const log = newLog()
    const f = log.wrap(echo())
    await f(`https://${INDEXER}/transactions/recent?limit=40`)
    await f(`https://${INDEXER}/transactions/${idN(1)}`)
    expect(log.entries()[0].reveals).toBe('Your IP address, the time and the headers your browser adds. No transaction id.')
    expect(log.entries()[1].reveals).toBe('Your IP address, the time and this id.')
  })

  it('does not hand out what it searched: no address, header or body text in the rows', async () => {
    const log = newLog()
    await log.wrap(echo())(`https://${INDEXER}/transactions/recent?limit=40`, { headers: { 'x-n': 'secret-words' } })
    expect(Object.keys(log.entries()[0]).sort()).toEqual(['at', 'host', 'in', 'kind', 'n', 'out', 'path', 'reveals', 'status', 'viaWrapper', 'warn'])
  })
})

describe('the browser\'s own list of what it loaded (Resource Timing)', () => {
  const entry = (o: Partial<Timing> & { name: string }): Timing => ({ initiatorType: 'other', startTime: 5, ...o })

  it('the page files appear as page rows, nothing unusual about them', () => {
    const log = newLog()
    log.seen(entry({ name: `https://${SITE}/seance-v2/`, initiatorType: 'navigation', decodedBodySize: 6000, responseStatus: 200 }))
    log.seen(entry({ name: `https://${SITE}/seance-v2/assets/index-1.js`, initiatorType: 'script', decodedBodySize: 1_885_000, responseStatus: 200 }))
    expect(log.entries().map((e) => [e.kind, e.viaWrapper, e.status, e.warn])).toEqual([
      ['page', false, 200, null],
      ['page', false, 200, null],
    ])
    expect(log.entries()[1].in).toBe(1_885_000)
    expect(log.summary()).toMatchObject({ requests: 2, hosts: 1, strays: 0 })
    expect(log.headline()).toBe('This page sent 2 requests to 1 host; your keys were in none of them.')
  })

  it('a request the wrapper already wrote down is completed, not counted twice, one entry for one request', async () => {
    const log = newLog()
    const f = log.wrap(vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('', { status: 200 })))
    const url = `https://${INDEXER}/transactions/recent?limit=40`
    await f(url)
    await f(url)
    const timing = entry({ name: url, initiatorType: 'fetch', responseStatus: 200, decodedBodySize: 91_000 })
    log.seen(timing)
    log.seen(timing)
    expect(log.entries()).toHaveLength(2)
    expect(log.entries().every((e) => e.viaWrapper && e.warn === null)).toBe(true)
    // a third entry has no request of the wrapper's to belong to: something went around it
    log.seen(timing)
    expect(log.entries()).toHaveLength(3)
    expect(log.entries()[2]).toMatchObject({ viaWrapper: false, kind: 'list' })
    expect(log.entries()[2].warn).toContain("went around this page's request code")
    expect(log.summary().strays).toBe(1)
    expect(log.headline()).toBe("This page sent 3 requests to 1 host; your keys were in none of them. (1 request went around the page's own request code, so only its address could be checked.)")
  })

  it('a fetch that never went through the wrapper is flagged, with the address it used, and a key in that address is still caught', () => {
    const log = newLog()
    log.watch(demoKeys.carol.viewSecret)
    log.seen(entry({ name: `https://tracker.test/c?k=${demoKeys.carol.viewSecret}`, initiatorType: 'fetch' }))
    expect(log.entries()[0]).toMatchObject({ viaWrapper: false, kind: 'other', host: 'tracker.test' })
    expect(log.summary()).toMatchObject({ leaked: true, strays: 1, hosts: 1 })
  })

  it('a file from a host this page is not built for is flagged as such', () => {
    const log = newLog()
    log.seen(entry({ name: 'https://cdn.test/x.js', initiatorType: 'script' }))
    expect(log.entries()[0].warn).toBe('not a request this page is built to make')
    expect(log.summary().hosts).toBe(1)
  })

  it('things that are not requests to a server are left out: data:, blob: and chrome-extension: addresses', () => {
    const log = newLog()
    for (const name of ['data:image/svg+xml;base64,AAAA', 'blob:https://example.test/abc', 'chrome-extension://abc/x.js', 'not a url']) log.seen(entry({ name }))
    expect(log.entries()).toHaveLength(0)
  })

  it('answers that were not seen by the wrapper keep what the browser knows: status and size, or nothing', () => {
    const log = newLog()
    log.seen(entry({ name: `https://${SITE}/a.css`, initiatorType: 'css' }))
    expect(log.entries()[0]).toMatchObject({ status: null, in: null, out: null })
  })
})

describe('counting from a moment on', () => {
  it('since(mark) counts the requests that started at or after the mark', async () => {
    const log = newLog()
    const f = log.wrap(echo())
    await f(`https://${INDEXER}/x`)
    await f(`https://${INDEXER}/x`)
    const mark = log.mark()
    expect(log.since(mark)).toBe(0)
    await f(`https://${INDEXER}/x`)
    log.seen({ name: `https://${SITE}/late.js`, initiatorType: 'script', startTime: mark + 100 })
    log.seen({ name: `https://${SITE}/early.js`, initiatorType: 'script', startTime: mark - 100 }) // started before the mark
    expect(log.since(mark)).toBe(2)
  })
})

describe('the headline', () => {
  it('counts requests and different hosts, in the singular too', async () => {
    const log = newLog()
    expect(log.headline()).toBe('This page sent 0 requests to 0 hosts; your keys were in none of them.')
    const f = log.wrap(echo())
    await f(`https://${INDEXER}/x`)
    expect(log.headline()).toBe('This page sent 1 request to 1 host; your keys were in none of them.')
    await f(`https://${INDEXER}/y`)
    await f(`https://${SITE}/z`)
    expect(log.headline()).toBe('This page sent 3 requests to 2 hosts; your keys were in none of them.')
  })
})

describe('telling the page', () => {
  it('one notice for a burst of requests, so a panel is drawn once, not 9 times', async () => {
    const log = newLog()
    const heard = vi.fn()
    log.subscribe(heard)
    const f = log.wrap(echo())
    for (let i = 0; i < 9; i++) void f(`https://${INDEXER}/transactions/${idN(i)}`)
    expect(heard).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(heard).toHaveBeenCalledTimes(1)
    await settle() // the answers arrive: another notice, once
    expect(heard.mock.calls.length).toBeLessThanOrEqual(4)
  })
})
