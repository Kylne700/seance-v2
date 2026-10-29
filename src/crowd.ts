// Asking in a crowd. A lookup names one transaction to the indexer, so the page asks for that id together with up to 7 others
// taken from the indexer's own list of latest transactions: the same request for each, all at once, in a random order.
// This file only decides WHO is asked about, and what the page may truthfully say about it. data.ts makes the requests.
import { isTxId } from './chain.ts'
import { plural } from './format.ts'

/** How many others travel with the id you care about. */
export const DECOYS = 7

export interface CrowdFacts {
  /** How many ids were asked for in one go, yours included. 1 means yours went alone. */
  size: number
  /** Your id is one of the indexer's latest transactions, so it looks like the others. If not, it is the odd one out. */
  inWindow: boolean
  /** How many different ids the indexer's list held. */
  listed: number
  /** About how many minutes that list spans, newest to oldest. null when the list carries no times. */
  spanMinutes: number | null
}

/** An unbiased whole number from 0 to n-1, from the browser's secure random source. */
export function secureInt(n: number): number {
  const range = 0x1_0000_0000
  const limit = range - (range % n) // draws at or above this would favour the small numbers
  const one = new Uint32Array(1)
  do crypto.getRandomValues(one)
  while (one[0] >= limit)
  return one[0] % n
}

/** Fisher-Yates, in place. */
function shuffle<T>(xs: T[], pick: (n: number) => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = pick(i + 1)
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
  return xs
}

const idOf = (item: unknown): string | null => {
  const id = (item as { transaction_id?: unknown } | null)?.transaction_id
  return typeof id === 'string' && isTxId(id) ? id : null
}

// The indexer writes "2026-10-29 17:21:20.0", in UTC.
const timeOf = (item: unknown): number => Date.parse(`${String((item as { created_at?: unknown } | null)?.created_at ?? '').replace(' ', 'T')}Z`)

/**
 * `listed` is the `transactions` array of the indexer's recent list. Returns the ids to ask for, the target exactly once and the rest chosen at random from the list,
 * in a random order, plus what the page may say about it. A short or empty list gives a smaller crowd (down to the target alone). Anything in the list that is not
 * a transaction id is ignored.
 */
export function planCrowd(target: string, listed: unknown, pick: (n: number) => number = secureInt, decoys = DECOYS): { order: string[]; facts: CrowdFacts } {
  const items = Array.isArray(listed) ? listed : []
  const ids = [...new Set(items.map(idOf).filter((x): x is string => x !== null))]
  const others = shuffle(
    ids.filter((x) => x !== target),
    pick,
  ).slice(0, decoys)
  const order = shuffle([target, ...others], pick)
  const times = items.map(timeOf).filter(Number.isFinite)
  const span = times.length > 1 ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60_000)) : null
  return { order, facts: { size: order.length, inWindow: ids.includes(target), listed: ids.length, spanMinutes: span } }
}

/** What the indexer saw, in words. Every number comes from the lookup that just happened. */
export function crowdLine(f: CrowdFacts): string {
  const latest = `the indexer's latest ${plural(f.listed, 'transaction')}${f.spanMinutes === null ? '' : ` (about ${plural(f.spanMinutes, 'minute')} of traffic)`}`
  const sees = `The indexer sees your IP address, the time and the ${f.size} ids`
  if (f.size === 1) return `Your id went alone: ${f.listed === 0 ? "the indexer's list of latest transactions was empty" : 'there was no other id in its list to hide it among'}. The indexer sees your IP address, the time and which id you asked for.`
  if (!f.inWindow) return `Your id is not among ${latest}, so of the ${f.size} ids it was asked for it is the odd one out, and the indexer can tell which one you came for. ${sees}. Decoys only hide a fresh transaction.`
  return `Your id was asked for together with ${plural(f.size - 1, 'other')} from ${latest}, all at once in random order. ${sees}, and cannot tell which one you came for: 1 in ${f.size} is the best it can do for one lookup. Ask again and it gets a new set that it can compare with this one.`
}
