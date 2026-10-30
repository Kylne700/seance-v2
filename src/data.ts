// Where transactions come from: the live indexer (never a scan of the chain), the recorded set in ledger.json, or a file the visitor opens.
// Summon and a lookup both start from the indexer's list of latest transactions, one request that is the same for every visitor and names no id.
// A lookup reads its id out of that list. It asks the indexer for an id by itself only when the visitor says so, or when the id is one of our demos. A file asks nobody.
// The recorded set is imported as a module, so using it needs no request and works with the network blocked.
import { IndexerClient, transports } from '@tari-project/ootle-indexer'
import ledger from '../ledger.json'
import { INDEXER_TIMEOUT_MS, INDEXER_URL, LIST_KEPT_MS, MAX_FILE_BYTES, RECENT_LIMIT } from './config.ts'
import { isTxId, ParseError, parseTransaction, type TxView } from './chain.ts'
import { plural } from './format.ts'
import type { World } from './poltergeist.ts'

export type Mode = 'live' | 'recorded'
export type Problem = 'bad-id' | 'not-found' | 'not-recorded' | 'format' | 'not-listed'

export class LookupError extends Error {
  kind: Problem
  constructor(kind: Problem, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface Shown {
  view: TxView
  /** Where THIS answer came from: the live indexer, the recording, or a file the visitor opened. */
  mode: Mode | 'file'
  /** This very call found the indexer unusable and switched the page to recorded data. */
  fellBack: boolean
  /** The indexer is up but answered 404 for a transaction we hold a recording of: it no longer holds it (history dropped, or the testnet was reset). Only THIS answer is the saved copy. The page stays live, and the next call asks the indexer again. */
  forgotten: boolean
  /** Live was up but had no private transfer among the latest transactions, so a recorded one was used. */
  quietChain: boolean
  /** Summon found nobody else's private transfer, so this is one of the transactions we sent for this page. */
  ours: boolean
  /** The page's starting example: shown from the recording before anything was asked of the indexer. */
  preview: boolean
  /** Read from the indexer's list of latest transactions, so no transaction id was sent. `size` is how many it listed; `found` means the visitor's id was in it, otherwise Summon picked from it. */
  list?: { size: number; found: boolean }
}

const answer = (view: TxView, o: Partial<Shown> = {}): Shown => ({ view, mode: 'live', fellBack: false, forgotten: false, quietChain: false, ours: false, preview: false, ...o })

export interface DemoKey {
  label: string
  viewSecret: string
}
export interface Demo {
  n: number
  id: string
  to: string
  kind: 'blinded' | 'revealed' | 'audited'
}

// Every key the cards can be handed. The auditor's is published on purpose like the others (testnet only): it is a view key and cannot spend.
export const demoKeys: Record<string, DemoKey> = {
  ...(ledger.keys as Record<string, DemoKey>),
  auditor: { label: "The auditor (holds the demo token's audit key)", viewSecret: ledger.auditor.secret },
}
/** Bob's address: where the page's "Send the Seance a secret" payment goes. His view key is one of demoKeys. */
export const bobAddress: string = ledger.keys.bob.address
// The prepared transactions: the ones paid in the demo token, which has an audit key (all three ghosts have something to read), then the TARI demos.
const heroes = ledger.hero as { id: string; to: string }[]
const tariDemos = ledger.txs as { id: string; to: string; kind: string }[]
export const demos: Demo[] = [
  ...heroes.map((t, i) => ({ n: i + 1, id: t.id, to: t.to, kind: 'audited' as const })),
  ...tariDemos.map((t, i) => ({ n: heroes.length + i + 1, id: t.id, to: t.to, kind: t.kind === 'revealed' ? ('revealed' as const) : ('blinded' as const) })),
]
// Every recorded answer was taken on this UTC day (the demos were made between 20:27 and 20:58 UTC and the ledger was committed at 21:38 UTC); a test keeps that true.
export const savedOn: string = ledger.recent.capturedAt.slice(0, 10)

// Every transaction we sent for this page (the prepared demos, and the setup behind them). Summon never passes these off as a stranger's.
const sent = ledger as unknown as { txs: { id: string }[]; earlier?: { id: string }[]; hero?: { id: string }[]; setup?: { id: string }[] }
export const ourIds: ReadonlySet<string> = new Set([...sent.txs, ...(sent.earlier ?? []), ...(sent.hero ?? []), ...(sent.setup ?? [])].map((t) => t.id))

const recorded = new Map<string, unknown>([
  ...ledger.txs.map((t) => [t.id, t.reply] as const),
  ...ledger.hero.map((t) => [t.id, t.reply] as const),
  ...ledger.recent.transactions.map((t) => [t.transaction_id, t] as const),
])

const demoIds: ReadonlySet<string> = new Set(demos.map((d) => d.id))
const idOf = (item: unknown): unknown => (item as { transaction_id?: unknown } | null)?.transaction_id
const unreadable = (): LookupError => new LookupError('format', 'The indexer answered, but this transaction has a shape this page does not know. The explorer can still show it.')

/** Transactions that have at least one sealed note, in the order given. Entries this page cannot read are skipped. */
function withNotes(items: unknown[]): TxView[] {
  return items.flatMap((item) => {
    try {
      const view = parseTransaction(item)
      return view.outputs.length ? [view] : []
    } catch {
      return []
    }
  })
}

/** What the Poltergeist reads: the demo payments with their transactions, and the recorded transactions that are not ours (the crowd). */
export function recordedWorld(): World {
  return {
    payments: ledger.txs.map((t) => ({ id: t.id, to: t.to, amount: t.amount })),
    views: ledger.txs.map((t) => parseTransaction(t.reply)),
    crowd: withNotes(ledger.recent.transactions).filter((v) => !ourIds.has(v.id)),
    accounts: Object.fromEntries(Object.entries(ledger.keys).map(([name, k]) => [name, k.address])),
  }
}

/** What Summon may show: a stranger's transaction before one of ours, a settled one before one that is not. Empty when there is nothing. */
function candidates(views: TxView[]): TxView[] {
  const settled = (vs: TxView[]): TxView[] => vs.filter((v) => v.outcome === 'Commit') // a rejected or unsettled one makes a poor first impression
  const theirs = views.filter((v) => !ourIds.has(v.id))
  const ours = views.filter((v) => ourIds.has(v.id))
  return [settled(theirs), theirs, settled(ours), ours].find((pool) => pool.length) ?? []
}

/** Network error, timeout, 5xx or throttling: the indexer is unusable, so recorded data takes over. */
const indexerDown = (e: unknown): boolean => {
  const status = (e as { status?: unknown } | null)?.status
  return typeof status !== 'number' || status >= 500 || status === 429
}

/**
 * The indexer lets a browser keep its list of latest transactions for 30 s (its `Cache-Control` says `max-age=30`), so with 20 s between two looks every second look could come from the browser's own cache.
 * The SDK hands the request it builds on to fetch as it is, so `cache: 'no-store'` on it makes the browser ask the indexer.
 */
class NoStoreTransport extends transports.FetchTransport {
  override sendRequest<T>(path: string, request: Parameters<transports.FetchTransport['sendRequest']>[1], options?: transports.TransportOptions): Promise<T> {
    const asked = { ...request, cache: 'no-store' as const }
    return super.sendRequest<T>(path, asked, options)
  }
}

export function createData(opts: { timeoutMs?: number; pick?: (n: number) => number; now?: () => number } = {}) {
  const timeoutMs = opts.timeoutMs ?? INDEXER_TIMEOUT_MS
  const pick = opts.pick ?? ((n: number) => Math.floor(Math.random() * n))
  const now = opts.now ?? Date.now
  const client = IndexerClient.usingFetchTransport(INDEXER_URL)
  const noStoreClient = IndexerClient.new(new NoStoreTransport(INDEXER_URL)) // for the payment watch's looks: the same requests, but the browser must ask the indexer for each
  let mode: Mode = 'live'

  // The SDK has no timeout of its own, so race it against a timer.
  const within = <T>(p: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the indexer did not answer in time')), timeoutMs)
      p.then(resolve, reject).finally(() => clearTimeout(timer))
    })

  // The list of latest transactions: one request that is the same for every visitor and every lookup, so it says nothing about which id is wanted.
  // Summon picks from it and a lookup looks in it first. One copy is kept for a minute so the two share a request; a failed request is not kept.
  let held: { at: number; items: Promise<unknown[]> } | null = null
  // `fresh`: the request is made again, whatever is kept and whatever the browser has cached. The payment watch (findNote) uses it, so that a kept copy (up to 60 s old) or a cached answer (up to 30 s old) cannot hide a new payment.
  const listing = (fresh = false): Promise<unknown[]> => {
    if (!fresh && held && now() - held.at < LIST_KEPT_MS) return held.items
    const items = within((fresh ? noStoreClient : client).listRecentTransactions({ limit: RECENT_LIMIT, last_id: null, source: null })).then((l) => {
      if (!Array.isArray(l.transactions)) throw new Error('the indexer gave no list of transactions') // an answer that is no list counts as no answer, as it always did for Summon
      return l.transactions as unknown[]
    })
    const mine = { at: now(), items }
    held = mine
    items.catch(() => {
      if (held === mine) held = null
    })
    return items
  }

  /** `askAnyway`: the visitor chose to tell the indexer which id they want, so it is asked for by id without looking in the list first. */
  async function lookup(raw: string, o: { askAnyway?: boolean } = {}): Promise<Shown> {
    const id = raw.trim().toLowerCase()
    if (!isTxId(id)) throw new LookupError('bad-id', 'A transaction id is 64 hexadecimal characters (0-9 and a-f).')
    let fellBack = false
    let forgotten = false
    // Crowd first: look for the id in the list everybody asks for. An id that is not in it is not asked for until the visitor says so.
    // Our demos are the exception: they are our own public transactions, and are asked for by id as before.
    if (mode === 'live' && !o.askAnyway && !demoIds.has(id)) {
      const items = await listing().catch((): null => null)
      if (items === null) {
        // The list is the same kind of request as Summon's: if it cannot be had the indexer is unusable, and recorded data takes over with nothing about the id sent.
        mode = 'recorded'
        fellBack = true
      } else {
        const found = items.find((t) => idOf(t) === id)
        if (!found) throw new LookupError('not-listed', `This id is not among the indexer's latest ${plural(items.length, 'transaction')}. Asking the indexer for it by id would show it this id, together with your IP address and the time.`)
        try {
          return answer(parseTransaction(found), { list: { size: items.length, found: true } })
        } catch (e) {
          throw e instanceof ParseError ? unreadable() : e
        }
      }
    }
    if (mode === 'live') {
      try {
        return answer(parseTransaction(await within(client.getTransaction(id))))
      } catch (e) {
        if (e instanceof ParseError) throw unreadable()
        const status = (e as { status?: number }).status
        // A 404 on an id we hold a recording of means the indexer dropped it (or the testnet was reset): that is what the recording is for.
        // It is no outage, so only this answer comes from the recording. The page stays live, and an id we hold nothing for still gets the indexer's own answer.
        forgotten = status === 404 && recorded.has(id)
        if (status === 404 && !forgotten) throw new LookupError('not-found', 'The indexer does not know this transaction id on Esmeralda. The public indexer drops old history, so an old id may be gone.')
        if (!indexerDown(e) && !forgotten) throw new LookupError('bad-id', 'The indexer did not accept this id.')
        if (!forgotten) {
          mode = 'recorded'
          fellBack = true
        }
      }
    }
    const reply = recorded.get(id)
    if (!reply) {
      // The page switched by itself just now, so the visitor must be told why before being told what recorded mode holds.
      throw new LookupError('not-recorded', fellBack ? 'The indexer did not answer, and this id is not among the recorded transactions (the demos and a small sample). Switch to live data to try again.' : 'Recorded mode only knows the demo transactions and a small sample. Switch to live data to look up any other id.')
    }
    return answer(parseTransaction(reply), { mode: 'recorded', fellBack, forgotten })
  }

  /** A transaction the visitor saved from an indexer (its answer for one transaction), opened from a file. Asks nobody. */
  async function fromFile(file: Blob): Promise<Shown> {
    if (file.size > MAX_FILE_BYTES) throw new LookupError('format', `That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. One transaction is a few KB: open the indexer's answer for a single transaction.`)
    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      throw new LookupError('format', "That file is not JSON. Open the indexer's answer for one transaction, saved as it came (the README says how).")
    }
    try {
      return answer(parseTransaction(json), { mode: 'file' })
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      const list = Array.isArray((json as { transactions?: unknown } | null)?.transactions)
      throw new LookupError('format', list ? "That file is a list of transactions. Open the indexer's answer for a single transaction." : "That file is JSON, but it is not the indexer's answer for one transaction.")
    }
  }

