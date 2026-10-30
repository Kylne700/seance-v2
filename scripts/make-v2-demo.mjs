// Maintainer script: films the LIVE page and writes public/media/seance-v2-demo.mp4, a silent screen recording of version 2 (no audio track, no voice, no model).
//   node scripts/make-v2-demo.mjs
// Needs headless Chromium (CHROMIUM=/path overrides /usr/bin/chromium) and ffmpeg with libx264 and drawtext. LIVE_URL, WORK (where the frames and notes are kept; default a
// temp directory, removed at the end only when WORK is not set) and FONT (the caption font) can be set. It uses the real indexer, so a take can fail when the testnet is quiet
// or slow; run it again.
// How it works: Chromium is driven like a visitor (1000 css px wide, drawn at x1.28 so the text is not small in 1280 x 720) and its screencast frames are kept with their times.
// Each caption is one "beat": the action, a wait for the page to show what the caption says (the script throws when it does not), and a hold long enough to read. Nothing is
// faked: every state in the video is what the page showed. The network is cut for the saved-file scene (Chromium offline, the page already loaded) and the script counts the
// requests the browser tried to make from then on; it must be 0.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { INDEXER_URL } from '../src/config.ts'
import { parseTransaction } from '../src/chain.ts'

delete process.env.DISPLAY // headless only, never a real screen
delete process.env.WAYLAND_DISPLAY
const SITE = process.env.LIVE_URL ?? 'https://kylne700.github.io/seance-v2/'
const SITE_HOST = new URL(SITE).host
const INDEXER_HOST = new URL(INDEXER_URL).host
const KEEP_WORK = Boolean(process.env.WORK)
const WORK = process.env.WORK ?? mkdtempSync(join(tmpdir(), 'seance-v2-video-'))
const FRAMES = join(WORK, 'frames')
const OUT = fileURLToPath(new URL('../public/media/seance-v2-demo.mp4', import.meta.url))
const EXAMPLE = fileURLToPath(new URL('../examples/saved-transaction.json', import.meta.url)) // our own demo transaction
const FONT = process.env.FONT ?? '/usr/share/fonts/opentype/inter/Inter-Medium.otf'
const W = 1280, H = 720, BAND = 80, PAGE_H = H - BAND // the page above, a caption band below
const CSS_W = 1000, SCALE = W / CSS_W, CSS_H = PAGE_H / SCALE // 1000 x 500 css px, drawn at 1280 x 640
const FPS = 30, END_S = 5, FADE_S = 0.6
const BG = '0d0b13'
const BANNED = /\b(never|always|guarantees?|life-saving|untraceable|unbreakable|anonymous)\b/i

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
const sent = [] // every request the browser started: { url, method, body, cut }

