import { audit, audited } from './auditor.ts'
import { txFromHash } from './chain.ts'
import { INDEXER_URL } from './config.ts'
import { createData, demoKeys, demos, LookupError, recordedWorld, savedOn, type Demo, type Shown } from './data.ts'
import { listen, viewSecretProblem } from './decrypt.ts'
import { clear, h } from './dom.ts'
import { outcomeLabel, plural, short } from './format.ts'
import { createNetlog } from './netlog.ts'
import { poltergeist } from './poltergeist.ts'
import templateSource from '../template/src/lib.rs?raw'
import { proofLinks, renderAudit, renderLeaks, renderNetRows, renderPoltergeist, renderReading, renderStranger, renderStrangerEmpty, showTally, type Hearing } from './render.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el as T
}
const txid = $<HTMLInputElement>('txid')
const demo = $<HTMLSelectElement>('demo')
const status = $('status')
const strangerBody = $('stranger-body')
const strangerCard = $('stranger')
const leaksBody = $('leaks-body')
const keysBox = $('keys')
const auditKeysBox = $('audit-keys')
const ownKey = $<HTMLInputElement>('own-key')
const ownHint = $('own-hint')
const reading = $('reading')
const auditReading = $('audit-reading')
const mediumActions = $('medium-actions')
const modeBadge = $('mode-badge')
const modeText = $('mode-text')
const modeSwitch = $('mode-switch')
const buttons = [$('summon'), $('open-file'), $('hold'), $('look')]
const fileInput = $<HTMLInputElement>('file')
const ask = $('ask')
const netHead = $('net-head')
const netFile = $('net-file')
const netRows = $('net-rows')

const oneColumn = window.matchMedia('(max-width: 959px)') // keep in step with style.css
const calm = window.matchMedia('(prefers-reduced-motion: reduce)')

// The ghost log is set up before anything can ask the network. It wraps `fetch` for the whole page, and the browser's own list of loaded files feeds it too.
const netlog = createNetlog({ siteHost: location.host, indexerHost: new URL(INDEXER_URL).host })
globalThis.fetch = netlog.wrap(globalThis.fetch.bind(globalThis))
for (const type of ['navigation', 'resource']) new PerformanceObserver((list) => list.getEntries().forEach((e) => netlog.seen(e as PerformanceResourceTiming))).observe({ type, buffered: true })
for (const k of Object.values(demoKeys)) netlog.watch(k.viewSecret)

const data = createData()
// The single-file offline copy (scripts/build-offline.mjs marks <html class="offline"> and its CSP blocks the page's requests): recorded data only, from the first line on.
const offline = document.documentElement.classList.contains('offline')
if (offline) data.setMode('recorded')
let current: Shown | null = null
let fileMark = 0 // when the file now on the table was opened, on the log's clock
let pending = '' // the id the visitor was just told is not in the list
let busy = false
let loadSeq = 0 // answers that arrive after a newer request are dropped
let hearSeq = 0
let auditSeq = 0

const keyNames = Object.keys(demoKeys)
const nameOf = (key: string): string => demoKeys[key].label.split(' (')[0]
const whoOf = (key: string): string => (key === 'auditor' ? 'the audit key' : `${nameOf(key)}'s key`)

function setStatus(text: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
  status.textContent = text
  status.className = `status ${kind}`
}

function reflectMode(): void {
  const recorded = data.mode === 'recorded'
  const file = current?.mode === 'file'
  modeBadge.textContent = file ? 'File' : offline ? 'Offline' : recorded ? 'Recorded' : 'Live'
  modeBadge.className = `badge ${file ? 'file' : data.mode}`
  modeText.textContent = offline ? 'Offline copy: open a saved transaction file.' : file ? 'Showing a file you opened. Nothing was asked of any server for it.' : recorded ? 'Replaying answers saved earlier. This page does not ask the indexer. Press the button again to go back to live data.' : 'Asking the Esmeralda indexer. The requests this page made are listed below.'
  modeSwitch.setAttribute('aria-pressed', String(recorded))
}

