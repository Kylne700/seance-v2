// Turns parsed data into DOM. Everything that comes from the chain (ids, hex, memos) goes in as text, never as HTML.
import { RANGE_MAX, type Heard } from './auditor.ts'
import type { StealthOutput, StealthStatement, TxView } from './chain.ts'
import { explorerTx, LEDGER_URL, mirrorTx, receiptTx } from './config.ts'
import { savedOn, type Shown } from './data.ts'
import type { Reading } from './decrypt.ts'
import { clear, h } from './dom.ts'
import { amountOf, baseUnits, outcomeLabel, plural, short, tari, theOther, when } from './format.ts'
import { leaks, paysFee, type Leak } from './leaks.ts'
import { notes, summary, TRICKS, type Report, type Score, type TrickId } from './poltergeist.ts'

const MAX_NOTES = 6 // a transaction with more sealed notes than this is cut here, and says so

const KIND_CAPTION: Record<string, string> = {
  StealthTransfer: 'The private transfer: spends old sealed notes and creates new ones.',
  PutLastInstructionOutputOnWorkspace: 'Keeps the revealed funds at hand for the next step.',
  TakeFromBucket: 'Splits a public amount off the revealed funds.',
  PayFeeFromBucket: 'Pays the network fee, in the open.',
  CreateAccount: 'Opens a public account for a receiver.',
  CallMethod: 'Calls a component, for example to take the fee funds out of a public account.',
}

const fact = (term: string, ...value: (Node | string)[]): HTMLElement => h('div', { class: 'fact' }, h('dt', null, term), h('dd', null, ...value))
const caption = (text: string): HTMLElement => h('p', { class: 'caption' }, text)
const hex = (value: string): HTMLElement => h('code', { class: 'hex' }, value)
const bytes = (term: string, value: string, text: string): HTMLElement => h('div', { class: 'bytes' }, h('p', { class: 'term' }, term), hex(value), caption(text))

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)
const OUTCOME_CAPTION: Record<string, string> = {
  Commit: 'The network accepted it.',
  FeeIntentCommit: 'Only the fee went through. The rest of the transaction was aborted.',
}
function outcomeFact(v: TxView): HTMLElement {
  const text = v.outcome ? OUTCOME_CAPTION[v.outcome] : v.rejectedReason ? clip(v.rejectedReason, 240) : 'It has no summary yet, so the network has not settled it.'
  return fact('Outcome', outcomeLabel(v), caption(text ?? ''))
}

const newTab = (): HTMLElement => h('span', { class: 'sr-only' }, ' (opens in a new tab)')
export const outLink = (href: string, text: string, cls = 'btn ghost'): HTMLElement => h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, text, newTab())

/**
 * The links beside an answer, so a visitor can check it without trusting this page. The explorer reads the same indexer as the page, so it only helps while
 * that indexer holds the transaction. A recorded answer points at the raw answer of Tari's second public indexer, at the recording itself and, last, at the first
 * indexer's receipt. The Medium card shows only the first link, so a new link goes at the end.
 */
export function proofLinks(s: Shown): HTMLElement[] {
  return s.mode === 'live'
    ? [outLink(explorerTx(s.view.id), 'Open in the explorer')]
    : [outLink(mirrorTx(s.view.id), 'Raw answer from a second public indexer'), outLink(LEDGER_URL, 'The saved copy (ledger.json)'), outLink(receiptTx(s.view.id), 'Receipt from the first public indexer')]
}

/** The one line that says where the Stranger's answer came from. */
function sourceLine(s: Shown): string {
  if (s.mode === 'live') return 'Live: read from the indexer just now.'
  if (s.preview) return `Recorded: the page's starting example, a copy saved on ${savedOn}. Nothing was asked of the indexer.`
  if (s.forgotten) return `Recorded: the public indexer no longer holds this transaction, so this is the copy saved on ${savedOn}.`
  return `Recorded: a saved copy of the indexer's answer, taken on ${savedOn}.`
}

// On a phone the sealed notes start closed, so the page does not bury the medium under screens of hex. Keep 960 in step with style.css.
const wide = (): boolean => window.matchMedia('(min-width: 960px)').matches

