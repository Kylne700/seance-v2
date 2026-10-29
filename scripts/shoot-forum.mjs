// Maintainer script: draws the pictures for the forum post into public/media/ from the production build, and keeps none that is not what it says it is.
//   npm run build && nice -n 19 node scripts/shoot-forum.mjs
//   FORUM_URL=https://kylne700.github.io/seance-v2/ node scripts/shoot-forum.mjs      (after the push: shoot the deployed site itself, not dist/)
// Needs Chromium (CHROMIUM=/path overrides /usr/bin/chromium) and, for the local build, openssl. SHOOT_PORT=4376 is the local port (and the next one).
// SHOOT_WIDTH=1000 is the page's width in CSS px; it is drawn at 1280 / SHOOT_WIDTH, so every picture is 1280 px wide and its text is not smaller than it has to be
// when the forum shrinks the picture.
//
// Without FORUM_URL, dist/ is served on 127.0.0.1 (HTTPS, with a certificate made for this run) and Chromium is told to resolve kylne700.github.io to it, so the page's
// own files are fetched the way a visitor's browser fetches them and the Host column of the ghost log reads what a visitor will see. The indexer is the real one.
// Three pictures, each in a fresh browser context:
//   ghost-log-after-summon.png   the ghost log after "Summon a recent transaction" (the real list of latest transactions). Only the log is in the picture,
//                                never the transaction that was summoned.
//   ask-for-it-anyway.png        what the page says for an id that the indexer's list did not hold (an id made up here), with its two buttons.
//   saved-file-0-requests.png    the ghost log after a saved transaction file is opened, in a browser that cannot reach any other host: "0 requests".
// Before a picture is kept: no transaction id in its text, the log rows are the ones the picture is meant to show, it is 1280 px wide and under 300 KB.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { INDEXER_URL } from '../src/config.ts'
import { serveDir } from './serve.mjs'

delete process.env.DISPLAY // headless only, never a real screen
const LOCAL = !process.env.FORUM_URL
const SITE = process.env.FORUM_URL ?? 'https://kylne700.github.io/seance-v2/'
const SITE_HOST = new URL(SITE).host
const INDEXER_HOST = new URL(INDEXER_URL).host
const PORT = Number(process.env.SHOOT_PORT ?? 4376)
const WIDTH = Number(process.env.SHOOT_WIDTH ?? 1000)
const WIDE = 1280
const MAX_BYTES = 300 * 1024
const OUT = fileURLToPath(new URL('../public/media/', import.meta.url))
const EXAMPLE = fileURLToPath(new URL('../examples/saved-transaction.json', import.meta.url)) // our own demo transaction
const MADE_UP = 'ab'.repeat(32) // an id nobody holds, so no list holds it either
const ID_LIKE = /[0-9a-f]{6}…[0-9a-f]{6}|[0-9a-f]{32}/i // a transaction id, whole or as the log shortens it
const SIZE = /^(\d+ bytes|[\d.]+ KB)$/ // how the log writes a size it knows ("unknown" otherwise)
const known = (s) => SIZE.test(s) && s !== '0 bytes'
const HEAD = /^This page sent (\d+) requests? to (\d+) hosts?; your keys were in none of them\.$/

