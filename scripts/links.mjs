// Do the links still resolve, and do our recorded copies still match what the public indexers return?
// Plain GETs, one at a time, 250 ms apart, no retries and no polling: about 50 small requests and one headless page.
//   First indexer (INDEXER_URL: the one the page and the explorer read): status only. 404 means it dropped the transaction. That is
//     not a failure, because the page then shows the saved copy and says so; it is reported so the README's dated note can be checked.
//   Second indexer (MIRROR_URL: where the README's transaction links point): must answer 200 for the id with outcome Commit. Where
//     ledger.json holds the indexer's answer, it must equal that answer except `transaction.source` ("gossip" in our copy, "local" there).
//   The same two checks for the 2 transactions of the recorded sample that Summon falls back to (ledger.recent).
// Also checked: the demo token's template and the token itself (its view key is the audit key), the explorer's page for the token
// (the one page that needs a browser), the two repository links the page uses, and the two footer links. A made-up id is the
// negative control: the second indexer must not answer 200 for it.
// The result depends on what the testnet holds on the day, so the evidence file carries the date.
// Usage: node scripts/links.mjs          (needs the network; Chromium for the explorer page). Writes evidence/links.txt.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { EXPLORER_URL, INDEXER_URL, LEDGER_URL, MIRROR_URL, SEANCE_RESOURCE, mirrorTx } from '../src/config.ts'

delete process.env.DISPLAY // headless only, never a real screen
const ledger = JSON.parse(readFileSync(new URL('../ledger.json', import.meta.url), 'utf8'))
const lines = []
const say = (s) => {
  lines.push(s)
  console.log(s)
}
let failed = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const verdict = (ok) => {
  if (!ok) failed++
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
const withoutSource = (reply) => {
  const copy = structuredClone(reply)
  if (copy?.transaction) delete copy.transaction.source
  return copy
}

say(`Links and recorded copies, checked ${new Date().toISOString()}`)
say(`first indexer ${INDEXER_URL}, second indexer ${MIRROR_URL}, explorer ${EXPLORER_URL}`)

// one transaction: what each indexer says, and whether the second one's answer equals our recording (when we hold one)
async function row(id, reply) {
  const first = await get(`${INDEXER_URL}/transactions/${id}`)
  const second = await get(mirrorTx(id))
  const tx = second.json?.transaction
  const settled = tx?.transaction_id === id && tx?.summary?.outcome === 'Commit'
  let same = 'no recorded answer'
  let sameOk = true
  if (reply) {
    sameOk = canon(withoutSource(second.json)) === canon(withoutSource(reply))
    same = sameOk ? 'equals the recording' : 'DIFFERS from the recording'
  }
  say(`${verdict(second.status === 200 && settled && sameOk)} ${id}  first indexer ${first.status}  second indexer ${second.status}  shows the id with outcome Commit: ${settled}  ${same}`)
  return { held: first.status === 200, equal: !!reply && sameOk }
}

// 1. the 18 transactions: 4 SEANCE demos, 11 TARI demos, 3 set-up steps. Only the first 15 have a recorded answer.
const entries = [...ledger.txs, ...ledger.hero, ...ledger.setup]
const done = []
for (const e of entries) done.push(await row(e.id, e.reply))
say(`first indexer still holds ${done.filter((d) => d.held).length} of ${entries.length} (404 for the rest: the page then shows the saved copy; not a failure); ${done.filter((d) => d.equal).length} of ${entries.filter((e) => e.reply).length} recorded answers equal the second indexer's, source field aside`)

// 1b. the recorded sample that Summon shows when the newest transactions hold no private transfer: ledger.recent, in the indexer's shape
const sample = []
for (const t of ledger.recent.transactions) sample.push(await row(t.transaction_id, { transaction: t }))
say(`recorded sample (Summon's fallback, saved ${ledger.recent.capturedAt.slice(0, 10)}): first indexer still holds ${sample.filter((d) => d.held).length} of ${sample.length}; ${sample.filter((d) => d.equal).length} of ${sample.length} recorded answers equal the second indexer's, source field aside`)

// 2. negative control: an id nobody sent. If the check passed here, it would prove nothing.
const none = 'ab'.repeat(32)
const control = await get(mirrorTx(none))
say(`${verdict(control.status === 404)} negative control ${none.slice(0, 12)}...  second indexer ${control.status} (must be 404)`)

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

// 5. links the page and the README use that are not transactions
for (const url of [LEDGER_URL, 'https://github.com/Kylne700/seance/blob/main/template/src/lib.rs', EXPLORER_URL, 'https://ootle.tari.com']) {
  const r = await get(url)
  say(`${verdict(r.status === 200)} link ${url}  http ${r.status}`)
}

say(failed === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failed})`)
mkdirSync(new URL('../evidence/', import.meta.url), { recursive: true })
writeFileSync(new URL('../evidence/links.txt', import.meta.url), lines.join('\n') + '\n')
process.exit(failed === 0 ? 0 : 1)
