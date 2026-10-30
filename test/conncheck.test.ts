// The connection check: one line of Cloudflare's answer is read and the rest is dropped, and the sentence shown is fixed text.
// Fixture bodies only, with made-up values; fetch is replaced in every test, so none of this touches the network.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INDEXER_TIMEOUT_MS, INDEXER_URL } from '../src/config.ts'
import { checkConnection, kexMessage, parseKex, TRACE_URL } from '../src/conncheck.ts'
import { createNetlog } from '../src/netlog.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// A documentation address and an invented place, long enough that they cannot turn up in a sentence by chance.
const IP = '203.0.113.77'
const LOC = 'Zzyzx-Test-Province-Of-Nowhere'
const trace = (kex: string | null, eol = '\n'): string =>
  [
    'fl=00f000', 'h=esme-indexer-a.ootle.tari.com', `ip=${IP}`, 'ts=1700000000.123', 'visit_scheme=https', 'uag=Fixture/1.0', 'colo=XXX',
    'sliver=none', 'http=http/2', `loc=${LOC}`, 'tls=TLSv1.3', 'sni=plaintext', 'warp=off', 'gateway=off', 'rbi=off', ...(kex === null ? [] : [`kex=${kex}`]),
  ].join(eol) + eol
const reply = (body: string, status = 200) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(body, { status }))
const NO_ANSWER = 'The check got no answer, so this page cannot say which key exchange this connection used.'
const UNKNOWN = 'Cloudflare did not say which key exchange this connection used.'
const OTHER = 'Cloudflare named a key exchange this page does not know, so it cannot say whether it is post-quantum.'

describe('parseKex', () => {
  it('reads the kex line and nothing else', () => {
    expect(parseKex(trace('X25519MLKEM768'))).toBe('X25519MLKEM768')
    expect(parseKex(trace('X25519'))).toBe('X25519')
  })
  it('copes with CRLF line ends and stray spaces', () => {
    expect(parseKex(trace('X25519MLKEM768', '\r\n'))).toBe('X25519MLKEM768')
    expect(parseKex('kex=  X25519 \n')).toBe('X25519')
  })
  it('is null when there is no kex line, or the word sits anywhere but at the start of a line', () => {
    expect(parseKex(trace(null))).toBeNull()
    expect(parseKex('')).toBeNull()
    expect(parseKex('xkex=X25519\nhas kex=X25519')).toBeNull()
  })
})

describe('kexMessage', () => {
  it('names the hybrid, in the words of research/80, and says what it does not cover', () => {
    const m = kexMessage('X25519MLKEM768')
    expect(m).toContain("used X25519MLKEM768: X25519 combined with ML-KEM-768. ML-KEM is NIST's quantum-resistant key-establishment standard")
    expect(m).toContain("a recording of this connection is meant to stay unreadable even to a future quantum computer ('store now, decrypt later')")
    expect(m).toContain('This covers only that connection. It does not change what the chain makes public, and it does not cover the link from Cloudflare to the indexer.')
  })
  it('names a classical group by its name', () => {
    expect(kexMessage('X25519')).toBe('Your browser used a classical key exchange (X25519) for this connection.')
    expect(kexMessage('P-256')).toBe('Your browser used a classical key exchange (P-256) for this connection.')
  })
  it.each([null, ''])('says it was not told, never "classical", for %j', (kex) => {
    const m = kexMessage(kex)
    expect(m).toBe(UNKNOWN)
    expect(m).not.toMatch(/classical|ML-KEM|post-quantum/i)
  })
  it.each(['Kyber512', 'X25519Kyber768Draft00', 'x25519mlkem768', 'X25519MLKEM768 ', '<b>X25519</b>', 'a'.repeat(500)])('says it does not know the value, never "classical" or "did not say", and never copies it, for %j', (kex) => {
    const m = kexMessage(kex)
    expect(m).toBe(OTHER)
    expect(m).not.toMatch(/classical|ML-KEM|did not say/i)
    expect(m).not.toContain(kex)
  })
})

