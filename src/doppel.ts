// The Doppelganger: what a copied key reads. Counts only, made in this page on the transactions it already holds.
// Nothing is requested or sent: the window is the recording, the list the page downloaded earlier (if it did), or the one file opened.
// A view key is tried with the page's own reader (listen); the audit key needs no trying, because every note of an audited token is open to it.
import type { TxView } from './chain.ts'
import { SEANCE_RESOURCE } from './config.ts'
import { listen } from './decrypt.ts'
import { amountOf, plural, short } from './format.ts'

export type Source = 'recorded' | 'live' | 'file'

const SLICE_MS = 20 // one turn of counting may take this long; a frame is about 16 ms and a "long task" starts at 50 ms
export const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** The transactions the counts run on: what this page already holds, plus the one on the table. */
export function windowOf(view: TxView, source: Source, held: { recorded: TxView[]; latest: TxView[] }): TxView[] {
  const base = source === 'file' ? [] : source === 'recorded' ? held.recorded : held.latest
  return base.some((v) => v.id === view.id) ? base : [...base, view]
}

/** Where the window comes from, in words. `listed`: the window holds more than the one on the table. */
export const windowWords = (source: Source, listed: boolean): string =>
  source === 'file' ? 'your file' : !listed ? 'the transaction on the table' : source === 'recorded' ? 'the recorded demo payments and the one on the table' : 'the latest transactions this page downloaded and the one on the table'

export interface ViewCount {
  transactions: number
  notes: number // sealed notes in the window
  opened: number // the notes this view key opens
  spent: number // of those, the ones the window shows as spent (the spend graph is public; a spend outside the window is not seen)
  worth: string[] // what the opened notes hold, one entry per token: tokens are never added together
}

/** Try one view key on every sealed note of the window with the page's own reader. Resolves to null if `alive()` went false meanwhile. */
export async function viewCount(secret: string, txs: TxView[], alive: () => boolean): Promise<ViewCount | null> {
  const spentSet = new Set(txs.flatMap((v) => v.statements.flatMap((s) => s.inputCommitments)))
  const totals = new Map<string, bigint>()
  let notes = 0
  let opened = 0
  let spent = 0
  let started = performance.now()
  for (const v of txs) {
    notes += v.outputs.length
    for (const r of await listen(secret, v.outputs)) {
      opened++
      if (spentSet.has(r.output.commitment)) spent++
      totals.set(r.output.resource, (totals.get(r.output.resource) ?? 0n) + r.plain.value)
    }
    if (performance.now() - started > SLICE_MS) {
      await nextTurn()
      if (!alive()) return null
      started = performance.now()
    }
  }
  return { transactions: txs.length, notes, opened, spent, worth: [...totals].map(([resource, value]) => amountOf(resource, value)) }
}

export interface AuditCount {
  resource: string
  audited: number // notes of this token that carry an audit copy
  notes: number // notes of this token in the window
}

/** Per token with at least one audit copy in the window. A pure count: no key is tried and nothing is decrypted, because every audit copy is open to the token's audit key. */
export function auditCounts(txs: TxView[]): AuditCount[] {
  const by = new Map<string, AuditCount>()
  for (const o of txs.flatMap((v) => v.outputs)) {
    const c = by.get(o.resource) ?? { resource: o.resource, audited: 0, notes: 0 }
    c.notes++
    if (o.viewableBalanceProof != null) c.audited++
    by.set(o.resource, c)
  }
  return [...by.values()].filter((c) => c.audited > 0)
}

const TARI_RESOURCE = 'resource_' + '01'.repeat(32)
export const tokenName = (resource: string): string => (resource === SEANCE_RESOURCE ? 'SEANCE' : resource === TARI_RESOURCE ? 'tTARI' : `the token ${short(resource.replace('resource_', ''), 6)}`)

export function viewSentence(c: ViewCount, where: string): string {
  const within = `In ${where} (${plural(c.transactions, 'transaction')}, ${plural(c.notes, 'sealed note')})`
  return c.opened ? `${within}, this key opens ${plural(c.opened, 'note')} worth ${c.worth.join(' and ')}. The window shows ${c.spent} of them as spent.` : `${within}, this key opens none of the notes.`
}

export function auditSentences(counts: AuditCount[], where: string): string[] {
  if (!counts.length) return [`No note in ${where} carries an audit copy, so no audit key opens anything there.`]
  const demoKey = 'The key that opens them is the published demo audit key, the one the Auditor uses.'
  const otherKey = "This page does not hold that token's audit key. The count needs none, because every note of an audited token is open to it."
  return counts.map((c) => `In ${where}, ${c.audited} of the ${plural(c.notes, 'note')} of ${tokenName(c.resource)} ${c.audited === 1 ? 'carries' : 'carry'} an audit copy of the amount. ${c.resource === SEANCE_RESOURCE ? demoKey : otherKey}`)
}

export interface Rung {
  id: 'none' | 'view' | 'audit' | 'spend'
  title: string
  lines: [label: string, text: string][]
}

// What each key opens, does not open, whether it can spend and whether the owner can stop it: the Tari code at v0.46.1 as read for research/80
// (and v0.48.0 where said). "Code reading" means it follows from the code and was not tried.
export const RUNGS: Rung[] = [
  {
    id: 'none',
    title: 'No key',
    lines: [
      ['Opens', 'Only what is public: the token, the spend graph, the fee, the times and the sizes (the list under What still leaks).'],
      ['Does not open', 'Any amount or memo.'],
      ['Can spend', 'No. It holds no key.'],
      ['Can the owner stop it', 'There is no key to stop. What is public stays public.'],
    ],
  },
  {
    id: 'view',
    title: "A recipient's view key, copied",
    lines: [
      ['Opens', "The amount, blinding factor and memo of every note ever sent to that address, including that wallet's own change, past and future until the owner moves to a new account. It also marks which notes are the owner's, so the public spend graph dates each of their spends, and when change comes back to the same address the amount paid out follows by subtraction (code reading)."],
      ['Does not open', "Other people's notes."],
      ['Can spend', 'No: it cannot spend (by the code; not tried). Spending needs a different secret, the account secret.'],
      ['Can the owner stop it', 'For the future only. The owner makes a new account, gives senders the new address and moves the funds there. The copied key still reads every old note and sees the move as a spend of notes it knows.'],
    ],
  },
  {
    id: 'audit',
    title: "A token's audit key, copied",
    lines: [
      ['Opens', 'The amount of every note of that token, past and future, for as long as the token exists.'],
      ['Does not open', 'Memos, blinding factors, or who a note is for.'],
      ['Can spend', 'No: it cannot spend (by the code; not tried), provided it is a fresh key used for nothing else. The demo key is one. A creator who reuses a spending key as the audit key gives that secret away.'],
      ['Can the owner stop it', 'Not within the token. An audit key cannot be changed once the token is made (no such function in the Tari code we read, v0.46.1 and v0.48.0). A holder can only stop holding the token, and that exit is itself visible.'],
    ],
  },
  {
    id: 'spend',
    title: 'A spend (account) key, copied',
    lines: [
      ['Opens', 'Not covered by the Tari code we read for this page.'],
      ['Can spend', 'Yes. Spending a note needs this secret, and it is independent of the view key.'],
      ['Can the owner stop it', 'Not covered by the Tari code we read for this page.'],
      ['This page', 'Never asks for it. The Medium takes a view key and the Auditor uses a published audit key.'],
    ],
  },
]
