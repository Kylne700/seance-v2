// Maintainer script: redraws docs/seance-ghosts.png, the picture at the top of the README, from the production build.
//   npm run build && node scripts/shoot-ghosts.mjs        (needs Chromium; CHROMIUM=/path overrides /usr/bin/chromium; SHOOT_PORT=4375)
// Every outside host is made unresolvable, so the picture is the page's own first load (the saved example, nothing live) and the
// script stops instead of writing a picture of a half-read page. Redraw it after a change to the page.
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { serveDir } from './serve.mjs'

delete process.env.DISPLAY // headless only, never a real screen
const OUT = fileURLToPath(new URL('../docs/seance-ghosts.png', import.meta.url))
const PORT = Number(process.env.SHOOT_PORT ?? 4375)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await serveDir(fileURLToPath(new URL('../dist', import.meta.url)), PORT, '/seance/')
const dir = mkdtempSync(join(tmpdir(), 'seance-ghosts-'))
const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
  headless: true,
  userDataDir: dir,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:${PORT}/seance/`, { waitUntil: 'networkidle0' })
  // the Auditor has counted the saved example when its card holds a reading and no "Counting" bar
  await page.waitForFunction(() => document.querySelector('#audit-reading .reading') && !document.querySelector('#audit-reading .counting'), { timeout: 60000 })
  const text = await page.evaluate(() => document.body.innerText)
  for (const need of ['0.00031415 SEANCE', '0.00018585 SEANCE', 'Midnight at the old crypt', 'Recorded: the page']) {
    if (!text.includes(need)) throw new Error(`the first load does not show "${need}": no picture written`)
  }
  await page.evaluate(() => document.getElementById('audit-reading').scrollIntoView({ block: 'end' }))
  await sleep(1100) // the 0.9 s fade-in must be over
  await page.screenshot({ path: OUT, type: 'png' })
  console.log(`wrote ${OUT} (${Math.round(statSync(OUT).size / 1024)} KB)`)
} finally {
  await browser.close()
  server.close()
  rmSync(dir, { recursive: true, force: true })
}