describe('checkConnection', () => {
  it('asks once, with a plain GET to the trace address, which the page\'s policy allows', async () => {
    expect(TRACE_URL).toBe(`${INDEXER_URL}/cdn-cgi/trace`)
    const f = reply(trace('X25519'))
    await checkConnection(f)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]!
    expect(String(url)).toBe(TRACE_URL)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.cache).toBe('no-store')
  })

  it.each([
    ['X25519MLKEM768', /used X25519MLKEM768/],
    ['X25519', /classical key exchange \(X25519\)/],
    [null, /^Cloudflare did not say/],
    ['junk;value<>', /^Cloudflare named a key exchange this page does not know/],
  ])('shows a sentence for kex=%s and never the IP address or place in the body', async (kex, shown) => {
    const text = await checkConnection(reply(trace(kex)))
    expect(text).toMatch(shown)
    for (const secret of [IP, LOC, 'Fixture/1.0', '1700000000', 'XXX']) expect(text).not.toContain(secret)
  })

  it('says nothing about the connection when no answer comes: an error status, a failure, a body that is not text', async () => {
    expect(await checkConnection(reply(trace('X25519MLKEM768'), 503))).toBe(NO_ANSWER)
    expect(await checkConnection(vi.fn(async () => { throw new TypeError('Failed to fetch') }))).toBe(NO_ANSWER)
    const broken = vi.fn(async () => ({ ok: true, text: async () => { throw new Error('stream failed') } }) as unknown as Response)
    expect(await checkConnection(broken)).toBe(NO_ANSWER)
    expect(NO_ANSWER).not.toMatch(/classical|post-quantum/i)
  })

  it('gives up when the answer does not come', async () => {
    vi.useFakeTimers()
    const hang = vi.fn((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_ok, no) => init?.signal?.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError')))))
    const pending = checkConnection(hang)
    await vi.advanceTimersByTimeAsync(INDEXER_TIMEOUT_MS + 1)
    expect(await pending).toBe(NO_ANSWER)
  })

  it('uses the page\'s fetch as it is when the button is pressed, so the request goes through the ghost log', async () => {
    const log = createNetlog({ siteHost: 'example.test', indexerHost: new URL(INDEXER_URL).host, clock: () => 1 })
    const real = reply(trace('X25519MLKEM768'))
    vi.stubGlobal('fetch', log.wrap(real)) // main.ts does this before any button can be pressed
    expect(await checkConnection()).toMatch(/used X25519MLKEM768/)
    expect(real).toHaveBeenCalledTimes(1)
    expect(log.entries()).toHaveLength(1)
    expect(log.entries()[0]).toMatchObject({ kind: 'check', path: '/cdn-cgi/trace', viaWrapper: true, warn: null })
    expect(log.headline()).toBe('This page sent 1 request to 1 host; 0 named a transaction id; your keys were in none of them.')
    expect(JSON.stringify(log.entries())).not.toContain(IP) // the log keeps sizes, never the body
  })
})

describe('the page', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const offline = readme.split(/^## /m).find((s) => s.startsWith('Offline copy')) ?? ''

  it('has the check button inside a block the offline copy hides, and says it sends one request', () => {
    const block = /<div class="conn-check online">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
    expect(block).toContain('id="check-conn"')
    expect(block).toContain('sends one request')
    expect(block).toContain('role="status"')
  })

  it('links the offline copy from the footer, hidden in the offline copy, in the words of the README', () => {
    const m = /<li class="online"><a href="\.\/seance-offline\.html">([^<]*)<\/a>([^<]*)<\/li>/.exec(html)
    expect(m).not.toBeNull()
    expect(offline).toContain(m![1]!)
    const sentences = m![2]!.trim().split(/(?<=\.)\s+/).map((s) => s.replace(/\.$/, ''))
    expect(sentences.length).toBeGreaterThan(1)
    for (const s of sentences) expect(offline).toContain(s)
  })
})
