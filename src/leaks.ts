// What a stranger can still read from one transaction with no key at all. Pure, and shared by the page and the tests: every value
// is read from the parsed transaction, nothing is looked up or guessed. A caption says what the field shows; none claims a fix.
import type { StealthStatement, TxView } from './chain.ts'
import { amountOf, plural, short, tari, when } from './format.ts'

export type LeakId = 'token' | 'audit' | 'spent' | 'created' | 'revealed' | 'rule' | 'times' | 'epochs' | 'fee' | 'length'

export interface Leak {
  id: LeakId
  term: string
  values: string[] // one line each; empty means this transaction shows nothing of the kind
  mono: boolean // the values are identifiers, shown as code, rather than sentences
  caption: string
}

/** A locked message with no memo is this long: both demo transactions sent without a memo have exactly this size (see the tests). */
export const NO_MEMO_BYTES = 80

/** The revealed output of a statement is the network fee when it equals the fee the transaction paid. */
export const paysFee = (st: StealthStatement, feePaid: number | null): boolean => st.revealedOut != null && feePaid != null && Number(st.revealedOut.amount) === feePaid

function epochWindow(v: TxView): string[] {
  if (v.minEpoch != null && v.maxEpoch != null) return [`Epochs ${v.minEpoch} to ${v.maxEpoch}`]
  if (v.maxEpoch != null) return [`Any epoch up to ${v.maxEpoch}`]
  if (v.minEpoch != null) return [`Epoch ${v.minEpoch} or later`]
  return []
}

export function leaks(v: TxView): Leak[] {
  const many = v.statements.length > 1
  const tag = (n: number): string => (many ? `Private transfer ${n + 1}: ` : '')
  const proven = (s: StealthStatement): number => s.outputs.filter((o) => o.viewableBalanceProof != null).length
  const rules = new Map<string, number>()
  for (const o of v.outputs) rules.set(o.spendCondition, (rules.get(o.spendCondition) ?? 0) + 1)
  return [
    {
      id: 'token',
      term: 'Token (resource address)',
      mono: true,
      values: [...new Set(v.statements.map((s) => s.resource))],
      caption: 'Which token moved is public, even when the amount is sealed.',
    },
    {
      id: 'audit',
      term: 'Audit proofs',
      mono: false,
      values: v.statements.flatMap((s, n) => (proven(s) ? [`${tag(n)}${proven(s)} of ${plural(s.outputs.length, 'sealed note')} ${s.outputs.length === 1 ? 'carries' : 'carry'} an audit proof`] : [])),
      caption: v.statements.some(proven)
        ? "Whoever holds the token's audit key can read the amount of each note that carries a proof. That key cannot spend a note or read its memo."
        : 'None here. A token can be made with an audit key, and then each of its notes carries a proof that only that key opens.',
    },
    {
      id: 'spent',
      term: 'Spent notes (the spend graph)',
      mono: true,
      values: v.statements.flatMap((s) => s.inputCommitments.map((c) => short(c, 12))),
      caption: 'Which earlier notes were spent is public, so anyone can follow a note from one transaction to the next. What was inside them is not.',
    },
    {
      id: 'created',
      term: 'New sealed notes',
      mono: false,
      values: v.statements.map((s, n) => `${tag(n)}${plural(s.outputs.length, 'sealed note')}`),
      caption: 'How many new notes were made is public. Who holds them, and what they hold, is not.',
    },
    {
      id: 'revealed',
      term: 'Amounts in the open',
      mono: false,
      values: v.statements.flatMap((s, n) => [
        ...(s.revealedIn !== '0' ? [`${tag(n)}Taken from a public balance: ${amountOf(s.resource, s.revealedIn)}`] : []),
        ...(s.revealedOut ? [`${tag(n)}Paid out in the open: ${amountOf(s.resource, s.revealedOut.amount)}${paysFee(s, v.feePaid) ? ', the network fee' : ''} (key ${short(s.revealedOut.receiver, 6)})`] : []),
      ]),
      caption: 'Anything moved in or out of a public balance is readable by everyone, unlike the sealed notes.',
    },
    {
      id: 'rule',
      term: 'Spend rule',
      mono: false,
      values: [...rules].map(([kind, n]) => `${kind}: ${plural(n, 'note')}`),
      caption: 'The kind of lock on each note is public. A Key lock means one private key can spend the note.',
    },
    {
      id: 'times',
      term: 'Created and finalized',
      mono: false,
      values: [`Created: ${when(v.createdAt)}`, `Finalized: ${when(v.finalizedAt)}`],
      caption: 'When it was sent and when the network settled it are public. Payments sent in quick succession can be tied together by their times.',
    },
    {
      id: 'epochs',
      term: 'Epoch window',
      mono: false,
      values: epochWindow(v),
      caption: 'The span of network epochs the sender allowed is public. One wallet sending in one sitting tends to leave the same window every time.',
    },
    {
      id: 'fee',
      term: 'Fee',
      mono: false,
      values: [v.feePaid == null ? 'Not known without a summary' : tari(v.feePaid)],
      caption: 'The fee is paid in the open. A wallet that always pays the same fee has a habit anyone can see.',
    },
    {
      id: 'length',
      term: 'Locked message size',
      mono: false,
      values: v.outputs.map((o, i) => `Note ${i + 1}: ${o.ciphertextBytes} bytes, ${o.ciphertextBytes <= NO_MEMO_BYTES ? 'no memo' : 'a memo is inside'}`),
      caption: `The size of the locked message is public. A note with no memo is ${NO_MEMO_BYTES} bytes. More means a memo is inside, and the size hints at how long it is.`,
    },
  ]
}