const waitFor = (fn, ms = 30000) => page.waitForFunction(fn, { timeout: ms, polling: 100 })
const text = (sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim())
const top = (sel) => page.$eval(sel, (e) => e.getBoundingClientRect().top + scrollY)
const bottom = (sel) => page.$eval(sel, (e) => e.getBoundingClientRect().bottom + scrollY)
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

  // 1. a saved real transaction, already read: the Stranger (no key) and the Medium (a view key)
  await beat('open', 'A saved real transaction is on the table. Nothing has been asked of the indexer yet.', 4.4, async () => {
    must((await text('#status')).includes('Nothing has been asked of the indexer yet'), 'the status line does not say that nothing was asked')
    const rows = await netRows()
    must(rows.length > 0 && rows.every((r) => r[2] === SITE_HOST), 'the log holds a request to a host that is not the site')
    await sleep(700) // the top of the page first, then down to the line that says it
    await scrollTo((await bottom('#status')) + 24 - CSS_H, 1100)
  })
  await beat('open', 'The Stranger holds no key. It sees only what everyone can see.', 3.6, async () => scrollTo((await top('#stranger')) - 14, 1200))
  await beat('open', 'The Medium holds a recipient\'s view key. With it the page reads the amount and the memo.', 4.4, async () => {
    const reading = await text('#reading')
    must(reading.includes('0.00031415 SEANCE') && reading.includes('Midnight at the old crypt. Come alone.'), `the Medium does not read the amount and the memo: ${reading}`)
    await scrollTo((await bottom('#reading')) + 24 - CSS_H, 1300)
  })
  await beat('open', 'Read inside this page. The key was not sent anywhere.', 3.2, async () => {
    must((await text('#reading')).includes('The key was not sent anywhere.'), 'the Medium does not say the key was not sent')
  })

  // 2. hide in the crowd: the id is looked for in the latest 40, in the browser
  const id = await idInList()
  // The captions in this scene are about the ids on screen: one of the page's prepared demo ids is asked for by id at once (no list first), so no caption says "any id".
  await beat('crowd', 'Paste the id of a recent transaction. The page looks in the indexer\'s latest 40 first.', 4.2, async () => {
    await scrollTo((await top('#picker')) - 14, 1200)
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.type(id, { delay: 12 })
    await waitFor(() => !document.getElementById('look').disabled)
    await page.focus('#look') // the focus ring shows which button is pressed
  })
  await beat('crowd', 'It finds the id in that list, inside your browser. The indexer is not asked for it.', 5, async () => {
    await page.keyboard.press('Enter')
    await waitFor(() => /^Live: found in the indexer's latest 40 transactions, so the indexer was not asked for this id\./.test(document.querySelector('#stranger-body .source')?.textContent ?? ''), 30000)
    await idle()
    await settle()
    const rows = await netRows()
    const theirs = rows.filter((r) => r[2] !== SITE_HOST)
    must(theirs.length === 1 && theirs[0][2] === INDEXER_HOST && theirs[0][3] === '/transactions/recent?limit=40' && theirs[0][6] === '200', `the log should hold one request to the indexer, the list: ${JSON.stringify(theirs)}`)
  })
  await beat('crowd', 'Now an id that is not in that list.', 3, async () => {
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
    const asked = (await netRows()).filter((r) => r[2] === INDEXER_HOST)
    must(asked.every((r) => r[3] === '/transactions/recent?limit=40'), 'the log holds a request for an id')
  })
  await beat('crowd', 'The page asks for it only if you press Ask for it anyway.', 3.4, async () => {
    must(/^This id is not among the indexer's latest/.test(await text('#status')) && !(await page.$eval('#ask', (el) => el.hidden)), 'the page does not say the id is not in the list')
  })

  // 3. the ghost log
  await beat('log', 'The ghost log lists the requests the page made, and what each host learns from them.', 4.6, async () => {
    await scrollTo((await top('#netlog')) - 8, 1200)
    await page.evaluate(() => (document.querySelector('#netlog details').open = true))
    const head = /^This page sent (\d+) requests? to (\d+) hosts?; your keys were in none of them\.$/.exec(await text('#net-head'))
    const rows = await netRows()
    must(head !== null && Number(head[1]) === rows.length && Number(head[2]) === new Set(rows.map((r) => r[2])).size, 'the headline does not count the rows')
    must(rows.every((r) => r[2] === SITE_HOST || (r[2] === INDEXER_HOST && r[3] === '/transactions/recent?limit=40')), 'a row for something other than the site and the list')
  })
  await beat('log', 'The page wrote this list itself: a report to check, not a proof.', 3.6, async () => {
    must((await page.$eval('#netlog details', (d) => d.innerText)).includes('a report to check, not a proof'), 'the log does not say it is a report to check')
    await scrollTo((await bottom('#netlog details')) - CSS_H + 18, 900)
  })

  // 4. a saved transaction file, with the network cut
  await beat('file', 'Network cut. Open a saved transaction file.', 4, async () => {
    // the cut comes first, so the caption is true from its first frame
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    must((await page.evaluate(() => navigator.onLine)) === false, 'the browser is not offline')
    sentAfterCut = sent.length
    await scrollTo((await top('#open-file')) - 150, 1100)
    await page.evaluate(() => {
      window.__changed = false
      document.getElementById('file').addEventListener('change', () => (window.__changed = true), { once: true })
    })
    await sleep(900)
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#open-file')])
    await chooser.accept([EXAMPLE])
    await waitFor(() => window.__changed)
    await idle()
    await waitFor(() => !document.getElementById('net-file').hidden)
    await settle()
  })
  await beat('file', 'It still reads. With the right key the Medium opens the amount and the memo.', 4.6, async () => {
    await page.evaluate(() => {
      const label = [...document.querySelectorAll('#keys label')].find((l) => l.innerText.trim().startsWith('Carol'))
      label.click()
    })
    await waitFor(() => /OPENS/i.test(document.getElementById('reading').innerText), 20000)
    must(!/spirits are quiet/i.test(await text('#reading')), 'the Medium is quiet')
    await scrollTo((await bottom('#reading')) + 24 - CSS_H, 1200)
  })
  await beat('file', 'Opening a file makes no request. The log says so: 0 requests since the file was opened.', 4.6, async () => {
    must((await text('#net-file')) === 'Since you opened your file: 0 requests.', `the log says: ${await text('#net-file')}`)
    must(sent.length === sentAfterCut, `the browser tried ${sent.length - sentAfterCut} request(s) after the network was cut`)
    await scrollTo((await top('#netlog')) - 8, 1200)
  })

  // 5. what still leaks
  await beat('leaks', 'What still leaks: the token, the times, the fee and the spent notes.', 4, async () => {
    await scrollTo((await top('#leaks')) - 8, 1300) // the token and the spent notes first, then down to the times and the fee
    await sleep(1200)
    await scrollTo((await top('#leaks')) + 300, 1100)
  })
  await beat('leaks', 'The indexer still sees your IP address and the time. A VPN changes the IP address, not the id.', 5.4, async () => {
    const rows = await netRows() // back to the log: the row of the indexer says it in the page's own words
    must(rows.at(-1)[2] === INDEXER_HOST && /^Your IP address, the time and the headers/.test(rows.at(-1)[7]), `the last row of the log is not the indexer's: ${JSON.stringify(rows.at(-1))}`)
    await scrollTo((await bottom('#net-rows tr:last-child')) + 60 - CSS_H, 1700)
  })
  const tEnd = cursor
  await cdp.send('Page.stopScreencast')
  const dim = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', frames[frames.length >> 1].file], { encoding: 'utf8' }).stdout.trim()
  must(dim === `${W},${PAGE_H}`, `the screencast frames are ${dim}, not ${W},${PAGE_H}`)

  // what the browser asked for, from the outside: only the site and the one list request, all plain GETs with no body, and nothing after the cut
  const hosts = new Set(sent.map((r) => new URL(r.url).host))
  must([...hosts].every((h) => h === SITE_HOST || h === INDEXER_HOST), `the browser asked another host: ${[...hosts].join(', ')}`)
  must(sent.every((r) => r.method === 'GET' && r.body === null), 'a request that is not a plain GET')
  const indexer = sent.filter((r) => new URL(r.url).host === INDEXER_HOST).map((r) => new URL(r.url).pathname + new URL(r.url).search)
  must(indexer.length > 0 && indexer.every((p) => p === '/transactions/recent?limit=40'), `requests to the indexer: ${indexer.join(', ')}`)
  must(sent.length === sentAfterCut, 'requests after the network was cut')
  console.log(`browser requests: ${sent.length} (indexer: ${indexer.length}, all "/transactions/recent?limit=40"), after the cut: ${sent.length - sentAfterCut}`)

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
  const address = SITE.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const card = await browser.newPage()
  await card.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await card.setContent(`<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
    body { box-sizing: border-box; padding: 0 110px; display: flex; flex-direction: column; justify-content: center; color: #efeaf8; background: radial-gradient(900px 520px at 15% 0%, rgba(124, 96, 210, .34), transparent 72%), #${BG}; font: 28px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
    .kicker { margin: 0 0 4px; font-size: 24px; letter-spacing: .12em; text-transform: uppercase; color: #c4b2ff; }
    h1 { margin: 0 0 22px; font: 600 160px/1.05 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; text-shadow: 0 0 40px rgba(255, 180, 84, .4); }
    .addr { margin: 0 0 28px; font: 700 50px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; color: #ffb454; }
    .line { margin: 0 0 6px; font: 600 40px/1.3 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
    .small { margin: 22px 0 0; font-size: 24px; color: #bdb6d3; }
  </style><p class="kicker">Tari Ootle</p><h1>Seance</h1><p class="addr">${address}</p><p class="line">Tari Esmeralda testnet</p><p class="line">Built by AI agents (Claude Code)</p><p class="small">A silent screen recording of the live page, filmed ${day}.</p>`)
  await card.screenshot({ path: join(WORK, 'card.png'), type: 'png' })
  const cardText = await card.evaluate(() => document.body.innerText)
  await card.close()
  texts.push(cardText, ...caps.map((c) => c.text))

  // ---- one encode: the filmed page with captions, a short cross-fade, the end card ----
  const graph = [
    `[0:v]fps=${FPS},scale=${W}:${PAGE_H}:flags=lanczos+accurate_rnd:in_range=pc:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709,format=yuv420p,pad=${W}:${H}:0:0:color=0x${BG},${band},${draw.join(',')},setsar=1,settb=1/${FPS}[m]`,
    `[1:v]fps=${FPS},scale=${W}:${H}:flags=lanczos+accurate_rnd:out_range=tv:out_color_matrix=bt709,format=yuv420p,setsar=1,settb=1/${FPS}[c]`,
    `[m][c]xfade=transition=fade:duration=${FADE_S}:offset=${(mainS - FADE_S).toFixed(3)},setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[v]`,
  ].join(';')
  mkdirSync(fileURLToPath(new URL('../public/media/', import.meta.url)), { recursive: true })
  const ff = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(WORK, 'frames.ffconcat'), '-loop', '1', '-framerate', String(FPS), '-t', String(END_S + FADE_S), '-i', join(WORK, 'card.png'),
    '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(process.env.CRF ?? 26), '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-r', String(FPS), '-movflags', '+faststart', OUT], { stdio: 'inherit' })
  must(ff.status === 0, 'ffmpeg failed')

  writeFileSync(join(WORK, 'captions.json'), JSON.stringify({ t0, mainS, captions: caps.map((c) => ({ scene: c.scene, text: c.text, from: Number(rel(c.from)), to: Number(rel(c.to)) })) }, null, 1) + '\n')
  writeFileSync(join(WORK, 'all-text.txt'), texts.join('\n---\n') + '\n')
  console.log(`wrote ${OUT.replace(/^.*\/public\//, 'public/')}`)
} finally {
  for (const done of cleanup.reverse()) await Promise.resolve(done()).catch(() => {})
  if (!KEEP_WORK) rmSync(WORK, { recursive: true, force: true })
}
process.exit(0)
