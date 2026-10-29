// The ghost log: every request this page makes, written down as it happens, so a visitor can see what left their browser and where it went.
// Two sources. A wrapper around `fetch` sees everything this page's own code asks for, with sizes. The browser's Resource Timing lists every file
// loaded for the page, and would also show a request that skipped the wrapper. A tripwire watches for keys: if a key this page was given turns up
// in a request, the log says so. No DOM in here, so it is tested on its own; main.ts connects it to `fetch` and to PerformanceObserver.
import { plural, short } from './format.ts'

export type Kind = 'page' | 'list' | 'transaction' | 'other'

export interface Entry {
  n: number
  /** When the request started, on the page's clock (performance.now()), in ms. */
  at: number
  host: string
  kind: Kind
  /** What was asked for. A transaction id is shortened. */
  path: string
  /** Made by this page's own code through the wrapper. False: only seen as a file the browser loaded. */
  viaWrapper: boolean
  /** The answer's HTTP status. null: no answer yet. 0: it failed, no answer came. */
  status: number | null
  /** Bytes the page sent: the address and the body. The browser adds its own headers, which the page cannot see. */
  out: number | null
  /** Bytes of the answer's body, after decoding. null when the browser does not tell the page. */
  in: number | null
  /** What the host at the other end learns from this request, in words. */
  reveals: string
  /** Something unusual about this request, in words. null for an ordinary one. */
  warn: string | null
}

/** The parts of a Resource Timing entry this log reads. */
export interface Timing {
  name: string
  initiatorType?: string
  startTime: number
  decodedBodySize?: number
  responseStatus?: number
}

export interface Options {
  /** The host that serves this page. */
  siteHost: string
  /** The one indexer this page may talk to. */
  indexerHost: string
  /** The page's clock in ms. */
  clock?: () => number
}

interface Row extends Entry {
  /** The address as the browser has it, to match a request with the entry the browser lists for it. */
  url: string
  /** What a key could hide in: the address, the headers and a text body, lower case. Never shown. */
  text: string
  matched: boolean
  leaked: boolean
}

export interface Summary {
  requests: number
  hosts: number
  /** A key this page was given appears in at least one request. */
  leaked: boolean
  /** Requests that went around the wrapper: only their addresses could be checked for keys. */
  strays: number
}

// What the host at the other end learns from one request. The browser adds its own headers (such as the language and the browser's name), which the page cannot see.
const REVEALS: Record<Kind, string> = {
  page: 'Your IP address, the time and which file you asked for.',
  list: 'Your IP address, the time and the headers your browser adds. No transaction id.',
  transaction: 'Your IP address, the time and this id.',
  other: 'Your IP address, the time and what you asked for.',
}
const TX = /^\/transactions\/([0-9a-f]{64})$/
/** A key shorter than this is not searched for: it would match by accident. A view key is 64 characters. */
const MIN_SECRET = 16

const encoder = new TextEncoder()
const size = (s: string): number => encoder.encode(s).length

function bodyBytes(body: BodyInit | null | undefined): number | null {
  if (body == null) return 0
  if (typeof body === 'string') return size(body)
  if (body instanceof URLSearchParams) return size(body.toString())
  if (body instanceof Blob) return body.size
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength
  return null // FormData and streams: not known without reading them
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  return ''
}

function headerText(h: HeadersInit | undefined): string {
  if (!h) return ''
  if (h instanceof Headers) return JSON.stringify([...h])
  return JSON.stringify(h)
}

export type Netlog = ReturnType<typeof createNetlog>

