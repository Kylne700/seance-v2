// Ghosts from later, on the page: the Doppelganger (what a copied key reads) and the Revenant (what a computer that can solve discrete logarithms would read).
// The counts and the table are worked out in doppel.ts and revenant.ts; this file only draws them. It asks nobody for anything: the window is what the page
// already holds, and the simulation reads the demo payments with the demo keys through the page's own readers. No inline style, no link, nothing to focus.
import { RANGE_MAX } from './auditor.ts'
import type { TxView } from './chain.ts'
import { demoKeys, demos, recordedWorld, type Shown } from './data.ts'
import { auditCounts, auditSentences, nextTurn, RUNGS, viewCount, viewSentence, windowOf, windowWords } from './doppel.ts'
import { clear, h } from './dom.ts'
import { amountOf } from './format.ts'
import { fields, INTRO, separate, SIMULATION, simulate, standIns, tiers, type Simulation } from './revenant.ts'

/** The key the Medium holds, as main.ts reads it: a secret, a problem with what was typed, or nothing chosen. */
export type KeyChoice = { secret: string; who: string } | { problem: string } | null

const DOPPELGANGER =
  'It copies a key and reads with it. The ladder runs from no key to the key that spends. For each rung: what it opens, what it does not, whether it can spend, and whether the owner can stop it. The lines marked Counted now are made in this page, on the transactions it already holds, with the key chosen in the Medium. What a key would read in the past or the future is described, not counted.'

const p = (cls: string, ...kids: (Node | string)[]): HTMLElement => h('p', { class: cls }, ...kids)
const fill = (el: HTMLElement, ...kids: HTMLElement[]): void => {
  clear(el)
  el.append(...kids)
}
const wait = (text: string): HTMLElement => p('later-wait', text)

/** The four rungs, each with the counted lines (if any) above the lines that describe it. */
function ladder(counted: Record<string, HTMLElement[]>): HTMLElement {
  return h(
    'ol',
    { class: 'later-ladder' },
    ...RUNGS.map((r, i) =>
      h(
        'li',
        { class: 'later-rung', 'data-rung': r.id },
        h('h4', null, `${i + 1}. ${r.title}`),
        ...(counted[r.id] ?? []),
        h('ul', { class: 'later-lines' }, ...r.lines.map(([label, text]) => h('li', null, h('strong', null, `${label}. `), text))),
      ),
    ),
  )
}

const counted = (text: string): HTMLElement => p('later-count', h('strong', null, 'Counted now. '), text)

/** Who the view-key rung is counted with: a published demo key, or what was typed into the Medium. */
const keyWords = (key: { secret: string; who: string }): string => (Object.values(demoKeys).some((k) => k.viewSecret === key.secret) ? `${key.who}, a demo key published with this page` : 'your key, typed into the Medium')

const nameOf = (id: string): string => demoKeys[id].label.split(' (')[0]

function tierList(v: TxView): HTMLElement {
  return h(
    'ol',
    { class: 'later-tiers' },
    ...tiers(v).map((t) => h('li', { class: 'later-tier', 'data-tier': String(t.n) }, p('later-says', h('strong', null, `Tier ${t.n}. `), t.says), p('later-here', h('strong', null, 'In this transaction. '), t.here))),
  )
}

function fieldList(v: TxView): HTMLElement {
  return h(
    'ul',
    { class: 'later-fields' },
    ...fields(v).map((f) => h('li', { class: 'later-field' }, p('later-name', f.name), p('later-what', f.what), p('later-read', h('span', { class: 'later-lab' }, 'Chain data only'), f.alone), p('later-read', h('span', { class: 'later-lab' }, 'With the address'), f.withAddress))),
  )
}

/** What the demo keys read, each value on its own line. Only ever called for a demo payment, and everything it returns goes inside the box that carries the Simulation label. */
function simulated(v: TxView, sim: Simulation, viewer: string): HTMLElement[] {
  const note = (o: TxView['outputs'][number]): string => `Sealed note ${v.outputs.indexOf(o) + 1} of ${v.outputs.length}`
  return [
    p('later-sim-line', `Tier 2. The demo view key of ${viewer} stands in for the solved view key.`),
    ...(sim.reads.length ? sim.reads.map((r) => p('later-sim-value', `${note(r.output)} opens: ${amountOf(r.output.resource, r.plain.value)}. ${r.plain.memo ? `Memo: “${r.plain.memo}”` : 'No memo.'}`)) : [p('later-sim-line', 'That key opens none of the sealed notes here.')]),
    p('later-sim-line', 'Tier 3. The demo audit key stands in for the solved audit key.'),
    ...(sim.counts === null
      ? [p('later-sim-line', 'No note here carries an audit copy, so there is nothing for that key to open.')]
      : sim.counts.length
        ? sim.counts.map((c) => p('later-sim-value', `${note(c.output)} counted: ${c.amount === null ? `more than ${amountOf(c.output.resource, RANGE_MAX)}, past the range this page searches` : amountOf(c.output.resource, c.amount)}. Memo: shut.`))
        : [p('later-sim-line', 'That key opens none of the audit copies here.')]),
  ]
}