  /** The page's starting example, demo 1, from the recording. It asks nobody, so a dropped id or a blocked network cannot spoil the first screen. */
  const example = (): Shown => answer(parseTransaction(recorded.get(demos[0].id)), { mode: 'recorded', preview: true })

  async function recent(): Promise<Shown> {
    const sample = (): TxView => {
      const pool = candidates(withNotes(ledger.recent.transactions))
      return pool[pick(pool.length)]
    }
    let fellBack = false
    if (mode === 'live') {
      try {
        const items = await listing()
        const pool = candidates(withNotes(items))
        if (pool.length) {
          const view = pool[pick(pool.length)]
          return answer(view, { ours: ourIds.has(view.id), list: { size: items.length, found: false } })
        }
        return answer(sample(), { mode: 'recorded', quietChain: true })
      } catch {
        mode = 'recorded'
        fellBack = true
      }
    }
    return answer(sample(), { mode, fellBack })
  }

  /**
   * The visitor's own payment, found in the list by the commitment of its note. No transaction id is asked of any indexer, here or anywhere: the list is the same
   * request Summon makes. Null when the payment is not in the list (yet). It does not switch the page to recorded data when the list cannot be had: that is for the caller to say.
   */
  async function findNote(commitment: string, o: { fresh?: boolean } = {}): Promise<Shown | null> {
    if (mode !== 'live') throw new LookupError('not-recorded', 'This page is showing recorded data and does not ask the indexer. Press the button again to go back to live data.')
    const want = commitment.toLowerCase()
    const items = await listing(o.fresh)
    for (const item of items) {
      let view: TxView
      try {
        view = parseTransaction(item)
      } catch {
        continue // an entry this page cannot read cannot be the payment it is looking for
      }
      if (view.outputs.some((out) => out.commitment === want)) return answer(view, { list: { size: items.length, found: true } })
    }
    return null
  }

  /** The list this page downloaded last, if it has, read the same way as Summon reads it. Asks nobody: with no list yet the answer is empty. */
  const latest = async (): Promise<TxView[]> => (held ? withNotes(await held.items.catch((): unknown[] => [])) : [])

  return {
    get mode(): Mode {
      return mode
    },
    setMode(m: Mode): void {
      mode = m
    },
    lookup,
    recent,
    example,
    fromFile,
    findNote,
    latest,
  }
}
