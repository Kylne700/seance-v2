// Maintainer script: renders public/og.png, the link-preview image (1200x630), headless, from the page's own stylesheet and ghost shapes.
//   node scripts/make-og.mjs        (needs Chromium; CHROMIUM=/path overrides /usr/bin/chromium)
// The image shows only fixed words (no transaction, no key). Re-run it after a change to src/style.css or to the ghosts in index.html.
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const OUT = fileURLToPath(new URL('../public/og.png', import.meta.url))
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
// the three ghosts, exactly as the page draws them (Stranger, Medium, Auditor)
const ghosts = [...page.matchAll(/<svg class="spirit"[\s\S]*?<\/svg>/g)].map((m) => m[0])
if (ghosts.length !== 3) throw new Error(`expected 3 ghosts in index.html, found ${ghosts.length}`)

const card = (cls, name, line, svg) => `<article class="lens ${cls}"><header class="lens-head">${svg}<div><h3>${name}</h3><p class="role">${line}</p></div></header></article>`
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><style>${css}
html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
.og { box-sizing: border-box; width: 1200px; height: 630px; padding: 52px 64px 44px; display: flex; flex-direction: column; }
.og .kicker { font-size: 24px; margin: 0 0 6px; }
.og h1 { font-size: 132px; line-height: 1.05; margin: 0 0 6px; letter-spacing: .02em; text-shadow: 0 0 36px rgba(255, 180, 84, .4); }
.og .tag { font: 600 46px/1.2 var(--serif); color: var(--text); margin: 0; }
.og .trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; margin-top: auto; }
.og .lens { padding: 22px 20px; }
.og .lens-head { margin: 0; gap: 16px; align-items: center; }
.og .spirit { width: 78px; height: 88px; }
.og h3 { font-size: 32px; margin: 0; }
.og .role { font-size: 23px; line-height: 1.3; margin: 6px 0 0; color: var(--muted); }
.og .url { font: 600 28px/1 var(--mono); color: var(--amber); margin: 26px 0 0; display: flex; justify-content: space-between; }
.og .url span:last-child { color: var(--muted); font-weight: 400; }
</style><body><div class="og">
<p class="kicker">Tari Ootle &middot; Esmeralda testnet &middot; Spooky Secrets</p>
<h1>Seance</h1>
<p class="tag">Three ghosts read one private Tari payment.</p>
<div class="trio">
${card('stranger', 'The Stranger', 'Sees only sealed bytes.', ghosts[0])}
${card('medium', 'The Medium', 'Reads the amount and the memo.', ghosts[1])}
${card('auditor', 'The Auditor', 'Counts the amount only.', ghosts[2])}
</div>
<p class="url"><span>kylne700.github.io/seance</span><span>open source &middot; MIT</span></p>
</div></body></html>`

const profile = mkdtempSync(join(tmpdir(), 'seance-og-'))
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: profile, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--hide-scrollbars'] })
try {
  const p = await browser.newPage()
  await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
  await p.setContent(html, { waitUntil: 'load' })
  await p.evaluate(() => document.fonts.ready)
  await p.evaluate(() => document.getAnimations().forEach((a) => a.cancel())) // the ghost flame flickers forever: show it at rest
  await p.screenshot({ path: OUT, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } })
} finally {
  await browser.close()
  rmSync(profile, { recursive: true, force: true })
}
console.log(`public/og.png ${statSync(OUT).size} bytes`)