function note(o: StealthOutput, i: number, total: number): HTMLElement {
  return h(
    'details',
    wide() ? { class: 'note', open: '' } : { class: 'note' },
    h('summary', null, `Sealed note ${i + 1} of ${total}`, h('span', { class: 'peek' }, `${o.ciphertextBytes} bytes`)),
    bytes('Commitment', o.commitment, 'A sealed number that locks the amount. The network can check the books add up without ever seeing it.'),
    bytes('One-time key', o.senderNonce, "Made fresh for this note. It is not an address. With the recipient's view key it opens the note."),
    h(
      'details',
      { class: 'bytes' },
      h('summary', null, 'The locked message ', h('span', { class: 'peek' }, short(o.ciphertext, 10))),
      hex(o.ciphertext),
      caption(`This is the ciphertext, ${o.ciphertextBytes} bytes: the amount and the memo, locked to the recipient. The size leaks a little: a note without a memo is 80 bytes, a note with one is longer.`),
    ),
    o.viewableBalanceProof
      ? h(
          'details',
          { class: 'bytes' },
          h('summary', null, 'The audit proof ', h('span', { class: 'peek' }, `${o.viewableBalanceProof.length} characters`)),
          hex(o.viewableBalanceProof),
          caption("An extra copy of the amount, locked to the token's audit key, with a proof that it matches the commitment. Everyone can see it. Only the audit key opens it, and that key cannot spend the note or read its memo."),
        )
      : null,
    h('p', { class: 'term' }, 'Spend rule'),
    caption(o.spendCondition === 'Key' ? 'Key: only the holder of one private key can spend this note.' : `${o.spendCondition}: a rule other than a single key.`),
    h('p', { class: 'veiled' }, h('span', { class: 'bar', 'aria-hidden': 'true' }), 'Amount, memo and receiver: hidden from you'),
  )
}

function statement(st: StealthStatement, n: number, feePaid: number | null): HTMLElement {
  const ro = st.revealedOut
  const isFee = paysFee(st, feePaid)
  const shown = st.outputs.slice(0, MAX_NOTES)
  return h(
    'section',
    { class: 'stmt' },
    h('h4', null, `Private transfer ${n + 1}`),
    h('p', { class: 'sum' }, `It spends ${plural(st.inputCommitments.length, 'earlier note')} and creates ${plural(st.outputs.length, 'new sealed note')}.`),
    h(
      'dl',
      { class: 'facts' },
      st.revealedIn !== '0' ? fact('Taken from the public balance', `${amountOf(st.resource, st.revealedIn)}, in the open`) : null,
      ro ? fact(isFee ? 'Revealed to pay the fee' : 'Revealed in the open', `${amountOf(st.resource, ro.amount)} for key ${short(ro.receiver, 6)}`, caption(isFee ? 'This is the network fee. The amount, and the key it names, are in the open, unlike the sealed notes below.' : 'Revealed amounts are readable by everyone, unlike the sealed notes below.')) : null,
      st.inputCommitments.length ? fact('Spent notes', ...st.inputCommitments.slice(0, MAX_NOTES).map((c) => h('code', { class: 'hex' }, short(c, 12))), caption('Which old notes were spent is public. What was inside them is not.')) : null,
    ),
    ...shown.map((o, i) => note(o, i, st.outputs.length)),
    st.outputs.length > shown.length ? caption(`${plural(st.outputs.length - shown.length, 'more sealed note')} not shown. The links above open the whole transaction.`) : null,
  )
}

export function renderStranger(body: HTMLElement, s: Shown): void {
  const v: TxView = s.view
  clear(body)
  body.append(
    h('p', { class: `source ${s.mode}` }, sourceLine(s)),
    h(
      'dl',
      { class: 'facts' },
      fact('Transaction', hex(v.id)),
      outcomeFact(v),
      fact('Fee paid', v.feePaid == null ? 'Not known without a summary' : `${tari(v.feePaid)}, in the clear`),
      fact('Created', when(v.createdAt)),
      fact('Instructions', h('ul', { class: 'instr' }, ...v.instructionKinds.map((k) => h('li', null, h('code', null, k), KIND_CAPTION[k] ? h('span', { class: 'cap' }, KIND_CAPTION[k]) : null)))),
    ),
    h('div', { class: 'actions' }, ...proofLinks(s)),
    ...v.statements.map((st, n) => statement(st, n, v.feePaid)),
    ...(v.statements.length === 0 ? [h('p', { class: 'empty' }, 'This transaction has no private transfer, so nothing in it is sealed.')] : []),
  )
}