// The ghost log's panel. Only its text and rows are redrawn, so the open or closed state of the list is left alone.
function renderNet(): void {
  netHead.textContent = netlog.headline()
  netHead.className = netlog.summary().leaked ? 'net-head leak' : 'net-head'
  renderNetRows(netRows, netlog.entries())
  netFile.hidden = current?.mode !== 'file'
  netFile.textContent = current?.mode === 'file' ? `Since you opened your file: ${plural(netlog.since(fileMark), 'request')}.` : ''
}
netlog.subscribe(renderNet)

function setBusy(on: boolean): void {
  busy = on
  for (const b of buttons) b.setAttribute('aria-disabled', String(on)) // not "disabled": keyboard focus must not fall off the button
  strangerBody.setAttribute('aria-busy', String(on))
}

// What the medium hears, from the key currently chosen (a demo key or a pasted one).
function chosenKey(): { secret: string; who: string } | { problem: string } | null {
  const own = ownKey.value.trim().toLowerCase()
  if (own) {
    netlog.watch(own) // a pasted key is watched like the demo keys: if it ever turns up in a request, the log says so
    const problem = viewSecretProblem(own)
    return problem ? { problem } : { secret: own, who: 'your key' }
  }
  const radio = keysBox.querySelector<HTMLInputElement>('input[name=key]:checked')
  return radio ? { secret: demoKeys[radio.value].viewSecret, who: whoOf(radio.value) } : null
}

async function hear(): Promise<void> {
  const mine = ++hearSeq
  const key = chosenKey()
  ownHint.textContent = key && 'problem' in key ? key.problem : ''
  let hearing: Hearing
  if (!current) hearing = { kind: 'no-tx' }
  else if (!key || 'problem' in key) hearing = { kind: 'no-key' }
  else {
    const all = current.view.outputs
    const readings = await listen(key.secret, all)
    hearing = readings.length ? { kind: 'read', who: key.who, readings, all } : { kind: 'silence' }
  }
  if (mine === hearSeq) renderReading(reading, hearing)
}

// What the auditor counts, from the audit key chosen: only the amounts, only when a note carries a proof, in slices so the page stays awake.
async function count(): Promise<void> {
  const mine = ++auditSeq
  const radio = auditKeysBox.querySelector<HTMLInputElement>('input[name=audit-key]:checked')
  if (!current) return renderAudit(auditReading, { kind: 'no-tx' })
  const all = current.view.outputs
  if (!audited(all).length) return renderAudit(auditReading, { kind: 'no-proof' })
  if (!radio) return renderAudit(auditReading, { kind: 'no-key' })
  let started = false
  const heard = await audit(demoKeys[radio.value].viewSecret, all, {
    alive: () => mine === auditSeq,
    progress: (p) => {
      if (mine !== auditSeq) return
      if (!started) renderAudit(auditReading, { kind: 'working' }) // drawn only if the search takes a moment: a wrong key is turned away at once
      started = true
      showTally(auditReading, p)
    },
  })
  if (heard && mine === auditSeq) renderAudit(auditReading, heard.length ? { kind: 'read', who: whoOf(radio.value), heard, all } : { kind: 'silence' })
}

function checkRadio(group: 'key' | 'audit-key', value: string | null): void {
  for (const r of document.querySelectorAll<HTMLInputElement>(`input[name=${group}]`)) r.checked = r.value === value
}

