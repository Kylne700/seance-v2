// Maintainer script: films the LIVE page and writes the SILENT cut of the version 2 screen recording (no audio track, no voice, no model) to SILENT_OUT (default: seance-v2-demo-silent.mp4 in the temp directory). It never writes public/media/seance-v2-demo.mp4: that file is the narrated video, made from this silent cut by scripts/narrate-v2-demo.mjs.
//   node scripts/make-v2-demo.mjs
// Needs headless Chromium (CHROMIUM=/path overrides /usr/bin/chromium) and ffmpeg with libx264 and drawtext. LIVE_URL, WORK (where the frames and notes are kept; default a
// temp directory, removed at the end only when WORK is not set) and FONT (the caption font) can be set. It uses the real indexer, so a take can fail when the testnet is quiet
// or slow; run it again.
// How it works: Chromium is driven like a visitor (1000 css px wide, drawn at x1.28 so the text is not small in 1280 x 720) and its screencast frames are kept with their times.
// Each caption is one "beat": the action, a wait for the page to show what the caption says (the script throws when it does not), and a hold long enough to read. Nothing is
// faked: every state in the video is what the page showed. The order: A, Tari's own secrets on one saved real payment (what a stranger cannot read, what a view key and an audit
// key read, what a patient ghost with no key still ties together, what still leaks); B, even looking stays private (the lookup in the indexer's latest 40, the Ask-anyway button,
// the log, the connection check, a saved file); C, Ghosts from later. The network is cut for the saved-file scene (Chromium offline, the page already loaded) and the script counts
// the requests the browser tried to make from then on; it must be 0. The one real click on "Check my connection" comes before the cut: it sends one GET to the indexer's
// /cdn-cgi/trace (the answer is never read here, only what the page shows), and the script checks that it was the only one.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { INDEXER_URL } from '../src/config.ts'
import { parseTransaction } from '../src/chain.ts'
import { kexMessage, TRACE_PATH } from '../src/conncheck.ts' // the sentence the page shows for the hybrid key exchange, and the one path the check asks for
import { INTRO, SIMULATION } from '../src/revenant.ts' // the page's own words for the Revenant and the label of the Simulation box

delete process.env.DISPLAY // headless only, never a real screen
delete process.env.WAYLAND_DISPLAY
const SITE = process.env.LIVE_URL ?? 'https://kylne700.github.io/seance-v2/'
const SITE_HOST = new URL(SITE).host
const INDEXER_HOST = new URL(INDEXER_URL).host
const KEEP_WORK = Boolean(process.env.WORK)
const WORK = process.env.WORK ?? mkdtempSync(join(tmpdir(), 'seance-v2-video-'))
const FRAMES = join(WORK, 'frames')
const OUT = resolve(process.env.SILENT_OUT ?? join(tmpdir(), 'seance-v2-demo-silent.mp4')) // the silent cut; the narrated public/media/seance-v2-demo.mp4 is made from it
const EXAMPLE = fileURLToPath(new URL('../examples/saved-transaction.json', import.meta.url)) // our own demo transaction
const FONT = process.env.FONT ?? '/usr/share/fonts/opentype/inter/Inter-Medium.otf'
const W = 1280, H = 720, BAND = 80, PAGE_H = H - BAND // the page above, a caption band below
const CSS_W = 1000, SCALE = W / CSS_W, CSS_H = PAGE_H / SCALE // 1000 x 500 css px, drawn at 1280 x 640
const FPS = 30, END_S = 5, FADE_S = 0.6
const BG = '0d0b13'
const BANNED = /\b(never|always|guarantees?|life-saving|untraceable|unbreakable|anonymous)\b/i
const LIST_PATH = '/transactions/recent?limit=40'
const HEAD = /^This page sent (\d+) requests? to (\d+) hosts?; (\d+) named a transaction id; your keys were in none of them\.$/ // the headline of the log of the page's requests
const norm = (s) => s.replace(/\s+/g, ' ').trim()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000
const must = (ok, what) => {
  if (!ok) throw new Error(`not filmed: ${what}`)
}
mkdirSync(FRAMES, { recursive: true })

// An id from the indexer's latest 40 that the page will find in its own copy of the list a few seconds later: a Commit, and not among the newest (the page's list can be up to a
// minute older than ours) nor the oldest (they drop out first).
async function idInList() {
  const list = (await (await fetch(`${INDEXER_URL}/transactions/recent?limit=40`)).json()).transactions
  const ok = list.slice(6, 30).filter((t) => { try { return parseTransaction(t).outcome === 'Commit' } catch { return false } })
  must(ok.length > 0, 'the indexer\'s latest 40 hold no committed transaction to look for')
  return ok[0].transaction_id
}

const caps = [] // { text, scene, from, to }  seconds, wall clock
const texts = [] // everything the page said at the end of each beat, for the scan
let page, cdp, cursor, sentAfterCut = null
let idPending = null // the id for the lookup scene, asked of the indexer while an earlier caption is on screen
const sent = [] // every request the browser started: { url, method, body, cut }