export function renderStrangerEmpty(body: HTMLElement): void {
  clear(body)
  body.append(h('p', { class: 'empty' }, 'Nothing on the table yet. Call up a transaction above.'))
}

function leakItem(l: Leak): HTMLElement {
  const shown = l.values.slice(0, MAX_NOTES)
  return h(
    'div',
    { class: 'leak', 'data-leak': l.id },
    h('dt', null, l.term),
    h(
      'dd',
      null,
      ...(shown.length ? shown.map((x) => (l.mono ? hex(x) : h('p', { class: 'val' }, x))) : [h('p', { class: 'val none' }, 'None')]),
      l.values.length > shown.length ? caption(`${l.values.length - shown.length} more not shown. The links in the Stranger card open the whole transaction.`) : null,
      caption(l.caption),
    ),
  )
}

/** The "What still leaks" panel: the same transaction as the Stranger card, seen as a list of what stays public. */
export function renderLeaks(body: HTMLElement, v: TxView | null): void {
  clear(body)
  body.append(v ? h('dl', { class: 'leak-list' }, ...leaks(v).map(leakItem)) : h('p', { class: 'empty' }, 'Nothing to inspect yet. Call up a transaction above.'))
}

/** How a trick did, in a word the colour repeats. */
const tone = (s: Score | null): 'all' | 'some' | 'none' | 'na' => (!s ? 'na' : s.tied === s.of ? 'all' : s.tied === 0 ? 'none' : 'some')

function outcome(label: string, tag: string, s: Score | null, id: TrickId, crowd: number | null): HTMLElement {
  const finds = id === 'amount'
  const verdict = !s ? 'An account ledger has no notes to follow.' : tone(s) === 'all' ? (finds ? 'Finds every payment' : 'Ties every payment') : tone(s) === 'none' ? (finds ? 'Finds none' : 'Ties none') : finds ? 'Finds some' : 'Ties some'
  return h(
    'div',
    { class: `res ${tone(s)}` },
    h('dt', null, label, ' ', h('span', { class: 'tag' }, tag)),
    h('dd', { class: 'num' }, s ? `${s.tied} of ${s.of}` : 'Not applicable'),
    h('dd', { class: 'sub' }, verdict, s && crowd != null ? ` · ${s.wrong} mixed up with others` : ''),
  )
}

/** The Poltergeist: five tricks, each scored on a synthetic transparent ledger and on the recorded Tari transactions. */
export function renderPoltergeist(body: HTMLElement, r: Report): void {
  clear(body)
  const why = notes(r)
  body.append(
    h(
      'ul',
      { class: 'tricks' },
      ...r.rows.map((row) =>
        h(
          'li',
          { class: 'trick', 'data-trick': row.id },
          h('h3', null, TRICKS[row.id].name),
          h('p', { class: 'how' }, TRICKS[row.id].how(r.gapMs)),
          h('dl', { class: 'results' }, outcome('Transparent ledger', 'synthetic', row.transparent, row.id, null), outcome('Tari', 'recorded, real', row.tari, row.id, r.crowd)),
          h('p', { class: 'why' }, why[row.id]),
        ),
      ),
    ),
    h('p', { class: 'verdict' }, summary(r)),
    caption(
      `Each count is out of the ${r.of} demo payments, which one wallet of ours sent. A trick "ties" a payment when it puts it in a group with another of ours; groups grow by chaining, so if A is tied to B and B to C, all three are one group. "Mixed up" counts payments whose group also holds a transaction that is not ours: the Tari side is read together with ${r.crowd} such transactions from the recorded sample, and the synthetic ledger has none. These numbers describe this demo, with one sender, ${r.spanSeconds} seconds and one fee. They do not say how a busy wallet would fare, and we did not measure that. Computed in this page from recorded data; it asks nobody.`,
    ),
  )
}

export type Hearing = { kind: 'no-tx' } | { kind: 'no-key' } | { kind: 'silence' } | { kind: 'read'; who: string; readings: Reading[]; all: StealthOutput[] }