export function createNetlog(o: Options) {
  const clock = o.clock ?? (() => performance.now())
  const rows: Row[] = []
  const secrets = new Set<string>()
  const listeners: (() => void)[] = []
  let ticking = false

  // Listeners are told once per burst, not once per request: a lookup makes 9 requests in the same moment.
  const changed = (): void => {
    if (ticking) return
    ticking = true
    queueMicrotask(() => {
      ticking = false
      listeners.forEach((f) => f())
    })
  }

  const flag = (r: Row): void => {
    if (r.leaked || !r.text) return
    if ([...secrets].some((s) => r.text.includes(s))) {
      r.leaked = true
      r.warn = 'a key this page was given appears in this request'
    }
  }

  function add(r: Omit<Row, 'n' | 'matched' | 'leaked' | 'warn' | 'reveals'> & { warn?: string | null }): Row {
    const row: Row = { ...r, n: rows.length + 1, reveals: REVEALS[r.kind], warn: r.warn ?? null, matched: false, leaked: false }
    if (row.kind === 'other' && !row.warn) row.warn = 'not a request this page is built to make'
    flag(row)
    rows.push(row)
    changed()
    return row
  }

  function describe(url: URL): { kind: Kind; path: string } {
    const indexer = url.host === o.indexerHost
    if (indexer && url.pathname === '/transactions/recent') return { kind: 'list', path: url.pathname + url.search }
    const tx = indexer ? TX.exec(url.pathname) : null
    if (tx) return { kind: 'transaction', path: `/transactions/${short(tx[1], 6)}` }
    return { kind: url.host === o.siteHost ? 'page' : 'other', path: url.pathname + url.search } // the #fragment never leaves the browser, so it is not shown
  }

  const parse = (raw: string): URL | null => {
    try {
      return new URL(raw, typeof location === 'undefined' ? undefined : location.href)
    } catch {
      return null
    }
  }

  function summary(): Summary {
    return {
      requests: rows.length,
      hosts: new Set(rows.map((r) => r.host)).size,
      leaked: rows.some((r) => r.leaked),
      strays: rows.filter((r) => !r.viaWrapper && r.warn !== null).length,
    }
  }

  /** The line the page leads with. */
  function headline(): string {
    const s = summary()
    if (s.leaked) return 'Warning: a key this page was given appears in a request it sent. Do not use that key again. The rows marked below show which request.'
    const base = `This page sent ${plural(s.requests, 'request')} to ${plural(s.hosts, 'host')}; your keys were in none of them.`
    return s.strays ? `${base} (${plural(s.strays, 'request')} went around the page's own request code, so only ${s.strays === 1 ? 'its' : 'their'} address could be checked.)` : base
  }

  return {
    /** Wraps a fetch so that every call is written down before it goes out. The caller gets the very same answer. */
    wrap(real: typeof fetch): typeof fetch {
      return (input, init) => {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const url = parse(raw)
        if (url && url.protocol !== 'http:' && url.protocol !== 'https:') return real(input, init) // a data: or blob: address never leaves the browser, so it is no request
        const request = typeof input === 'object' && 'method' in input ? input : null
        const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
        const body = init?.body
        const hasBody = body != null || (request?.body ?? null) !== null
        const { kind, path } = url ? describe(url) : { kind: 'other' as const, path: raw }
        const bytes = bodyBytes(body)
        const row = add({
          at: clock(),
          host: url?.host ?? '',
          kind,
          path,
          viaWrapper: true,
          status: null,
          out: bytes === null ? null : size(raw) + bytes,
          in: null,
          url: url?.href ?? raw,
          text: `${raw} ${headerText(init?.headers)} ${request ? headerText(request.headers) : ''} ${bodyText(body)}`.toLowerCase(), // shortcut: the body of a Request object is a stream and is not read, only flagged; upgrade if the page ever builds one
          warn: method !== 'GET' || hasBody ? 'sends data (this page is meant to only ask)' : null,
        })
        const done = real(input, init)
        done.then(
          (res) => {
            row.status = res.status
            changed()
            try {
              // A copy is counted, so the caller still reads the original. The size is the body after decoding, not what crossed the wire.
              void res.clone().arrayBuffer().then(
                (b) => {
                  row.in = b.byteLength
                  changed()
                },
                () => {},
              )
            } catch {
              /* a body that was already read cannot be copied: its size stays unknown */
            }
          },
          () => {
            row.status = 0
            changed()
          },
        )
        return done
      }
    },

    /** Takes in one entry from the browser's Resource Timing list. */
    seen(e: Timing): void {
      const url = parse(e.name)
      if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return
      const own = e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest'
      if (own) {
        // A request the wrapper already wrote down: complete it from what the browser knows, and write nothing new.
        const mine = rows.find((r) => r.viaWrapper && !r.matched && r.url === url.href)
        if (mine) {
          mine.matched = true
          if (mine.status === null && e.responseStatus) mine.status = e.responseStatus
          if (mine.in === null && e.decodedBodySize) mine.in = e.decodedBodySize
          changed()
          return
        }
      }
      const { kind, path } = describe(url)
      add({
        at: e.startTime,
        host: url.host,
        kind,
        path,
        viaWrapper: false,
        status: e.responseStatus ? e.responseStatus : null,
        out: null,
        in: e.decodedBodySize ? e.decodedBodySize : null,
        url: url.href,
        text: e.name.toLowerCase(),
        warn: own ? "went around this page's request code" : null,
      })
    },

    /** Starts watching for a key (any secret): if it ever appears in a request, in the past or the future, the log flags it. */
    watch(secret: string): void {
      const s = secret.trim().toLowerCase()
      if (s.length < MIN_SECRET || secrets.has(s)) return
      secrets.add(s)
      rows.forEach(flag)
      changed()
    },

    /** The rows as they are shown. What was searched for keys (the addresses, headers and bodies) is kept inside and never handed out. */
    entries: (): Entry[] => rows.map(({ url: _u, text: _t, matched: _m, leaked: _l, ...entry }) => entry),

    summary,
    headline,

    /** A point in time. `since(mark)` then counts the requests that started after it. */
    mark: (): number => clock(),
    since: (mark: number): number => rows.filter((r) => r.at >= mark).length,

    /** Calls `f` after the log changes, once per burst. */
    subscribe(f: () => void): void {
      listeners.push(f)
    },
  }
}