const waitFor = (fn, ms = 30000) => page.waitForFunction(fn, { timeout: ms, polling: 100 })
const text = (sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim())
const top = (sel) => page.$eval(sel, (e) => e.getBoundingClientRect().top + scrollY)
const bottom = (sel) => page.$eval(sel, (e) => e.getBoundingClientRect().bottom + scrollY)
/** The value of `attr` (on the element or its closest ancestor that has it) for each element matching `sel` that lies wholly inside the viewport now: what a frame shows. */
const inView = (sel, attr) => page.$$eval(sel, (els, a) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }).map((e) => e.closest(`[${a}]`).getAttribute(a)), attr)
/** How many elements matching `sel` lie wholly inside the viewport now: what a frame shows. */
const shown = (sel) => page.$$eval(sel, (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }).length)
/** What the Poltergeist's trick `trick` says about Tari: the text of its result on the Tari ledger (the second result of a trick). */
const tari = (trick) => page.$$eval(`#polt-body .trick[data-trick="${trick}"] .res`, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()).find((t) => /^tari\b/i.test(t)) ?? '')
const netRows = () => page.evaluate(() => [...document.querySelectorAll('#net-rows tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim())))
const idle = () => waitFor(() => document.getElementById('stranger-body').getAttribute('aria-busy') !== 'true')
/** The page scrolls itself after a call; wait until it has stopped. */
async function settle() {
  let last = -1, still = 0
  for (let i = 0; i < 60 && still < 5; i++) {
    const y = await page.evaluate(() => scrollY)
    still = y === last ? still + 1 : 0
    last = y
    await sleep(100)
  }
}
/** Our own scroll, eased, so the film shows a hand moving the page rather than a jump. */
const scrollTo = (y, ms = 1000) => page.evaluate((to, dur) => new Promise((done) => {
  const from = scrollY, t0 = performance.now(), max = document.documentElement.scrollHeight - innerHeight
  const target = Math.max(0, Math.min(max, to))
  const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur)
    window.scrollTo({ top: from + (target - from) * ease(p), behavior: 'instant' })
    if (p < 1) requestAnimationFrame(step)
    else done()
  }
  requestAnimationFrame(step)
}), y, ms)

/** One caption: runs the action, then holds until `hold` seconds have passed since the caption came up. The next caption starts at once (the band is never empty). */
async function beat(scene, caption, hold, act = async () => {}) {
  must(!BANNED.test(caption), `a word the captions must not use: ${caption}`)
  const from = cursor
  await act()
  const left = hold - (now() - from)
  if (left > 0) await sleep(left * 1000)
  const to = now()
  caps.push({ text: caption, scene, from, to })
  cursor = to
  texts.push(await page.evaluate(() => document.body.innerText))
}

const frames = [] // { ts, file }
const cleanup = []
try {
  const profile = mkdtempSync(join(WORK, 'profile-'))
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: profile, defaultViewport: null,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-extensions', '--no-first-run', '--force-color-profile=srgb', '--hide-scrollbars', '--lang=en-US', `--force-device-scale-factor=${SCALE}`],
  })
  cleanup.push(() => browser.close().catch(() => {}), () => rmSync(profile, { recursive: true, force: true }))
  page = await browser.newPage()
  page.on('request', (r) => { if (!/^(data|blob):/.test(r.url())) sent.push({ url: r.url(), method: r.method(), body: r.postData() ?? null, cut: sentAfterCut !== null }) })
  cdp = await page.createCDPSession()
  // The scale comes from the launch flag (deviceScaleFactor 0 keeps it), so the screencast frames are real 1280 x 640 pixels; with an emulated scale they would be 1000 x 500 and blurred by the enlargement.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: CSS_W, height: CSS_H, deviceScaleFactor: 0, mobile: false })
  cdp.on('Page.screencastFrame', (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    const file = join(FRAMES, `${String(frames.length).padStart(6, '0')}.jpg`)
    writeFileSync(file, Buffer.from(f.data, 'base64'))
    frames.push({ ts: f.metadata.timestamp, file })
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: PAGE_H, everyNthFrame: 1 })

  // ---- the page opens, the way a visitor finds it ----
  await page.goto(SITE, { waitUntil: 'load' })
  await waitFor(() => document.querySelectorAll('#demo option').length > 0, 40000)
  await idle()
  await waitFor(() => document.querySelector('#audit-reading .reading') && !document.querySelector('#audit-reading .counting'), 90000)
  await sleep(1500) // the fade-ins are over
  const t0 = now()
  cursor = t0

  // The captions are the narration, one beat each, ids l01..l14 in this order (scratch/seance-theme/seance-v2-narration.json). A caption is on screen from the moment its beat starts and
  // the action runs first, so the script throws unless the page then shows what the caption says. A hold is what the voice needs (0.7 s plus the line at 15 characters a second) plus 0.2 s.

  // ---- A. Tari's own secrets, on one saved real payment: what a stranger cannot read, what a view key and an audit key read, what a patient ghost still ties together, what still leaks ----
  // l01: the Stranger holds no key; the amount, the memo and the receiver are hidden from it
  await beat('hook', 'This saved copy of a real Tari testnet payment hides its amount, memo and receiver from a stranger with no key.', 8.3, async () => {
    const source = await text('#stranger-body .source')
    must(/^Recorded: the page's starting example, a copy saved on \d{4}-\d\d-\d\d\./.test(source), `the Stranger does not say that the example is a saved copy: ${source}`)
    must(/Esmeralda testnet/i.test(await text('.hero')), 'the page does not say that it is about the Esmeralda testnet')
    const lede = await text('.hero .lede')
    must(lede.includes('only the keys it was sealed for open it') && !lede.includes('only one key'), `the page is not the one with the claims fix (SV2-9, main 7f5c562 or later); its first screen says: ${lede}`) // a take of the old page would show "only one key opens it" for the first seconds
    must((await text('#stranger .role')) === 'Holds no key. Sees what everyone sees.', 'the Stranger does not say that it holds no key')
    const rows = await netRows()
    must(rows.length > 0 && rows.every((r) => r[2] === SITE_HOST), 'the log holds a request to a host that is not the site') // a saved copy: nothing has been asked of the indexer yet
    await sleep(600) // the top of the page first, then down to the Stranger
    await scrollTo((await top('#stranger')) - 14, 1200)
    must((await shown('.lens .role')) === 3 && (await shown('#stranger-body .source')) === 1, 'the three roles and the source line do not fit in one view')
    await sleep(1500)
    must((await text('#stranger-body .veiled')) === 'Amount, memo and receiver: hidden from you', `the sealed note says: ${await text('#stranger-body .veiled')}`)
    await scrollTo((await top('#stranger-body .veiled')) - 236, 2000) // down to the bar that says what the Stranger cannot read
    must((await shown('#stranger-body .veiled')) >= 1, 'the bar that hides the amount, the memo and the receiver is not in view')
  })
  // l02: the Medium's view key opens one sealed note, inside this page
  await beat('medium', 'The Medium\'s view key opens one sealed note, amount and memo, inside this page. The key was not sent anywhere.', 8.3, async () => {
    const reading = await text('#reading')
    must(reading.includes('0.00031415 SEANCE') && reading.includes('Midnight at the old crypt. Come alone.') && reading.includes('The key was not sent anywhere.'), `the Medium does not read the amount and the memo: ${reading}`)
    must((await text('.lens.medium .role')).startsWith('Holds a recipient\'s view key.'), 'the Medium does not say that it holds a view key')
    await scrollTo((await top('#stranger')) - 14, 1600) // back up to the three roles: the Medium and its key
    must((await shown('.lens.medium .role')) === 1, 'the Medium is not in view')
    await sleep(1400)
    const y = (await bottom('#reading')) + 24 - CSS_H
    await scrollTo(y, 900) // down to what it reads
    must((await top('#reading')) >= y && (await bottom('#reading')) <= y + CSS_H, 'the Medium\'s reading does not fit in one view')
  })
  // l03: the Auditor's key counts the amounts and cannot open the memo
  await beat('auditor', 'The Auditor holds the token\'s audit key. It counts both amounts, but the memo stays shut to it.', 7.3, async () => {
    const audit = await text('#audit-reading')
    must(audit.includes('0.00031415 SEANCE') && audit.includes('0.00018585 SEANCE') && audit.split('Memo: shut. The audit key cannot open it.').length === 3 && audit.includes('The key was not sent anywhere.'), `the Auditor's reading: ${audit}`)
    must((await text('.lens.auditor .role')) === 'Holds a token\'s audit key. Counts the amounts. Cannot read a memo.', 'the Auditor does not say what it holds')
    await scrollTo((await top('#stranger')) - 14, 1000) // up to the Auditor and its key
    must((await shown('.lens.auditor .role')) === 1, 'the Auditor is not in view')
    await sleep(1200)
    const y = (await bottom('#audit-reading')) + 24 - CSS_H
    await scrollTo(y, 800) // down to what it counts, with the Medium's reading beside it
    must((await top('#audit-reading')) >= y && (await bottom('#audit-reading')) <= y + CSS_H, 'the Auditor\'s reading does not fit in one view')
  })
  // l04 and l05: the Poltergeist has no key; on these 11 demo payments (the page's own count; it is not a result for Tari in general) address reuse ties none and amount matching finds one, while timing, the fee fingerprint and the spend graph still tie all 11
  await beat('poltergeist', 'The Poltergeist has no key. On these 11 demo payments, address reuse ties none and amount matching finds one.', 8.5, async () => {
    const lead = await text('#poltergeist .lead')
    must(lead.startsWith('A ghost with no keys at all, only patience.') && lead.includes('were they all sent by the same wallet?'), `the Poltergeist says: ${lead}`)
    must(/^TARI\b.*\b0 of 11 Ties none\b/i.test(await tari('reuse')), `address reuse on Tari: ${await tari('reuse')}`)
    must(/^TARI\b.*\b1 of 11 Finds some\b/i.test(await tari('amount')), `amount matching on Tari: ${await tari('amount')}`)
    await scrollTo((await top('#poltergeist')) - 8, 1700) // the Poltergeist, what it asks, its first trick
    must((await shown('#polt-body .trick[data-trick="reuse"]')) === 1, 'the first trick is not in view')
    await sleep(1200)
    await scrollTo((await top('#polt-body')) - 20, 900) // the first two tricks, each with its count on the transparent ledger and on Tari
    must((await shown('#polt-body .trick[data-trick="reuse"], #polt-body .trick[data-trick="amount"]')) === 2, 'the first two tricks do not fit in one view')
  })
  await beat('poltergeist', 'Timing, the fee fingerprint and the spend graph still tie all 11 payments.', 6.1, async () => {
    for (const trick of ['timing', 'fee', 'spend']) must(/^TARI\b.*\b11 of 11 Ties every payment\b/i.test(await tari(trick)), `${trick} on Tari: ${await tari(trick)}`)
    const verdict = await text('#polt-body .verdict')
    must(verdict.includes('For these 11 recorded payments,') && verdict.endsWith('Timing, the fee fingerprint and the spend graph still tie all 11.'), `the verdict says: ${verdict}`) // the fixed page scopes the count to the recorded payments; the old page said "On Tari,"
    await scrollTo((await top('#polt-body .trick[data-trick="timing"]')) - 9, 1000) // timing and the fee fingerprint
    must((await shown('#polt-body .trick[data-trick="timing"], #polt-body .trick[data-trick="fee"]')) === 2, 'timing and the fee fingerprint do not fit in one view')
    await sleep(1700)
    await scrollTo((await bottom('#polt-body > .caption')) + 12 - CSS_H, 800) // the spend graph, the verdict and the note under it
    must((await shown('#polt-body .trick[data-trick="spend"], #polt-body .verdict, #polt-body > .caption')) === 3, 'the spend graph, the verdict and the note do not fit in one view')
  })
  // l06: what anyone can still read (five of the page's eleven items, said as a sample: "and more"; the signing keys are among them; the size of the locked message says whether a memo is inside)
  await beat('leaks', 'Anyone can still read the token, spent notes, times, fee, signing keys and more. The locked message\'s size shows if a memo is inside.', 9.7, async () => {
    idPending = idInList().then((v) => ({ v }), (e) => ({ e })) // the id for the lookup below, asked for now so that no caption waits for it
    const leadText = await text('#leaks .lead')
    must(leadText.includes('Everything below is read by anyone, with no key at all'), `the leaks panel says: ${leadText}`) // "Anyone can still read"
    must((await page.$$eval('#leaks .leak', (els) => els.length)) > 5, 'the leaks panel holds no more than the items the caption names') // "and more"
    const size = await text('#leaks .leak[data-leak="length"]')
    must(size.includes('a memo is inside') && size.includes('no memo'), `the page says about the size: ${size}`)
    const signers = await text('#leaks .leak[data-leak="signers"]') // the 11th and last item, added by the claims fix (SV2-9)
    must(/^signing keys [0-9a-f]{12}…[0-9a-f]{12}/i.test(signers) && signers.includes('The public keys that signed it are in the open.'), `the page says about the signing keys: ${signers}`)
    await scrollTo((await top('#leaks')) - 8, 1800) // back up: the lead, the token and the spent notes
    must((await shown('#leaks .lead, #leaks .leak[data-leak="token"], #leaks .leak[data-leak="spent"]')) === 3, 'the lead, the token and the spent notes are not in view')
    await sleep(1000)
    // The list has three columns at this width: row 3 is the times, the epoch window and the fee, row 4 the size of the locked message and the signing keys (last, below the fold).
    // Depends on the height of the leaks panel: the first view needs the lead and row 1 to fit in 500 css px, the second row 3 and row 4 (measured 2026-10-30: 480 px of 500, 10 px spare).
    const y = Math.max((await top('#leaks .leak[data-leak="times"]')) - 10, (await bottom('#leaks .leak[data-leak="signers"]')) + 14 - CSS_H)
    await scrollTo(y, 900) // the times, the fee, the size of the locked message and the signing keys
    must((await shown('#leaks .leak[data-leak="times"], #leaks .leak[data-leak="fee"], #leaks .leak[data-leak="length"], #leaks .leak[data-leak="signers"]')) === 4, 'the times, the fee, the message size and the signing keys do not fit in one view')
  })

  // ---- B. Even looking stays private: what the page asks of the network ----
  // l07: a pasted id is looked for in the indexer's latest 40, in the browser. One of the page's prepared demo ids is asked for by id at once (no list first), so no caption says "any id".
  await beat('crowd', 'Paste the id of a recent transaction. The page finds it in the indexer\'s latest 40, so the indexer was not asked for this id.', 9.6, async () => {
    const got = await idPending
    if (got.e) throw got.e
    await scrollTo((await top('#picker')) - 14, 2200) // back up to the field
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.type(got.v, { delay: 12 })
    await waitFor(() => !document.getElementById('look').disabled)
    await page.focus('#look') // the focus ring shows which button is pressed
    await page.keyboard.press('Enter')
    await waitFor(() => /^Live: found in the indexer's latest 40 transactions, so the indexer was not asked for this id\./.test(document.querySelector('#stranger-body .source')?.textContent ?? ''), 30000)
    await idle()
    await settle()
    must((await shown('#stranger-body .source')) === 1, 'the line that says the indexer was not asked is not in view')
    const theirs = (await netRows()).filter((r) => r[2] !== SITE_HOST)
    must(theirs.length === 1 && theirs[0][2] === INDEXER_HOST && theirs[0][3] === LIST_PATH && theirs[0][6] === '200', `the log should hold one request to the indexer, the list: ${JSON.stringify(theirs)}`)
  })
  // l08: an id that is not in that list is asked for only when the visitor presses the button
  await beat('crowd', 'This id is not in that list, so the page asks for it only if you press Ask for it anyway.', 6.9, async () => {
    await scrollTo((await top('#txid')) - 16, 1100)
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.type('ab'.repeat(32), { delay: 12 }) // an id nobody holds
    await waitFor(() => !document.getElementById('look').disabled)
    await page.focus('#look')
    await page.keyboard.press('Enter')
    await waitFor(() => /^This id is not among the indexer's latest \d+ transactions?\./.test(document.getElementById('status').textContent) && !document.getElementById('ask').hidden, 30000)
    const buttons = await page.$$eval('#ask button', (bs) => bs.map((b) => b.textContent.trim()))
    must(buttons.join('|') === 'Ask for it anyway|Open a saved transaction file', `the buttons are ${buttons.join('|')}`)
    await settle()
    const y = Math.max((await top('#txid')) - 16, (await bottom('#ask')) + 14 - CSS_H) // the field and the two buttons in one view
    await scrollTo(y, 700)
    must((await top('#txid')) >= y && (await bottom('#ask')) <= y + CSS_H, 'the field and the buttons do not fit in one view')
    must(/^This id is not among the indexer's latest/.test(await text('#status')) && !(await page.$eval('#ask', (el) => el.hidden)), 'the page does not say the id is not in the list')
    must((await netRows()).filter((r) => r[2] === INDEXER_HOST).every((r) => r[3] === LIST_PATH), 'the log holds a request for an id')
  })
  // l09: the connection check: one real press, one request to the indexer's front door (Cloudflare), sent while the network is still on; the caption names the link it covers and says that it covers that link only (the page's answer on screen says "This covers only that connection")
  await beat('log', 'Check my connection adds one request to the log. The link to Cloudflare, which fronts the indexer, used a hybrid post-quantum key exchange; it covers that link only.', 11.9, async () => {
    await page.evaluate(() => (document.querySelector('#netlog details').open = true)) // the table of requests, one by one
    const rowsBefore = await netRows()
    const headBefore = HEAD.exec(await text('#net-head'))
    must(headBefore !== null && Number(headBefore[1]) === rowsBefore.length && Number(headBefore[2]) === new Set(rowsBefore.map((r) => r[2])).size, 'the headline does not count the rows before the check')
    must(rowsBefore.every((r) => r[2] === SITE_HOST || (r[2] === INDEXER_HOST && r[3] === LIST_PATH)), 'a row for something other than the site and the list')
    must(sent.every((r) => new URL(r.url).pathname !== TRACE_PATH), 'the connection check was sent before the press')
    await waitFor(() => document.getElementById('check-conn').getAttribute('aria-disabled') !== 'true') // shipped as not ready; main.ts clears it
    await scrollTo((await top('#netlog')) - 8, 1200)
    await sleep(600)
    await page.focus('#check-conn') // the focus ring shows which button is pressed
    await sleep(400)
    await page.keyboard.press('Enter')
    await waitFor(`document.querySelectorAll('#net-rows tr').length === ${rowsBefore.length + 1}`, 30000)
    await waitFor(() => { const t = document.getElementById('check-out').textContent ?? ''; return t !== '' && !t.startsWith('Sending') }, 30000)
    const rows = await netRows()
    const last = rows.at(-1)
    must(last[2] === INDEXER_HOST && last[3] === TRACE_PATH && last[6] === '200', `the new row of the log is not the connection check: ${JSON.stringify(last)}`)
    must(/^Your IP address, the time and the headers/.test(last[7]) && last[7].endsWith('This is the connection check you pressed.'), `the new row does not say it is the check: ${last[7]}`)
    const head = HEAD.exec(await text('#net-head'))
    must(head !== null && Number(head[1]) === rows.length && Number(head[3]) === Number(headBefore[3]), 'the headline does not count the check as one request that names no transaction id')
    must((await text('#check-out')) === norm(kexMessage('X25519MLKEM768')), `the page says: ${await text('#check-out')}`) // the hybrid sentence, word for word; anything else fails the take
    must(sent.filter((r) => new URL(r.url).pathname === TRACE_PATH).length === 1, 'the browser did not send exactly one connection check')
    const y = await page.evaluate(() => scrollY)
    must((await top('#check-conn')) >= y && (await bottom('#check-out')) <= y + CSS_H, 'the button and the answer do not fit in one view')
  })
  // l10: what the indexer still sees; the last row of the log, the check, says it in the page's own words
  await beat('log', 'The indexer still sees your IP address and the time.', 4.4, async () => {
    const last = (await netRows()).at(-1)
    must(last[2] === INDEXER_HOST && /^Your IP address, the time and the headers/.test(last[7]), `the last row of the log is not the indexer's: ${JSON.stringify(last)}`)
    const y = (await bottom('#net-rows tr:last-child')) + 60 - CSS_H
    await scrollTo(y, 1200)
    must((await top('#net-rows tr:last-child')) >= y && (await bottom('#net-rows tr:last-child')) <= y + CSS_H, 'the last row of the log is not in view')
  })
  // l11: with the network cut, a saved file still opens, the Medium reads it, and the log says that opening it asked for nothing
  await beat('file', 'With the network cut, a saved file still opens and the Medium reads it. The log says 0 requests since the file opened.', 9.0, async () => {
    // the cut comes first, so the caption is true from its first frame
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    must((await page.evaluate(() => navigator.onLine)) === false, 'the browser is not offline')
    sentAfterCut = sent.length
    await scrollTo((await top('#open-file')) - 150, 1000)
    await page.evaluate(() => {
      window.__changed = false
      document.getElementById('file').addEventListener('change', () => (window.__changed = true), { once: true })
    })
    await sleep(500)
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#open-file')])
    await chooser.accept([EXAMPLE])
    await waitFor(() => window.__changed)
    await idle()
    await waitFor(() => !document.getElementById('net-file').hidden)
    await settle()
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('#keys label')].find((l) => l.innerText.trim().startsWith('Carol'))
      label.click()
    })
    await waitFor(() => /OPENS/i.test(document.getElementById('reading').innerText), 20000)
    must(!/spirits are quiet/i.test(await text('#reading')), 'the Medium is quiet')
    const y = (await bottom('#reading')) + 24 - CSS_H
    await scrollTo(y, 1000) // the Medium reads the file
    must((await top('#reading')) >= y && (await bottom('#reading')) <= y + CSS_H, 'the reading does not fit in one view')
    await sleep(1300)
    must((await text('#net-file')) === 'Since you opened your file: 0 requests.', `the log says: ${await text('#net-file')}`)
    must(sent.length === sentAfterCut, `the browser tried ${sent.length - sentAfterCut} request(s) after the network was cut`)
    await scrollTo((await top('#netlog')) - 8, 1000) // the log, with its line about the file
    must((await shown('#net-file')) === 1, 'the line of the log about the file is not in view')
  })

  // ---- C. Ghosts from later. The network is still cut: the page draws this from what it holds, and the end check counts 0 requests after the cut. ----
  await beat('later', 'The Doppelganger copies a key. A ladder shows what each key opens and whether it can spend.', 7.5, async () => {
    await waitFor(() => { const d = document.getElementById('later-doppelganger'); return /^[0-9a-f]{64}$/.test(d.dataset.tx ?? '') && d.querySelectorAll('.later-rung').length === 4 }, 30000)
    must((await text('#later-doppelganger .later-how')).startsWith('It copies a key and reads with it.'), 'the Doppelganger does not say that it copies a key')
    const rungs = await page.$$eval('#later-doppelganger .later-rung', (rs) => rs.map((r) => ({ id: r.dataset.rung, labels: [...r.querySelectorAll('li > strong')].map((s) => s.textContent.trim()) })))
    must(rungs.map((r) => r.id).join() === 'none,view,audit,spend' && rungs.every((r) => r.labels.includes('Opens.') && r.labels.includes('Can spend.')), `the ladder: ${JSON.stringify(rungs)}`)
    const seen = new Set()
    const note = async () => (await inView('#later-doppelganger .later-rung h4', 'data-rung')).forEach((id) => seen.add(id))
    await scrollTo((await top('#later-doppelganger')) - 8, 2000) // the heading and the first two rungs
    await note()
    await sleep(1500)
    await scrollTo((await bottom('#later-doppelganger [data-rung="view"]')) + 12 - CSS_H, 1200) // what rungs 1 and 2 say about spending and about stopping it
    await sleep(500)
    await scrollTo((await top('#later-doppelganger [data-rung="audit"]')) - 8, 1000) // rungs 3 and 4
    await note()
    must(['none', 'view', 'audit', 'spend'].every((id) => seen.has(id)), `the rungs the film showed: ${[...seen].join()}`)
  })
  await beat('later', 'The Revenant: harvest now, decrypt later. Three tiers say what a computer that can solve discrete logarithms would read.', 9, async () => {
    await waitFor(() => { const r = document.getElementById('later-revenant'); return /^[0-9a-f]{64}$/.test(r.dataset.tx ?? '') && r.querySelectorAll('.later-tier').length === 3 }, 30000)
    must((await text('#later-revenant .later-how')) === norm(INTRO), `the Revenant says: ${await text('#later-revenant .later-how')}`)
    const tiers = await page.$$eval('#later-revenant .later-tier .later-says', (ps) => ps.map((p) => p.textContent.slice(0, 7)))
    must(tiers.join('|') === 'Tier 1.|Tier 2.|Tier 3.', `the tiers: ${tiers.join('|')}`)
    const seen = new Set()
    const note = async () => (await inView('#later-revenant .later-tier', 'data-tier')).forEach((n) => seen.add(n))
    await scrollTo((await top('#later-revenant')) - 8, 1400) // the heading, what it reads, and tier 1
    await note()
    await sleep(3000)
    await scrollTo((await top('#later-revenant .later-tier[data-tier="2"]')) - 8, 1100) // tiers 2 and 3
    await note()
    must([...seen].sort().join() === '1,2,3', `the tiers the film showed: ${[...seen].join()}`)
  })
  await beat('later', 'The Simulation box uses the demo keys we published in place of that computer, and says so.', 7.5, async () => {
    await waitFor(() => document.querySelectorAll('#later-revenant .later-sim-value').length > 0, 30000)
    must((await text('#later-revenant .later-sim-label')) === norm(SIMULATION), `the Simulation label says: ${await text('#later-revenant .later-sim-label')}`)
    const sim = await page.$$eval('#later-revenant .later-sim p', (ps) => ps.map((p) => [p.className, p.textContent]))
    const said = (cls, re) => sim.some(([c, t]) => c === cls && re.test(t))
    must(said('later-sim-line', /^Tier 2\. The demo view key of .+ stands in for the solved view key\.$/) && said('later-sim-value', / opens: /) && said('later-sim-line', /^Tier 3\. The demo audit key stands in for the solved audit key\.$/) && said('later-sim-value', / counted: /), `the Simulation box: ${JSON.stringify(sim.slice(1))}`)
    await scrollTo((await bottom('#later-revenant .later-sim')) + 24 - CSS_H, 3400) // down past the field-by-field list to the box
    const y = await page.evaluate(() => scrollY)
    must((await top('#later-revenant .later-sim')) >= y && (await bottom('#later-revenant .later-sim')) <= y + CSS_H, 'the Simulation box does not fit in one view')
  })
  const tEnd = cursor
  await cdp.send('Page.stopScreencast')
  const dim = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', frames[frames.length >> 1].file], { encoding: 'utf8' }).stdout.trim()
  must(dim === `${W},${PAGE_H}`, `the screencast frames are ${dim}, not ${W},${PAGE_H}`)

  // what the browser asked for, from the outside: only the site, the list requests and the one connection check, all plain GETs with no body, and nothing after the cut
  const hosts = new Set(sent.map((r) => new URL(r.url).host))
  must([...hosts].every((h) => h === SITE_HOST || h === INDEXER_HOST), `the browser asked another host: ${[...hosts].join(', ')}`)
  must(sent.every((r) => r.method === 'GET' && r.body === null), 'a request that is not a plain GET')
  const indexer = sent.filter((r) => new URL(r.url).host === INDEXER_HOST).map((r) => new URL(r.url).pathname + new URL(r.url).search)
  must(indexer.length > 0 && indexer.every((p) => p === LIST_PATH || p === TRACE_PATH), `requests to the indexer: ${indexer.join(', ')}`)
  must(indexer.filter((p) => p === TRACE_PATH).length === 1, `connection checks sent: ${indexer.filter((p) => p === TRACE_PATH).length}`)
  must(sent.length === sentAfterCut, 'requests after the network was cut')
  console.log(`browser requests: ${sent.length} (indexer: ${indexer.length}, the list "${LIST_PATH}" and one "${TRACE_PATH}"), after the cut: ${sent.length - sentAfterCut}`)

  // ---- the frames, each held until the next one arrived ----
  frames.sort((a, b) => a.ts - b.ts)
  const first = frames.findLast((f) => f.ts <= t0) ?? frames[0]
  must(first !== undefined, 'the screencast delivered no frame before the page was ready')
  const used = [{ ...first, ts: t0 }, ...frames.filter((f) => f.ts > t0 && f.ts < tEnd)]
  const list = ['ffconcat version 1.0']
  used.forEach((f, i) => list.push(`file '${f.file}'`, `duration ${Math.max(0.001, (i + 1 < used.length ? used[i + 1].ts : tEnd) - f.ts).toFixed(4)}`))
  list.push(`file '${used.at(-1).file}'`)
  writeFileSync(join(WORK, 'frames.ffconcat'), list.join('\n') + '\n')
  const mainS = tEnd - t0
  console.log(`filmed ${mainS.toFixed(1)} s, ${used.length} frames used of ${frames.length}`)

  // ---- the captions: burned into a band below the page ----
  const wrap = (s) => {
    if (s.length <= 66) return s
    const mid = s.length / 2
    const at = [...s.matchAll(/ /g)].map((m) => m.index).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0]
    return `${s.slice(0, at)}\n${s.slice(at + 1)}`
  }
  const rel = (t) => (t - t0).toFixed(3)
  const draw = caps.map((c, i) => {
    writeFileSync(join(WORK, `cap${i}.txt`), wrap(c.text))
    return `drawtext=fontfile=${FONT}:textfile=${join(WORK, `cap${i}.txt`)}:expansion=none:fontsize=27:line_spacing=7:fontcolor=0xefeaf8:text_align=center:x=(w-text_w)/2:y=${PAGE_H}+(${BAND}-text_h)/2:enable='between(t,${rel(c.from)},${rel(c.to)})'`
  })
  const band = `drawbox=x=0:y=${PAGE_H}:w=${W}:h=2:color=0xffb454e6:t=fill`

  // ---- the end card, drawn in the page's colours ----
  const day = new Date().toISOString().slice(0, 10)
  const SUBTITLE = 'Seance: three ghosts read one private Tari payment' // tells this entry apart from another one that is called Séance
  const address = SITE.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const card = await browser.newPage()
  await card.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await card.setContent(`<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
    body { box-sizing: border-box; padding: 0 110px; display: flex; flex-direction: column; justify-content: center; color: #efeaf8; background: radial-gradient(900px 520px at 15% 0%, rgba(124, 96, 210, .34), transparent 72%), #${BG}; font: 28px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
    .kicker { margin: 0 0 4px; font-size: 24px; letter-spacing: .12em; text-transform: uppercase; color: #c4b2ff; }
    h1 { margin: 0 0 6px; font: 600 160px/1.05 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; text-shadow: 0 0 40px rgba(255, 180, 84, .4); }
    .sub { margin: 0 0 22px; height: 52px; font: 600 40px/52px 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; white-space: nowrap; }
    .addr { margin: 0 0 28px; font: 700 50px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; color: #ffb454; }
    .line { margin: 0 0 6px; font: 600 40px/1.3 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
    .small { margin: 22px 0 0; font-size: 24px; color: #bdb6d3; }
  </style><p class="kicker">Tari Ootle · Esmeralda testnet</p><h1>Seance</h1><p class="sub">${SUBTITLE}</p><p class="addr">${address}</p><p class="line">Built by AI agents (Claude Code)</p><p class="small">A silent screen recording of the live page, filmed ${day}.</p>`)
  await card.screenshot({ path: join(WORK, 'card.png'), type: 'png' })
  const cardText = await card.evaluate(() => document.body.innerText)
  // the voiced cut repaints the last line of this card (scripts in the narration folder), so that line must stay where it was drawn: y 562 to 618
  const small = await card.evaluate(() => { const b = document.querySelector('.small').getBoundingClientRect(); const s = document.querySelector('.sub'); return { top: b.top, bottom: b.bottom, subWide: s.scrollWidth - s.clientWidth, subHigh: s.getBoundingClientRect().height } })
  must(norm(cardText).includes(SUBTITLE) && norm(cardText).includes(address), 'the end card does not show the subtitle and the page address')
  must(small.subWide <= 0 && Math.abs(small.subHigh - 52) < 1, `the subtitle of the end card does not fit on one line: ${JSON.stringify(small)}`)
  must(small.top >= 562 && small.bottom <= 618, `the last line of the end card is at ${small.top} to ${small.bottom}, outside 562 to 618`)
  await card.close()
  texts.push(cardText, ...caps.map((c) => c.text))

  // ---- one encode: the filmed page with captions, a short cross-fade, the end card ----
  const graph = [
    `[0:v]fps=${FPS},scale=${W}:${PAGE_H}:flags=lanczos+accurate_rnd:in_range=pc:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709,format=yuv420p,pad=${W}:${H}:0:0:color=0x${BG},${band},${draw.join(',')},setsar=1,settb=1/${FPS}[m]`,
    `[1:v]fps=${FPS},scale=${W}:${H}:flags=lanczos+accurate_rnd:out_range=tv:out_color_matrix=bt709,format=yuv420p,setsar=1,settb=1/${FPS}[c]`,
    `[m][c]xfade=transition=fade:duration=${FADE_S}:offset=${(mainS - FADE_S).toFixed(3)},setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[v]`,
  ].join(';')
  mkdirSync(dirname(OUT), { recursive: true })
  const ff = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(WORK, 'frames.ffconcat'), '-loop', '1', '-framerate', String(FPS), '-t', String(END_S + FADE_S), '-i', join(WORK, 'card.png'),
    '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(process.env.CRF ?? 26), '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(FPS), '-movflags', '+faststart', OUT], { stdio: 'inherit' })
  must(ff.status === 0, 'ffmpeg failed')

  writeFileSync(join(WORK, 'captions.json'), JSON.stringify({ t0, mainS, captions: caps.map((c) => ({ scene: c.scene, text: c.text, from: Number(rel(c.from)), to: Number(rel(c.to)) })) }, null, 1) + '\n')
  writeFileSync(join(WORK, 'all-text.txt'), texts.join('\n---\n') + '\n')
  console.log(`wrote the silent cut ${OUT}`)
} finally {
  for (const done of cleanup.reverse()) await Promise.resolve(done()).catch(() => {})
  if (!KEEP_WORK) rmSync(WORK, { recursive: true, force: true })
}
process.exit(0)
