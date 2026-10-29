// Do the links still resolve, and do our recorded copies still agree with what the public indexers return?
// Plain GETs, one at a time, 250 ms apart, no retries and no polling: about 95 small requests and one headless page.
// Changed on 2026-10-29: the check is made on RECEIPTS (GET /transaction-receipts/<id>). The second indexer used to return a whole transaction by id and
// this file compared it with ledger.json; since 2026-10-29 it answers 404 for that, while both indexers still answer 200 for the receipt of the same id.
//   For each of the 20 transactions (4 SEANCE demos, 11 TARI demos, 3 set-up steps, and the 2 of the recorded sample that Summon falls back to):
//     both indexers must answer 200 at /transaction-receipts/<id> with outcome Commit, and
//     where ledger.json holds the saved copy (17 of the 20), each receipt must agree with it on every field the two carry: the outcome, the fee paid,
//     the sealed notes the transaction spent, and the receipt's epoch inside the saved transaction's epoch window (scripts/receipt-check.ts says why these
//     and no others). The receipt body holds no transaction id, so the id binds a receipt to a transaction only through the address it came from.
//     The 3 set-up steps have no saved copy: for them only the answer and the outcome are checked.
//   Reported, not judged: whether the two receipts are identical, and what each indexer says for the whole transaction by id (404 means it dropped it;
//     the page then shows the saved copy and says so).
// Also checked: the demo token's template and the token itself on both indexers (its view key is the audit key), the explorer's page for the token (the one
// page that needs a browser), the links the page and the README use that are not transactions, and two negative controls: a made-up id must get 404 at the
// receipt address of both indexers, and the comparison must disagree when it is given another transaction's receipt.
// Checks that wait for the pushed repository (kylne700/seance-v2 and its Pages site) are marked and counted apart in the result.
// The result depends on what the testnet holds on the day, so the evidence file carries the date.
// Usage: node scripts/links.mjs          (needs the network; Chromium for the explorer page). Writes evidence/links.txt.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { EXPLORER_URL, INDEXER_URL, LEDGER_URL, MIRROR_URL, SEANCE_RESOURCE, mirrorReceipt, receiptTx } from '../src/config.ts'
import { compareReceipt, disagreements } from './receipt-check.ts'

delete process.env.DISPLAY // headless only, never a real screen
const ledger = JSON.parse(readFileSync(new URL('../ledger.json', import.meta.url), 'utf8'))
const lines = []
const say = (s) => {
  lines.push(s)
  console.log(s)
}
let failed = 0
let waiting = 0 // failures of checks that need the pushed repository
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const verdict = (ok, needsPush = false) => {
  if (!ok) {
    failed++
    if (needsPush) waiting++
  }
  return ok ? 'ok  ' : 'FAIL'
}

/** GET and parse. Never throws: a network error is status 0. */
async function get(url) {
  await sleep(250)
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) })
    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      // not JSON: the status is what counts
    }
    return { status: r.status, json }
  } catch (e) {
    return { status: 0, json: null, error: `${e?.name}: ${e?.message}` }
  }
}

// the same JSON with its keys sorted, so two answers compare by content and not by key order
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x))

say(`Links and recorded copies, checked ${new Date().toISOString()}`)
say(`first indexer ${INDEXER_URL}, second indexer ${MIRROR_URL}, explorer ${EXPLORER_URL}`)

// one transaction: the receipt from each indexer (judged), and the whole transaction by id (reported)
const WHICH = [['first', INDEXER_URL, receiptTx], ['second', MIRROR_URL, mirrorReceipt]]
const receipts = new Map() // id -> the first indexer's receipt, for the control below
async function row(id, saved) {
  const got = []
  for (const [, , url] of WHICH) got.push(await get(url(id)))
  const byId = []
  for (const [, base] of WHICH) byId.push((await get(`${base}/transactions/${id}`)).status)
  receipts.set(id, got[0].json)
  const committed = got.map((g) => g.status === 200 && g.json?.receipt?.outcome === 'Commit')
  const checks = saved ? got.map((g) => compareReceipt(saved, g.json ?? {})) : []
  const agree = checks.every((c) => c.every((x) => x.ok))
  const same = got[0].status === 200 && canon(got[0].json) === canon(got[1].json)
  const why = checks.flatMap((c, i) => (c.every((x) => x.ok) ? [] : [`${WHICH[i][0]} indexer: ${disagreements(c)}`])).join(' | ')
  const note = !saved ? 'no saved copy: the answer and the outcome only' : agree ? 'agrees with the saved copy (outcome, fee, spent notes, epoch window)' : `DISAGREES with the saved copy: ${why}`
  say(`${verdict(committed.every(Boolean) && agree)} ${id}  receipt: first ${got[0].status}, second ${got[1].status}  outcome Commit: ${committed.join('/')}  ${note}  identical: ${same}  whole transaction by id (not judged): first ${byId[0]}, second ${byId[1]}`)
  return { ok: committed.every(Boolean) && agree, saved: !!saved, same, held: byId.map((s) => s === 200) }
}
const summary = (label, rows) =>
  say(
    `${label}: both receipts 200 with outcome Commit and agreeing with the saved copy where there is one for ${rows.filter((d) => d.ok).length} of ${rows.length}; identical on both indexers for ${rows.filter((d) => d.same).length} of ${rows.length}; ` +
      `whole transaction by id (404 for the rest; not a failure): first indexer holds ${rows.filter((d) => d.held[0]).length}, second indexer holds ${rows.filter((d) => d.held[1]).length}`,
  )

