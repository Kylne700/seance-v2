// Where transactions come from: the live indexer (one request per transaction, never a scan of the chain) or the recorded
// set in ledger.json. The recorded set is imported as a module, so using it needs no request and works with the network blocked.
import { IndexerClient } from '@tari-project/ootle-indexer'
import ledger from '../ledger.json'
import { INDEXER_TIMEOUT_MS, INDEXER_URL, RECENT_LIMIT } from './config.ts'
import { isTxId, ParseError, parseTransaction, type TxView } from './chain.ts'
import type { World } from './poltergeist.ts'

export type Mode = 'live' | 'recorded'
export type Problem = 'bad-id' | 'not-found' | 'not-recorded' | 'format'

export class LookupError extends Error {
  kind: Problem
  constructor(kind: Problem, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface Shown {
  view: TxView
  /** Where THIS answer came from. */
  mode: Mode
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

export function createData(opts: { timeoutMs?: number; pick?: (n: number) => number } = {}) {
  const timeoutMs = opts.timeoutMs ?? INDEXER_TIMEOUT_MS
  const pick = opts.pick ?? ((n: number) => Math.floor(Math.random() * n))
  const client = IndexerClient.usingFetchTransport(INDEXER_URL)
  let mode: Mode = 'live'

  // The SDK has no timeout of its own, so race it against a timer.
  const within = <T>(p: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the indexer did not answer in time')), timeoutMs)
      p.then(resolve, reject).finally(() => clearTimeout(timer))
    })

  async function lookup(raw: string): Promise<Shown> {
    const id = raw.trim().toLowerCase()
    if (!isTxId(id)) throw new LookupError('bad-id', 'A transaction id is 64 hexadecimal characters (0-9 and a-f).')
    let fellBack = false
    let forgotten = false
    if (mode === 'live') {
      try {
        return answer(parseTransaction(await within(client.getTransaction(id))))
      } catch (e) {
        if (e instanceof ParseError) throw new LookupError('format', 'The indexer answered, but this transaction has a shape this page does not know. The explorer can still show it.')
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
        const pool = candidates(withNotes((await within(client.listRecentTransactions({ limit: RECENT_LIMIT, last_id: null, source: null }))).transactions))
        if (pool.length) {
          const view = pool[pick(pool.length)]
          return answer(view, { ours: ourIds.has(view.id) })
        }
        return answer(sample(), { mode: 'recorded', quietChain: true })
      } catch {
        mode = 'recorded'
        fellBack = true
      }
    }
    return answer(sample(), { mode, fellBack })
  }

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
  }
}
