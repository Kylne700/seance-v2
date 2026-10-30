// The Revenant: what a computer that can solve discrete logarithms would read from public data ("harvest now, decrypt later").
// A fixed table, read against the fields this transaction really holds, and a labelled simulation on the demo payments only.
// The facts are those of research/80: the Tari code at v0.46.1 (code reading, not run) and the papers named in the README. This page says nothing about when or whether such a computer will exist.
import { audited, audit, type Heard } from './auditor.ts'
import type { TxView } from './chain.ts'
import { listen, type Reading } from './decrypt.ts'
import { plural } from './format.ts'

/** The words on the label of every simulated value. */
export const SIMULATION =
  "Simulation. We use the demo keys we published in place of a computer that can solve discrete logarithms. Such a computer could be, for example, a large quantum computer running Shor's algorithm; this page does not say when or whether one will exist."

export const INTRO =
  'Harvest now, decrypt later: everything on the chain is public data, and it can be kept. Suppose a computer that can solve discrete logarithms (for example a large quantum computer) reads what was kept. This is what it would read from this transaction.'

const both = (n: number, one: string, many: string): string => (n === 1 ? one : many)

export interface Tier {
  n: 1 | 2 | 3
  says: string
  here: string // how the tier applies to the transaction on the table
}

export function tiers(v: TxView): Tier[] {
  const notes = v.outputs.length
  const proven = audited(v.outputs).length
  const sealed = plural(notes, 'sealed note')
  return [
    {
      n: 1,
      says: 'Chain data only, for a token without an audit key: amounts and memos stay hidden. What is public today (the spend graph, the fee, the times, the sizes) stays public.',
      here: !notes ? 'This transaction seals no note, so it holds no amount or memo for this tier.' : proven === notes ? 'Every sealed note here carries an audit copy, so this tier does not hold for its amount (see tier 3). Its memo stays hidden from chain data alone.' : `${notes - proven} of the ${sealed} here ${both(notes - proven, 'has', 'have')} no audit copy: from chain data alone, ${both(notes - proven, 'its amount and memo stay', 'their amounts and memos stay')} hidden.`,
    },
    {
      n: 2,
      says: "Chain data plus the recipient's address, posted anywhere (a forum, a donation page, an invoice): every note ever sent to that address can be read, with its amount, blinding factor and memo. The tag and the lock key point to exactly those notes.",
      here: notes ? `If the address of whoever received ${both(notes, 'this sealed note', `these ${sealed}`)} is posted anywhere, that computer would read ${both(notes, 'its', 'their')} amount, blinding factor and memo, and those of every other note sent to that address.` : 'No sealed note here.',
    },
    {
      n: 3,
      says: 'An audited token: every note must carry a copy of its amount, and the key that opens it is on the chain. One solved key opens every amount of the token, past and future. After that, each note needs only the amount search the Auditor already does. The SEANCE demo token is such a token.',
      here: proven ? `${proven} of the ${sealed} here ${both(proven, 'carries', 'carry')} an audit copy. That computer would read ${both(proven, 'its amount', 'their amounts')} from public data alone.` : 'No note here carries an audit copy, so this tier does not reach this transaction.',
    },
  ]
}

export interface Field {
  name: string
  what: string
  alone: string // what that computer reads from chain data only
  withAddress: string // what it adds if it also knows the recipient's address
}