export function renderReading(el: HTMLElement, hearing: Hearing): void {
  clear(el)
  switch (hearing.kind) {
    case 'no-tx':
      el.append(h('p', { class: 'empty' }, 'The medium waits for a transaction. Call one up above.'))
      break
    case 'no-key':
      el.append(h('p', { class: 'empty' }, 'Hand the medium a key and it will listen.'))
      break
    case 'silence':
      el.append(h('div', { class: 'silence' }, h('p', { class: 'quiet' }, 'The spirits are quiet.'), caption('A key that does not fit hears nothing at all. It cannot even tell a wrong key from a note meant for someone else.')))
      break
    case 'read': {
      const { who, readings, all } = hearing
      for (const r of readings) {
        el.append(
          h(
            'div',
            { class: 'reading' },
            h('p', { class: 'term' }, `Sealed note ${all.indexOf(r.output) + 1} of ${all.length} opens`),
            h('p', { class: 'amount' }, amountOf(r.output.resource, r.plain.value)),
            r.plain.memo ? h('p', { class: 'memo' }, `\u201C${r.plain.memo}\u201D`) : h('p', { class: 'memo none' }, 'No memo'),
          ),
        )
      }
      const shut = all.length - readings.length
      el.append(caption(`Read inside this page with ${who}. Nothing was sent anywhere.${shut > 0 ? ` ${theOther(shut, 'sealed note', 'stays', 'stay')} shut for this key.` : ''}`))
      break
    }
  }
}

/** What the Auditor card shows. `working` is drawn once; `showTally` then moves its bar, so a screen reader hears one announcement, not one per slice. */
export type Audit =
  | { kind: 'no-tx' }
  | { kind: 'no-key' }
  | { kind: 'no-proof' }
  | { kind: 'working' }
  | { kind: 'silence' }
  | { kind: 'read'; who: string; heard: Heard[]; all: StealthOutput[] }

export function renderAudit(el: HTMLElement, a: Audit): void {
  clear(el)
  switch (a.kind) {
    case 'no-tx':
      el.append(h('p', { class: 'empty' }, 'The auditor waits for a transaction. Call one up above.'))
      break
    case 'no-key':
      el.append(h('p', { class: 'empty' }, 'Hand the auditor a key and it will count.'))
      break
    case 'no-proof':
      el.append(h('p', { class: 'empty' }, 'Nothing to count. This token has no audit key, so its notes carry no audit proof. Pick a demo from the group \u201CWith an audit key\u201D.'))
      break
    case 'working':
      el.append(
        h('div', { class: 'counting' }, h('p', { class: 'quiet' }, 'Counting\u2026'), h('progress', { class: 'tally', max: String(RANGE_MAX), value: '0', 'aria-label': 'Counting the amounts' }), h('p', { class: 'tick', 'aria-hidden': 'true' }), caption('There is no shortcut. The key tries every amount from 0 up, a slice at a time, and the page stays awake in between.')),
      )
      break
    case 'silence':
      el.append(h('div', { class: 'silence' }, h('p', { class: 'quiet' }, 'The spirits are quiet.'), caption('This is not the token\u2019s audit key, so the proofs stay shut. A wrong key hears nothing at all.')))
      break
    case 'read': {
      const { who, heard, all } = a
      for (const r of heard) {
        el.append(
          h(
            'div',
            { class: 'reading' },
            h('p', { class: 'term' }, `Sealed note ${all.indexOf(r.output) + 1} of ${all.length} counted`),
            r.amount === null ? h('p', { class: 'memo none' }, `More than ${amountOf(r.output.resource, RANGE_MAX)}, past the range this page searches.`) : h('p', { class: 'amount' }, amountOf(r.output.resource, r.amount)),
            h('p', { class: 'memo none' }, 'Memo: shut. The audit key cannot open it.'),
          ),
        )
      }
      const bare = all.length - heard.length
      el.append(caption(`Counted inside this page with ${who}. Nothing was sent anywhere. The search covers 0 to ${amountOf(heard[0].output.resource, RANGE_MAX)}.${bare > 0 ? ` ${theOther(bare, 'sealed note', 'carries', 'carry')} no proof for this key.` : ''}`))
      break
    }
  }
}

/** Move the bar of a `working` card. Does nothing if the card has moved on. */
export function showTally(el: HTMLElement, p: { note: number; notes: number; tried: number }): void {
  const bar = el.querySelector('progress')
  const tick = el.querySelector('.tick')
  if (!bar || !tick) return
  ;(bar as HTMLProgressElement).value = Math.min(p.tried, Number(RANGE_MAX))
  tick.textContent = `Note ${p.note} of ${p.notes}: amounts up to ${baseUnits(p.tried)} tried`
}