function describe(s: Shown): string {
  const what = `Showing transaction ${short(s.view.id, 8)} (${outcomeLabel(s.view)}).`
  if (s.mode === 'file') return `Opened from your file. Nothing was asked of any server, and this page cannot tell whether the file is a genuine answer from an indexer. ${what}`
  if (s.ours) return `Nobody else's private transfer was among the latest transactions, so this is one of the demos we made for this page. ${what}`
  if (s.fellBack) return `The indexer did not answer, so the page switched to recorded data. ${what}`
  if (s.quietChain) return `The latest live transactions held no private transfer, so this one is recorded. ${what}`
  const kind = demos.find((d) => d.id === s.view.id)?.kind
  const about = kind === 'audited' ? ' Paid in the demo token SEANCE, which has an audit key. The Medium, with the recipient\'s key, opens one note (amount and memo). The Auditor, with the audit key, counts the amount of both and cannot read a memo.' : kind === 'revealed' ? " This sender revealed the amount on purpose, so there is nothing sealed to read: compare the Stranger's view with the other demos." : ''
  if (s.preview && offline) return 'A saved example is on the table, so the three ghosts have something to read. Open a saved transaction file to read your own.'
  if (s.preview) return 'A saved example is on the table, so the three ghosts have something to read. Nothing has been asked of the indexer yet: summon a recent transaction to read a live one, or paste any id.'
  if (s.forgotten) return `The public indexer no longer holds this transaction, so this is the copy saved on ${savedOn}. Anything you paste is still looked up live. ${what}${about}`
  if (s.list) return `${s.list.found ? `Found in the indexer's latest ${plural(s.list.size, 'transaction')}, so the indexer was not asked for this id.` : `Summon downloaded the indexer's latest ${plural(s.list.size, 'transaction')} and picked this one in your browser. The indexer saw your IP address, the time and the request for the list, and no id.`} ${what}`
  if (!kind && s.mode === 'live') return `You asked the indexer for this id, so it saw the id, your IP address and the time. ${what}`
  return `${what}${about}`
}

// The cards sit below the picker, so after a call the page brings the answer (or the error) into view.
function reveal(el: HTMLElement, block: ScrollLogicalPosition): void {
  el.scrollIntoView({ block, behavior: calm.matches ? 'auto' : 'smooth' })
}
const onScreen = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.bottom <= window.innerHeight
}
// One column: always bring the Stranger card to the top. Wide: only if the cards are not already in the upper half of the screen.
const cardsFar = (): boolean => {
  const top = strangerCard.getBoundingClientRect().top
  return oneColumn.matches || top < 0 || top > window.innerHeight / 2
}

/** `asked`: the id being looked up, so that a miss can offer to ask for it by id. `saying`: the status line while the work is under way. */
async function load(job: () => Promise<Shown>, opts: { key?: string; auditKey?: string; fromUser?: boolean; asked?: string; saying?: string } = {}): Promise<void> {
  if (busy) return
  const mine = ++loadSeq
  setBusy(true)
  ask.hidden = true
  setStatus(opts.saying ?? (data.mode === 'live' ? 'Calling the indexer…' : 'Opening the recording…'))
  try {
    const shown = await job()
    if (mine !== loadSeq) return
    current = shown
    renderStranger(strangerBody, shown)
    renderLeaks(leaksBody, shown.view)
    mediumActions.replaceChildren(proofLinks(shown)[0]) // the Medium card has its own link to the same transaction
    if (shown.mode === 'file') history.replaceState(null, '', location.pathname + location.search) // the address bar must not keep pointing at another transaction
    else if (!shown.preview) {
      txid.value = shown.view.id
      history.replaceState(null, '', `#tx=${shown.view.id}`)
    }
    if (opts.key) {
      checkRadio('key', opts.key)
      ownKey.value = ''
    }
    if (opts.auditKey) checkRadio('audit-key', opts.auditKey)
    reflectMode()
    renderNet()
    setStatus(describe(shown), shown.fellBack || shown.quietChain ? 'warn' : 'info')
    if (opts.fromUser && cardsFar()) reveal(strangerCard, 'start')
    await hear()
    void count()
  } catch (e) {
    if (mine !== loadSeq) return
    current = null
    renderStrangerEmpty(strangerBody)
    renderLeaks(leaksBody, null)
    clear(mediumActions)
    reflectMode()
    renderNet()
    if (e instanceof LookupError) {
      setStatus(e.message, e.kind === 'not-listed' ? 'warn' : 'error')
      if (e.kind === 'not-listed' && opts.asked) {
        pending = opts.asked
        ask.hidden = false
      }
    } else {
      console.error(e)
      setStatus('Something unexpected went wrong. Try again, or switch to recorded data.', 'error')
    }
    if (opts.fromUser && !onScreen(status)) reveal(status, 'center')
    await hear()
    void count()
  } finally {
    if (mine === loadSeq) setBusy(false)
  }
}