// 1. the 18 transactions this file links: 4 SEANCE demos, 11 TARI demos, 3 set-up steps. Only the first 15 have a saved copy.
const entries = [...ledger.txs, ...ledger.hero, ...ledger.setup]
const done = []
for (const e of entries) done.push(await row(e.id, e.reply))
summary(`the 18 transactions (${done.filter((d) => d.saved).length} with a saved copy)`, done)

// 1b. the recorded sample that Summon shows when the newest transactions hold no private transfer: ledger.recent, in the indexer's list shape
const sample = []
for (const t of ledger.recent.transactions) sample.push(await row(t.transaction_id, { transaction: t }))
summary(`the recorded sample (Summon's fallback, saved ${ledger.recent.capturedAt.slice(0, 10)})`, sample)

// 2. negative controls. If either passed on a wrong input, the checks above would prove nothing.
const none = 'ab'.repeat(32)
for (const [label, , url] of WHICH) {
  const control = await get(url(none))
  say(`${verdict(control.status === 404)} negative control: a made-up id ${none.slice(0, 12)}...  ${label} indexer's receipt ${control.status} (must be 404)`)
}
const [one, other] = [ledger.hero[0], ledger.hero[1]]
const wrong = compareReceipt(one.reply, receipts.get(other.id) ?? {})
say(`${verdict(wrong.some((c) => !c.ok))} negative control: ${one.id.slice(0, 12)}... saved copy against the receipt of ${other.id.slice(0, 12)}...  disagrees on: ${wrong.filter((c) => !c.ok).map((c) => c.name).join(', ') || 'nothing (the comparison is blind)'}`)

// 3. the demo token: the template it was made from, and the token itself, whose view key must be the audit key
const templateHex = ledger.auditor.template.replace(/^template_/, '')
for (const [label, base] of [['first indexer', INDEXER_URL], ['second indexer', MIRROR_URL]]) {
  const t = await get(`${base}/templates/${templateHex}`)
  say(`${verdict(t.status === 200 && t.json?.name === 'SeanceAuditorToken')} ${label}: template ${templateHex.slice(0, 10)}...  http ${t.status}  name ${t.json?.name}  code ${t.json?.code_size} bytes`)
  const r = await get(`${base}/resources/${SEANCE_RESOURCE}`)
  const viewKey = r.json?.resource?.view_key
  say(`${verdict(r.status === 200 && viewKey === ledger.auditor.publicKey)} ${label}: token ${SEANCE_RESOURCE.slice(0, 18)}...  http ${r.status}  its view key is the audit key (public half): ${viewKey === ledger.auditor.publicKey}`)
}

// 4. the explorer's page for the token: a single-page app, so it needs a browser to say anything
const dir = mkdtempSync(join(tmpdir(), 'seance-links-'))
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const page = await browser.newPage()
  const url = `${EXPLORER_URL}/substate/${SEANCE_RESOURCE}`
  const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
  await page.waitForFunction(() => /View key/.test(document.body.innerText), { timeout: 15000 }).catch(() => {})
  const text = await page.evaluate(() => document.body.innerText)
  const ok = resp?.status() === 200 && /View key/.test(text) && text.includes(ledger.auditor.publicKey.slice(0, 10))
  say(`${verdict(ok)} explorer page for the token  http ${resp?.status() ?? 0}  lists a View key starting ${ledger.auditor.publicKey.slice(0, 10)}: ${text.includes(ledger.auditor.publicKey.slice(0, 10))}`)
  await page.close()
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
}

// 5. links the page and the README use that are not transactions. The first group needs nothing published by us; the second waits for the push (the repository
// kylne700/seance-v2, the Pages site it builds, the forum images under media/ and the README's badge) and says so.
for (const url of [EXPLORER_URL, 'https://ootle.tari.com']) {
  const r = await get(url)
  say(`${verdict(r.status === 200)} link ${url}  http ${r.status}`)
}
const REPO = 'https://github.com/Kylne700/seance-v2'
const PAGES = 'https://kylne700.github.io/seance-v2/'
const images = readdirSync(new URL('../public/media/', import.meta.url)).filter((f) => f.endsWith('.png'))
for (const url of [LEDGER_URL, `${REPO}/blob/main/template/src/lib.rs`, `${REPO}/actions/workflows/pages.yml/badge.svg`, PAGES, ...images.map((f) => `${PAGES}media/${f}`)]) {
  const r = await get(url)
  say(`${verdict(r.status === 200, true)} link ${url}  http ${r.status}  (waits for the push: ${r.status === 200 ? 'it is up' : 'not up yet'})`)
}

say(failed === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failed}), of which ${waiting} wait for the pushed repository and its Pages site`)
mkdirSync(new URL('../evidence/', import.meta.url), { recursive: true })
writeFileSync(new URL('../evidence/links.txt', import.meta.url), lines.join('\n') + '\n')
process.exit(failed === 0 ? 0 : 1)