const must = (ok, what) => {
  if (!ok) throw new Error(`not kept: ${what}`)
}
const text = (page, selector) => page.$eval(selector, (e) => e.innerText.replace(/\s+/g, ' ').trim())
const netRows = (page) => page.evaluate(() => [...document.querySelectorAll('#net-rows tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim())))
const waitFor = (page, fn, ms = 30000) => page.waitForFunction(fn, { timeout: ms, polling: 100 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cleanup = []
const tmp = mkdtempSync(join(tmpdir(), 'seance-forum-'))
cleanup.push(() => rmSync(tmp, { recursive: true, force: true }))

// the local build, under the Pages address: an HTTP server for dist/ (its content types are serve.mjs's), and an HTTPS front for it with a throwaway certificate
if (LOCAL) {
  const http = await serveDir(fileURLToPath(new URL('../dist', import.meta.url)), PORT, '/seance-v2/')
  cleanup.push(() => http.close())
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tmp, 'key.pem'), '-out', join(tmp, 'crt.pem'), '-days', '1', '-subj', `/CN=${SITE_HOST}`, '-addext', `subjectAltName=DNS:${SITE_HOST}`], { stdio: 'ignore' })
  const front = https.createServer({ key: readFileSync(join(tmp, 'key.pem')), cert: readFileSync(join(tmp, 'crt.pem')) }, async (req, res) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${req.url}`)
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(Buffer.from(await r.arrayBuffer()))
  })
  await new Promise((ok, fail) => {
    front.once('error', fail)
    front.listen(PORT + 1, '127.0.0.1', ok)
  })
  cleanup.push(() => front.close())
}

/** A Chromium of its own. `cut`: every host but the site's is unresolvable, so a request to anywhere else cannot leave. */
async function launch(cut) {
  const rules = [LOCAL ? `MAP ${SITE_HOST} 127.0.0.1:${PORT + 1}` : null, cut ? 'MAP * ~NOTFOUND' : null, cut ? `EXCLUDE ${LOCAL ? '127.0.0.1' : SITE_HOST}` : null].filter(Boolean)
  const args = ['--no-sandbox', '--disable-dev-shm-usage', ...(LOCAL ? ['--ignore-certificate-errors'] : []), ...(rules.length ? [`--host-resolver-rules=${rules.join(', ')}`] : [])]
  const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: mkdtempSync(join(tmp, 'profile-')), args })
  cleanup.push(() => browser.close())
  return browser
}

/** A page that is ready the way a visitor finds it: the code has started and the saved example is drawn and counted. */
async function start(browser) {
  const page = await (await browser.createBrowserContext()).newPage()
  await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: WIDE / WIDTH })
  const outside = [] // every address that is not the site's, which the page tried
  page.on('request', (r) => {
    if (!/^(data|blob):/.test(r.url()) && new URL(r.url()).host !== SITE_HOST) outside.push(r.url())
  })
  await page.goto(SITE, { waitUntil: 'load' })
  await waitFor(page, () => document.querySelectorAll('#demo option').length > 0, 40000)
  await waitFor(page, () => document.getElementById('stranger-body').getAttribute('aria-busy') !== 'true')
  await waitFor(page, () => document.querySelector('#audit-reading .reading') && !document.querySelector('#audit-reading .counting'), 90000)
  return { page, outside }
}

/** The log as the picture shows it: the rows must be the requests this picture is about, and the headline must count them. */
async function checkLog(page, { indexer }) {
  let rows = []
  for (let i = 0; i < 100; i++) {
    rows = await netRows(page)
    if (rows.length > 0 && rows.every((r) => r[6] !== 'waiting')) break
    await sleep(100)
  }
  const head = HEAD.exec(await text(page, '#net-head'))
  must(head !== null && Number(head[1]) === rows.length && Number(head[2]) === new Set(rows.map((r) => r[2])).size, 'the headline does not count the rows')
  const theirs = rows.filter((r) => r[2] !== SITE_HOST)
  must(theirs.every((r) => r[2] === INDEXER_HOST), `a row for a host that is neither the site nor the indexer: ${theirs.map((r) => r[2]).join(', ')}`)
  must(rows.filter((r) => r[2] === SITE_HOST).every((r) => r[6] === '200' && known(r[5])), 'a file of the page has no status 200 or no size')
  if (indexer) {
    must(theirs.length === 1 && theirs[0][3].startsWith('/transactions/recent') && theirs[0][6] === '200' && known(theirs[0][4]) && known(theirs[0][5]), 'the log has to hold the one request to the indexer: the list, answered 200, with both sizes')
  } else {
    must(theirs.length === 0, 'the log holds a request to the indexer')
  }
  return rows
}

/** Crops from the top of one element to the bottom of another, across the whole width, and keeps the picture only when it passes the checks. */
async function keep(page, name, from, to, textOf, padTop = 14) {
  const shown = await page.evaluate((sels) => sels.map((s) => document.querySelector(s).innerText).join('\n'), textOf)
  must(!ID_LIKE.test(shown), `a transaction id is in the text of the picture (${name})`)
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), from)
  await sleep(1300) // the scroll and the 0.9 s fade-in must be over
  const box = await page.evaluate(
    ([a, b]) => ({ top: document.querySelector(a).getBoundingClientRect().top + scrollY, bottom: document.querySelector(b).getBoundingClientRect().bottom + scrollY }),
    [from, to],
  )
  const pad = 14
  const clip = { x: 0, y: Math.max(0, box.top - padTop), width: WIDTH, height: box.bottom - box.top + padTop + pad }
  const png = Buffer.from(await page.screenshot({ type: 'png', clip }))
  const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  must(w === WIDE, `${name} is ${w} px wide, not ${WIDE}`)
  must(png.length < MAX_BYTES, `${name} is ${Math.round(png.length / 1024)} KB, not under 300 KB`)
  writeFileSync(join(OUT, name), png)
  console.log(`wrote public/media/${name}  ${w}x${h}  ${Math.round(png.length / 1024)} KB`)
}
const show = (rows) => rows.forEach((r) => console.log(`   ${r.slice(0, 7).join(' | ')}`))
const openLog = (page) => page.evaluate(() => (document.querySelector('#netlog details').open = true))

try {
  console.log(`shooting ${LOCAL ? `dist/ as ${SITE}` : SITE}, the page drawn ${WIDTH} px wide at x${(WIDE / WIDTH).toFixed(3)}`)
  const open = await launch(false)

  // 1. the ghost log after Summon: the real list of latest transactions is asked for, and nothing else
  {
    const { page } = await start(open)
    await page.click('#summon')
    await waitFor(page, () => [...document.querySelectorAll('#net-rows tr')].some((tr) => /^\/transactions\/recent/.test(tr.children[3].textContent)))
    await waitFor(page, () => document.getElementById('stranger-body').getAttribute('aria-busy') !== 'true')
    const rows = await checkLog(page, { indexer: true })
    const source = await page.$eval('#stranger-body .source', (e) => e.textContent).catch(() => '')
    console.log(`   what Summon showed: ${/^Live:/.test(source) ? 'a live transaction' : /^Recorded:/.test(source) ? 'the recorded sample (a quiet chain)' : 'unknown'}`)
    await openLog(page)
    show(rows)
    await keep(page, 'ghost-log-after-summon.png', '#netlog', '#netlog details', ['#netlog h2', '#net-head', '#netlog details'])
    await page.close()
  }

  // 2. an id the list did not hold: the page says so, and the indexer has not been asked for it
  {
    const { page } = await start(open)
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.sendCharacter(MADE_UP)
    await page.click('#look')
    await waitFor(page, () => /^This id is not among the indexer's latest \d+ transactions?\. Asking the indexer for it by id would show it this id/.test(document.getElementById('status').textContent) && !document.getElementById('ask').hidden)
    const buttons = await page.$$eval('#ask button', (bs) => bs.map((b) => b.textContent.trim()))
    must(buttons.join('|') === 'Ask for it anyway|Open a saved transaction file', `the buttons are ${buttons.join('|')}`)
    const rows = await checkLog(page, { indexer: true })
    must(rows.every((r) => !/\/transactions\/(?!recent)/.test(r[3])), 'the log holds a request for an id')
    show(rows)
    await keep(page, 'ask-for-it-anyway.png', '.modebar', '#ask', ['.modebar', '#status', '#ask'], 5) // 5: the edge of the picture must not catch the end of the divider above
    await page.close()
  }

  // 3. a saved file: nothing asked, in a browser that cannot reach any other host, so a request would fail and be counted here
  {
    const { page, outside } = await start(await launch(true))
    await page.evaluate(() => {
      window.__changed = false
      document.getElementById('file').addEventListener('change', () => (window.__changed = true), { once: true })
    })
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#open-file')])
    await chooser.accept([EXAMPLE])
    await waitFor(page, () => window.__changed)
    await waitFor(page, () => document.getElementById('stranger-body').getAttribute('aria-busy') !== 'true')
    await waitFor(page, () => !document.getElementById('net-file').hidden)
    must((await text(page, '#net-file')) === 'Since you opened your file: 0 requests.', `the log says "${await text(page, '#net-file')}"`)
    const rows = await checkLog(page, { indexer: false })
    must(outside.length === 0, `the page asked for another host: ${outside.map((u) => new URL(u).host).join(', ')}`)
    await openLog(page)
    show(rows)
    await keep(page, 'saved-file-0-requests.png', '#netlog', '#netlog details', ['#netlog h2', '#net-head', '#net-file', '#netlog details'])
    await page.close()
  }
  console.log('all three kept')
} finally {
  for (const done of cleanup.reverse()) await Promise.resolve(done()).catch(() => {})
}
process.exit(0) // the servers and the browsers are closed; nothing may keep this process alive
