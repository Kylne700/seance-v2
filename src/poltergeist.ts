// The Poltergeist: a chain-analysis attacker with no keys. It reads only what any stranger can read and tries four tricks to tie payments
// together, plus one more that Tari still allows. Pure and deterministic, so the page and the tests share this file.
//
// The question it is asked: which of these payments were made by the same sender? The answer is known (the demo payments all come from one
// wallet of ours), so each trick can be scored. A trick "ties" a payment when it puts it in the same group as another of our payments
// (groups grow by chaining: if A is tied to B and B to C, all three are one group). It is "mixed up" when its group also holds a
// transaction that is not ours. Amount matching is different in kind: it is handed an amount and has to find the payment.
import type { TxView } from './chain.ts'
import { tari } from './format.ts'

export type TrickId = 'reuse' | 'amount' | 'timing' | 'fee' | 'spend'

/** Payments closer than this in time, in the same epoch window, are tied by the timing trick. Chosen before looking at the results. */
export const GAP_MS = 60_000

/** What one transaction shows in the open, on either ledger. */
export interface Row {
  id: string
  keys: string[] // "signs:<key>" or "pays:<key>": a public key named in the open, tagged with the part it plays
  amount: bigint | null // an amount readable in the open
  at: number | null // created time, ms since 1970
  epoch: number | null // the last epoch the sender allowed
  fee: number | null
  spends: string[] // commitments of the notes it spends (a transparent account ledger has none)
  makes: string[] // commitments of the notes it creates
}

export interface Score {
  tied: number // our payments the trick tied to another of ours (amount matching: found by their amount)
  of: number // our payments
  wrong: number // our payments the trick mixed up with a transaction that is not ours
}

export interface Payment {
  id: string
  to: string
  amount: string // base units, as recorded
}

export interface World {
  payments: Payment[] // the demo payments, in order
  views: TxView[] // the same transactions as the indexer shows them, in the same order
  crowd: TxView[] // recorded transactions that are not ours
  accounts: Record<string, string> // recipient name -> the address it would show on a transparent ledger
}

export interface Report {
  gapMs: number
  of: number // payments
  crowd: number // other people's transactions the Tari side was mixed with
  spanSeconds: number // first to last payment
  fee: number | null // the fee every payment paid, when it was one fee
  rows: { id: TrickId; transparent: Score | null; tari: Score }[] // transparent is null where an account ledger has nothing to read
}

/** "2026-10-18 16:55:51.0" (UTC, as the indexer writes it) to milliseconds. */
export function utcMs(s: string | null): number | null {
  const m = s?.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)/)
  return m ? Date.parse(`${m[1]}T${m[2]}Z`) : null
}

/** A revealed output larger than the fee is an amount paid in the open. Without the fee we cannot tell the two apart. */
export function openAmount(v: TxView): bigint | null {
  if (v.feePaid == null) return null
  const rest = v.statements.reduce((sum, s) => sum + (s.revealedOut ? BigInt(s.revealedOut.amount) : 0n), 0n) - BigInt(v.feePaid)
  return rest > 0n ? rest : null
}

/** What a stranger reads on Tari. */
export const tariRow = (v: TxView): Row => ({
  id: v.id,
  keys: [...v.signers.map((k) => `signs:${k}`), ...v.outputs.flatMap((o) => (o.lockKey ? [`pays:${o.lockKey}`] : [])), ...v.statements.flatMap((s) => (s.revealedOut ? [`pays:${s.revealedOut.receiver}`] : []))],
  amount: openAmount(v),
  at: utcMs(v.createdAt),
  epoch: v.maxEpoch,
  fee: v.feePaid,
  spends: v.statements.flatMap((s) => s.inputCommitments),
  makes: v.outputs.map((o) => o.commitment),
})

/** The same payment on a SYNTHETIC account ledger where sender, receiver and amount are public. Time, epoch window and fee stay as they were. */
export const transparentRow = (v: TxView, p: Payment, account: string): Row => ({
  id: v.id,
  keys: ['signs:the sender', `pays:${account}`],
  amount: BigInt(p.amount),
  at: utcMs(v.createdAt),
  epoch: v.maxEpoch,
  fee: v.feePaid,
  spends: [],
  makes: [],
})

