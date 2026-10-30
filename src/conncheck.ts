// The connection check: one GET to the indexer's front door (Cloudflare), made when the visitor presses the button and never otherwise.
// Cloudflare answers /cdn-cgi/trace with plain `key=value` lines. They include the visitor's IP address and country, so this file reads the one line
// named `kex` (the key exchange the browser's TLS connection to Cloudflare used) and drops the rest at once: nothing else is shown, kept or logged.
// No DOM in here, so it is tested on its own; main.ts connects it to the button.
import { INDEXER_TIMEOUT_MS, INDEXER_URL } from './config.ts'

export const TRACE_PATH = '/cdn-cgi/trace'
export const TRACE_URL = INDEXER_URL + TRACE_PATH

/** The one hybrid post-quantum group the page names. A different hybrid (an older draft, say) is "unknown" here, never described. */
const HYBRID = 'X25519MLKEM768'
/** Classical groups, spelled as Cloudflare documents them for its ClientTLSKeyExchangeGroup log field (research/80 section 4). Any other value is "unknown", never "classical". */
const CLASSICAL = new Set(['X25519', 'P-256'])

const HYBRID_TEXT =
  "Your browser's connection to the indexer's front door (Cloudflare) used X25519MLKEM768: X25519 combined with ML-KEM-768. ML-KEM is NIST's quantum-resistant key-establishment standard, so a recording of this connection is meant to stay unreadable even to a future quantum computer ('store now, decrypt later'). This covers only that connection. It does not change what the chain makes public, and it does not cover the link from Cloudflare to the indexer."
const UNKNOWN_TEXT = 'Cloudflare did not say which key exchange this connection used.'
const NO_ANSWER_TEXT = 'The check got no answer, so this page cannot say which key exchange this connection used.'

/** The value of the `kex` line, or null when there is none. Every other line of the body is ignored. */
export function parseKex(body: string): string | null {
  const line = /^kex=(.*)$/m.exec(body)
  return line ? line[1].trim() : null
}

/** The sentence to show. It is built from fixed text: a value Cloudflare sent is compared, never copied onto the page. */
export function kexMessage(kex: string | null): string {
  if (kex === HYBRID) return HYBRID_TEXT
  if (kex !== null && CLASSICAL.has(kex)) return `Your browser used a classical key exchange (${kex}) for this connection.`
  return UNKNOWN_TEXT
}

/**
 * Makes the one request and returns the sentence to show. `doFetch` defaults to the page's fetch as it is when this is called, not when the file loads:
 * main.ts replaces it with the ghost log's wrapper, and the request must go through that so it shows in the log.
 */
export async function checkConnection(doFetch: typeof fetch = globalThis.fetch): Promise<string> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), INDEXER_TIMEOUT_MS)
  try {
    const res = await doFetch(TRACE_URL, { cache: 'no-store', signal: stop.signal })
    if (!res.ok) return NO_ANSWER_TEXT
    return kexMessage(parseKex(await res.text()))
  } catch {
    return NO_ANSWER_TEXT
  } finally {
    clearTimeout(timer)
  }
}