/**
 * Draws both ghosts into `body`. `latest` returns the list of latest transactions this page already downloaded (empty if it has not): see data.latest.
 * `show` may be called as often as the Medium is, with whatever is on the table and the key it holds; an older call that a newer one overtakes draws nothing more.
 */
export function createLater(body: HTMLElement, latest: () => Promise<TxView[]>): { show(shown: Shown | null, key: KeyChoice): Promise<void> } {
  const doppelganger = h('div', { class: 'later-ghost', id: 'later-doppelganger' })
  const revenant = h('div', { class: 'later-ghost', id: 'later-revenant' })
  body.append(doppelganger, revenant)
  let recorded: TxView[] | null = null
  let doppelSeq = 0
  let revenantSeq = 0
  let revenantFor = '' // the transaction the Revenant shows; a key change does not redraw it or run the simulation again

  async function drawDoppelganger(shown: Shown | null, key: KeyChoice): Promise<void> {
    const mine = ++doppelSeq
    const alive = (): boolean => mine === doppelSeq
    const head = [h('h3', null, 'The Doppelganger'), p('later-how', DOPPELGANGER)]
    if (!shown) {
      fill(doppelganger, ...head, wait('Nothing is on the table yet, so there is nothing to count. Call a transaction up above.'), ladder({}))
      doppelganger.dataset.tx = ''
      return
    }
    recorded ??= recordedWorld().views
    const txs = windowOf(shown.view, shown.mode, { recorded, latest: shown.mode === 'live' ? await latest() : [] })
    const where = windowWords(shown.mode, txs.length > 1)
    const seen = key && 'secret' in key ? await viewCount(key.secret, txs, alive) : null
    if (!alive()) return
    const view = !key
      ? 'No key is chosen in the Medium, so nothing is counted here.'
      : 'problem' in key
        ? 'The key typed into the Medium is not a valid view secret, so nothing is counted here.'
        : seen
          ? viewSentence(seen, where)
          : ''
    fill(
      doppelganger,
      ...head,
      ...(key && 'secret' in key ? [p('later-key', `Counted with ${keyWords(key)}. Pick another key in the Medium and the counts change.`)] : []),
      ladder({
        view: view ? [counted(view)] : [],
        audit: auditSentences(auditCounts(txs), where).map(counted),
      }),
    )
    doppelganger.dataset.tx = shown.view.id // the transaction this draw is for (the smoke test waits for it)
  }

  async function drawRevenant(shown: Shown | null): Promise<void> {
    const v = shown?.view ?? null
    const id = v ? `${v.id}:${v.outputs.map((o) => o.commitment).join(',')}` : ''
    if (id === revenantFor && revenant.childElementCount) return
    revenantFor = id
    const mine = ++revenantSeq
    const head = [h('h3', null, 'The Revenant'), p('later-how', INTRO)]
    if (!v) {
      fill(revenant, ...head, wait('Nothing is on the table yet, so there is nothing to read. Call a transaction up above.'))
      revenant.dataset.tx = ''
      return
    }
    const keys = standIns(v, demos, demoKeys)
    // the box that carries the Simulation label is made only for a demo payment; for any other transaction there is no box and no value
    const box = h('div', { class: 'later-sim' }, p('later-sim-label', SIMULATION), wait('Reading the demo payment with the demo keys…'))
    fill(
      revenant,
      ...head,
      h('h4', null, 'Three tiers'),
      p('later-note', 'Each tier says what that computer needs and what it then reads. The last line of each says how it applies to the transaction on the table.'),
      tierList(v),
      h('h4', null, 'Field by field'),
      p('later-note', "The fields this transaction holds. “With the address” adds the recipient's address, for example one posted on a forum or an invoice. The chain does not hold it."),
      fieldList(v),
      h('h4', null, 'Apart from reading'),
      h('ul', { class: 'later-lines' }, ...separate(v).map((s) => h('li', null, s))),
      keys ? box : wait('Nothing is simulated for this transaction: it is not one of the demo payments, and the demo keys open only those. No value is shown.'),
    )
    revenant.dataset.tx = v.id
    if (!keys) return
    const sim = await simulate(v, keys, () => mine === revenantSeq)
    if (!sim || mine !== revenantSeq) return
    const to = demos.find((d) => d.id === v.id)?.to ?? ''
    fill(box, p('later-sim-label', SIMULATION), ...simulated(v, sim, nameOf(to)))
  }

  return {
    async show(shown, key) {
      await nextTurn() // a task of its own, so the Medium's answer is already on the screen
      void drawDoppelganger(shown, key)
      void drawRevenant(shown)
    },
  }
}