type Linked = (a: Row, b: Row) => boolean

/** The rule of each trick that ties payments in pairs. Amount matching is not one of them: see matchAmounts. */
export const rules = (gapMs: number): Record<Exclude<TrickId, 'amount'>, Linked> => ({
  reuse: (a, b) => a.keys.some((k) => b.keys.includes(k)),
  timing: (a, b) => a.at != null && b.at != null && a.epoch === b.epoch && Math.abs(a.at - b.at) <= gapMs,
  fee: (a, b) => a.fee != null && a.fee === b.fee,
  spend: (a, b) => a.spends.some((c) => b.makes.includes(c)) || b.spends.some((c) => a.makes.includes(c)),
})

/** Group the rows by chaining the pairs a rule ties, then score the groups against the truth (`mine` = the ids that are ours). */
export function score(rows: Row[], mine: ReadonlySet<string>, linked: Linked): Score {
  const parent = rows.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (linked(rows[i], rows[j])) parent[find(i)] = find(j)
  const out: Score = { tied: 0, of: 0, wrong: 0 }
  rows.forEach((r, i) => {
    if (!mine.has(r.id)) return
    out.of++
    const mates = rows.filter((_, j) => j !== i && find(j) === find(i))
    if (mates.some((m) => mine.has(m.id))) out.tied++
    if (mates.some((m) => !mine.has(m.id))) out.wrong++
  })
  return out
}

/** The attacker is handed the amount of each payment, as an invoice or a receipt would, and looks for it. It finds a payment when exactly one row shows that amount. */
export function matchAmounts(rows: Row[], amounts: ReadonlyMap<string, bigint>): Score {
  const out: Score = { tied: 0, of: amounts.size, wrong: 0 }
  for (const [id, amount] of amounts) {
    const hits = rows.filter((r) => r.amount === amount)
    if (hits.length === 1) hits[0].id === id ? out.tied++ : out.wrong++
  }
  return out
}

export function poltergeist(world: World, gapMs = GAP_MS): Report {
  const { payments, views, crowd } = world
  if (views.length !== payments.length) throw new Error('every payment needs its transaction')
  const mine = new Set(payments.map((p) => p.id))
  if (crowd.some((v) => mine.has(v.id))) throw new Error('the crowd must not hold our own payments')
  const amounts = new Map(payments.map((p) => [p.id, BigInt(p.amount)]))
  const tari = [...views, ...crowd].map(tariRow)
  const clear = views.map((v, i) => transparentRow(v, payments[i], world.accounts[payments[i].to] ?? payments[i].to))
  const r = rules(gapMs)
  const times = views.map((v) => utcMs(v.createdAt)).filter((t): t is number => t != null)
  const fees = new Set(views.map((v) => v.feePaid))
  return {
    gapMs,
    of: payments.length,
    crowd: crowd.length,
    spanSeconds: times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : 0,
    fee: fees.size === 1 ? ([...fees][0] ?? null) : null,
    rows: [
      { id: 'reuse', transparent: score(clear, mine, r.reuse), tari: score(tari, mine, r.reuse) },
      { id: 'amount', transparent: matchAmounts(clear, amounts), tari: matchAmounts(tari, amounts) },
      { id: 'timing', transparent: score(clear, mine, r.timing), tari: score(tari, mine, r.timing) },
      { id: 'fee', transparent: score(clear, mine, r.fee), tari: score(tari, mine, r.fee) },
      { id: 'spend', transparent: null, tari: score(tari, mine, r.spend) },
    ],
  }
}

// Words for the page. Every sentence is built from the numbers of the report, so it cannot say more than the table does.