/** One row per kind of field this transaction holds. A field this page does not parse (range proof, tag, balance proof) is listed because the Tari code puts it in every private transfer. */
export function fields(v: TxView): Field[] {
  const rows: Field[] = []
  if (v.outputs.length)
    rows.push(
      { name: 'Commitment', what: 'Hides the amount. A Pedersen commitment, perfectly hiding.', alone: 'Nothing. Every amount fits it with some blinding factor.', withAddress: 'Nothing more from this field.' },
      { name: 'Range proof', what: 'Shows the hidden amount is in range. Bulletproofs+, one for all the notes of a transfer. Its authors prove it perfect honest-verifier zero-knowledge. This page does not read it.', alone: "Nothing. By that proof it adds nothing about the amount, even to an attacker with unlimited power (Tari's code was not audited here).", withAddress: 'Nothing more.' },
      { name: 'Locked message', what: "The amount, blinding factor and memo, encrypted to the recipient's view key. That key is in the recipient's address, not on the chain.", alone: 'Nothing.', withAddress: 'The amount, blinding factor and memo of every note sent to that address, past and future.' },
      { name: "Sender's one-time key", what: 'Fresh for each note, in the open. The recipient needs it to open the note.', alone: "The sender's secret for that note. It opens nothing without the recipient's view key or account key.", withAddress: 'It is what opens the note.' },
      { name: 'Tag', what: 'Four bytes, made from the sender secret, the recipient view key and the token. This page does not read it.', alone: 'Nothing.', withAddress: "A fast filter that finds exactly that address's notes." },
    )
  if (v.outputs.some((o) => o.lockKey != null))
    rows.push({ name: 'Lock key', what: "A one-time public key for each note, made from the recipient's account key. The note can be spent with the secret behind it.", alone: 'The one-time secret of each note (see the separate lines below). If the account key is on the chain, it links the note to that account.', withAddress: 'Links every note to that address exactly.' })
  if (audited(v.outputs).length)
    rows.push({ name: 'Audit copy', what: "The amount, encrypted to the token's audit key. That key's public half is on the chain, in the token.", alone: 'Every amount of the token, past and future. Then each blinding factor too.', withAddress: 'The same.' })
  if (v.statements.length) rows.push({ name: 'Balance proof', what: 'A signature that the amounts add up. This page does not read it.', alone: 'The excess of the blinding factors. No amount by itself (code reading).', withAddress: 'Nothing more.' })
  rows.push({ name: 'Already public', what: 'The token, the spend graph, amounts moved in or out of a public balance and their receiver, the fee, the times, the epochs, the minimum value, the length of the locked message and the signers.', alone: 'Public today. That computer adds nothing to read.', withAddress: 'Public today.' })
  return rows
}

/** Lines that are not about reading. Kept apart from the list of who can read. */
export function separate(v: TxView): string[] {
  const locks = v.outputs.filter((o) => o.lockKey != null).length
  return [
    ...(locks ? [`Notes not yet spent could be spent. ${plural(locks, 'note')} here ${both(locks, 'has', 'have')} a lock key in the open, and that computer could work out the one-time secret behind ${both(locks, 'it', 'each')} (code reading, not tried). Which notes are spent is public: the spend graph shows it.`] : []),
    'Broken binding. It could open a commitment to any amount, so an opening or a receipt proves nothing after that point. Range proofs fail the same way: it could make one that passes for an amount outside the range.',
    ...(v.signers.length ? [`Signatures. This transaction names ${plural(v.signers.length, 'signer key')} in the open, and that computer could forge a signature for each.`] : []),
  ]
}

export interface Simulation {
  reads: Reading[] // what the demo view key opens, standing in for the solved view key
  counts: Heard[] | null // what the demo audit key opens, standing in for the solved audit key; null when no note carries an audit copy
}

/** Through the page's own readers. Only for the demo payments, with the demo keys the repository publishes: the caller decides that, nothing here looks at what the transaction is. */
export async function simulate(v: TxView, keys: { view: string; audit: string }, alive: () => boolean): Promise<Simulation | null> {
  const reads = await listen(keys.view, v.outputs)
  if (!alive()) return null
  if (!audited(v.outputs).length) return { reads, counts: null }
  const counts = await audit(keys.audit, v.outputs, { alive, progress: () => {} })
  return counts && alive() ? { reads, counts } : null
}

/** The demo keys that stand in for the solved keys, or null when the transaction is not one of our demo payments: then nothing is simulated and no value is shown. */
export function standIns(v: TxView, demos: { id: string; to: string }[], keys: Record<string, { viewSecret: string }>): { view: string; audit: string } | null {
  const view = keys[demos.find((d) => d.id === v.id)?.to ?? '']?.viewSecret
  const auditKey = keys.auditor?.viewSecret
  return view && auditKey ? { view, audit: auditKey } : null
}