// Wire the page.
const option = (d: Demo): HTMLElement => h('option', { value: d.id }, `Demo ${d.n} · ${short(d.id, 6)}${d.kind === 'revealed' ? ' · revealed amount' : ''}`)
demo.append(
  h('optgroup', { label: 'With an audit key: all three ghosts' }, ...demos.filter((d) => d.kind === 'audited').map(option)),
  h('optgroup', { label: 'Without: the Stranger and the Medium' }, ...demos.filter((d) => d.kind !== 'audited').map(option)),
)
for (const [box, group] of [[keysBox, 'key'], [auditKeysBox, 'audit-key']] as const) {
  for (const key of keyNames) box.append(h('label', { class: 'choice' }, h('input', { type: 'radio', name: group, value: key }), h('span', null, demoKeys[key].label)))
}

$('pick').addEventListener('submit', (e) => {
  e.preventDefault()
  const id = txid.value
  void load(() => data.lookup(id), { fromUser: true, asked: id })
})
txid.addEventListener('input', () => {
  ask.hidden = true // the question was about the id that stood there before
})
$('ask-anyway').addEventListener('click', () => void load(() => data.lookup(pending, { askAnyway: true }), { fromUser: true, saying: 'Asking the indexer for this id…' }))
const openFile = (): void => {
  if (!busy) fileInput.click()
}
$('open-file').addEventListener('click', openFile)
$('ask-file').addEventListener('click', openFile)
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileInput.value = '' // so the same file can be opened again
  if (!file) return
  const job = async (): Promise<Shown> => {
    const opened = netlog.mark()
    const shown = await data.fromFile(file)
    fileMark = opened
    return shown
  }
  void load(job, { fromUser: true, saying: 'Opening your file…' })
})
$('summon').addEventListener('click', () => void load(() => data.recent(), { fromUser: true }))
$('hold').addEventListener('click', () => {
  const d = demos.find((x) => x.id === demo.value) as Demo
  void load(() => data.lookup(d.id), { key: d.to, auditKey: d.kind === 'audited' ? 'auditor' : undefined, fromUser: true })
})
modeSwitch.addEventListener('click', () => {
  data.setMode(data.mode === 'live' ? 'recorded' : 'live')
  reflectMode()
  setStatus(data.mode === 'recorded' ? 'Switched to recorded data. Nothing will be asked of the indexer.' : 'Switched back to live data.')
})
keysBox.addEventListener('change', () => {
  ownKey.value = ''
  void hear()
})
auditKeysBox.addEventListener('change', () => void count())
ownKey.addEventListener('input', () => {
  if (ownKey.value.trim()) checkRadio('key', null)
  void hear()
})

// Ready. index.html ships a loading line and buttons marked not ready; clear both here, before the address is read (it may start a load).
// "Look at it" also ships `disabled`: a click or Enter on a submit button before this point makes the browser cancel the page's pending code (the form is blocked by the CSP, the load is not resumed).
for (const b of [...buttons, modeSwitch]) b.removeAttribute('aria-disabled')
$('look').removeAttribute('disabled')
setStatus('')

reflectMode()
renderNet()
renderPoltergeist($('polt-body'), poltergeist(recordedWorld())) // recorded data only: the same numbers on every visit
$('template-code').textContent = templateSource
$('template-lines').textContent = plural(templateSource.trimEnd().split('\n').length, 'line')
const fromHash = offline ? null : txFromHash(location.hash) // the offline copy has no way to look an id up
if (fromHash) {
  renderStrangerEmpty(strangerBody)
  renderLeaks(leaksBody, null)
  void hear()
  void count()
  void load(() => data.lookup(fromHash), { asked: fromHash })
} else {
  // The first screen is never empty: the three ghosts read demo 1 from the recording, with Bob's key and the audit key already in hand.
  // The address bar and the id box stay as they are, and the status line says it is a saved example.
  void load(async () => data.example(), { key: demos[0].to, auditKey: 'auditor' })
}