export const TRICKS: Record<TrickId, { name: string; plain: string; how: (gapMs: number) => string }> = {
  reuse: { name: 'Address reuse', plain: 'address reuse', how: () => 'Ties two payments that show the same key as sender or receiver.' },
  amount: { name: 'Amount matching', plain: 'amount matching', how: () => 'Is handed what each payment was for, like an invoice, and looks for that exact amount on the ledger.' },
  timing: { name: 'Timing', plain: 'timing', how: (g) => `Ties payments sent within ${g / 1000} seconds of each other, in the same epoch window.` },
  fee: { name: 'Fee fingerprint', plain: 'the fee fingerprint', how: () => 'Ties payments that paid exactly the same fee.' },
  spend: { name: 'Spend graph (an extra)', plain: 'the spend graph', how: () => 'Ties a payment to the one whose note it spends.' },
}

const list = (xs: string[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const cap = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1)
const verb = (id: TrickId, s: Score): string => `${id === 'amount' ? 'finds' : 'ties'} ${s.tied} of ${s.of}`

/** One sentence per trick on why Tari held or did not. Written for the recorded demo; the tests pin the facts each one leans on. */
export function notes(r: Report): Record<TrickId, string> {
  const t = Object.fromEntries(r.rows.map((x) => [x.id, x.tari])) as Record<TrickId, Score>
  const n = r.of
  const others = (s: Score, none: string): string => (s.wrong === 0 ? `Of the ${r.crowd} other transaction${r.crowd === 1 ? '' : 's'} recorded, none ${none}.` : `${s.wrong} of the ${n} ended up in a group with someone else's transaction.`)
  const open = t.amount.tied
  return {
    reuse:
      t.reuse.tied === 0
        ? 'No key signs two payments and no key is paid twice. That is how this wallet behaved, not a promise: a wallet that reused a key would be tied.'
        : `Some keys repeat, so ${t.reuse.tied} of the ${n} payments are tied. ${others(t.reuse, 'shares a key with them')}`,
    amount:
      open === 0
        ? 'Every amount is sealed, so there is nothing to look up.'
        : `${open === 1 ? 'One payment' : `${open} payments`} paid out in the open, so ${open === 1 ? 'its amount sits' : 'their amounts sit'} on the ledger and the attacker finds ${open === 1 ? 'it' : 'them'}. The other ${n - open} are sealed, so there is nothing to look up.`,
    timing: `${t.timing.tied === n ? `One wallet sent all ${n} within ${r.spanSeconds} seconds, in one epoch window, so the times alone tie them together.` : `The times tie ${t.timing.tied} of the ${n} together.`} ${others(t.timing, 'was close enough in time to join them')}`,
    fee: `${r.fee != null && t.fee.tied === n ? `Every payment paid exactly ${tari(r.fee)}.` : `${t.fee.tied} of the ${n} paid a fee that another payment also paid.`} ${others(t.fee, 'paid it, so it works as a fingerprint')}`,
    spend:
      t.spend.tied === 0
        ? 'No payment spends a note another one made.'
        : `Each payment spends a note an earlier one made, and spent notes are public, so the payments can be followed link by link. This is the "Spent notes" item of the panel above, put to work. ${others(t.spend, 'spends one of their notes')}`,
  }
}

/** The headline under the table. */
export function summary(r: Report): string {
  const full = (s: Score | null): boolean => s != null && s.tied === s.of
  const held = r.rows.filter((x) => !full(x.tari))
  const open = r.rows.filter((x) => full(x.tari))
  const clear = r.rows.filter((x) => x.transparent)
  const onClear = clear.every((x) => full(x.transparent)) ? `On the synthetic transparent ledger each of the ${clear.length} tricks gets all ${r.of}. ` : ''
  const lost = held.length ? `${list(held.map((x) => `${TRICKS[x.id].plain} ${verb(x.id, x.tari)}`))}. ` : ''
  const kept = open.length ? `${cap(list(open.map((x) => TRICKS[x.id].plain)))} still ${open.length === 1 ? 'ties' : 'tie'} all ${r.of}.` : ''
  return `${onClear}On Tari, ${lost}${kept}`.trim()
}
