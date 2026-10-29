// Side-by-side timing of two builds of the page on this machine: headless Chromium, a fresh browser context for every run (so a cold cache and
// cold connections for both), the real indexer, and the runs of the two builds interleaved. Prints a Markdown table.
//   nice -n 19 node scripts/perf.mjs <before-dist> <before-prefix> [after-dist=dist] [after-prefix=/seance-v2/] [runs=5]
// The pages are served from this machine, so "first load" leaves out the network time to the site host; the lookups go to the real indexer.
// What is timed:
//   first load   from the start of the navigation until the buttons work and the first example is drawn
//   lookup       a recent transaction id is pasted (one input event) and "Look at it" is pressed at once; from the press until the answer is shown
//   #tx= link    the page is opened with the id in its address; from the start of the navigation until the answer is shown
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { parseTransaction } from '../src/chain.ts'
import { INDEXER_URL, RECENT_LIMIT } from '../src/config.ts'
import { serveDir } from './serve.mjs'

delete process.env.DISPLAY
const [beforeDir, beforePrefix, afterDir = 'dist', afterPrefix = '/seance-v2/', runsArg = '5'] = process.argv.slice(2)
if (!beforeDir || !beforePrefix) {
  console.error('usage: node scripts/perf.mjs <before-dist> <before-prefix> [after-dist=dist] [after-prefix=/seance-v2/] [runs=5]')
  process.exit(2)
}
const RUNS = Number(runsArg)
const HOST = new URL(INDEXER_URL).host
const TIMEOUT = 30_000

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const spread = (xs) => `${Math.round(median(xs))} ms (${Math.round(Math.min(...xs))} to ${Math.round(Math.max(...xs))})`

// A recent settled transaction, from the indexer's own list: the kind of id someone looks up right after it happened.
async function freshId() {
  const items = (await (await fetch(`${INDEXER_URL}/transactions/recent?limit=${RECENT_LIMIT}`)).json()).transactions
  for (const item of items) {
    try {
      const v = parseTransaction(item)
      if (v.outcome === 'Commit') return v.id
    } catch {
      /* a shape this page does not read */
    }
  }
  throw new Error('the indexer listed no usable transaction')
}

// Page-side conditions.
const READY = () => document.getElementById('stranger-body')?.getAttribute('aria-busy') === 'false' && !document.getElementById('look')?.hasAttribute('disabled')
const SHOWN = (id) => document.getElementById('stranger-body')?.getAttribute('aria-busy') === 'false' && (document.getElementById('status')?.textContent ?? '').includes(id.slice(0, 8))
const wait = (page, fn, ...args) => page.waitForFunction(fn, { polling: 'raf', timeout: TIMEOUT }, ...args)

async function inFreshContext(browser, body) {
  const ctx = await browser.createBrowserContext()
  try {
    return await body(await ctx.newPage())
  } finally {
    await ctx.close()
  }
}

/** First load, then a pasted id looked up at once. */
const loadAndLookup = (browser, base, id) =>
  inFreshContext(browser, async (page) => {
    const cdp = await page.createCDPSession()
    await page.goto(base, { waitUntil: 'load' })
    await wait(page, READY)
    const firstLoad = await page.evaluate(() => performance.now())
    await page.focus('#txid')
    await cdp.send('Input.insertText', { text: id })
    await page.evaluate(() => document.getElementById('pick').addEventListener('submit', () => (window.__t0 = performance.now()), { capture: true, once: true }))
    await page.click('#look')
    await wait(page, SHOWN, id)
    const out = await page.evaluate(
      (host) => ({
        lookup: performance.now() - window.__t0,
        live: document.getElementById('mode-badge')?.textContent === 'Live',
        asked: performance
          .getEntriesByType('resource')
          .filter((e) => e.name.includes(host))
          .map((e) => ({ list: e.name.includes('/transactions/recent'), start: e.startTime - window.__t0, dur: e.duration })),
      }),
      HOST,
    )
    return { firstLoad, ...out }
  })

/** The page opened with the id in its address. */
const viaLink = (browser, base, id) =>
  inFreshContext(browser, async (page) => {
    await page.goto(`${base}#tx=${id}`, { waitUntil: 'load' })
    await wait(page, SHOWN, id)
    return page.evaluate(() => ({ link: performance.now(), live: document.getElementById('mode-badge')?.textContent === 'Live' }))
  })

/** A run on the recorded sample, or a timeout, is not a measurement of a live lookup: try again. */
async function good(run) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await run()
      if (r.live) return r
    } catch (e) {
      console.error(`run failed (${String(e).split('\n')[0]}), trying again`)
    }
  }
  throw new Error('the live indexer did not give a usable run three times')
}

const dir = mkdtempSync(join(tmpdir(), 'seance-perf-'))
const variants = [
  { name: 'before', dir: beforeDir, prefix: beforePrefix, port: 4311 },
  { name: 'after', dir: afterDir, prefix: afterPrefix, port: 4312 },
]
const servers = await Promise.all(variants.map((v) => serveDir(v.dir, v.port, v.prefix)))
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const seen = Object.fromEntries(variants.map((v) => [v.name, { firstLoad: [], lookup: [], link: [], requests: [], list: [], target: [] }]))
try {
  for (let round = -1; round < RUNS; round++) {
    // round -1 warms the browser and the connection to the indexer up and is thrown away; the order of the two builds alternates
    const id = await freshId()
    for (const v of round % 2 ? [...variants].reverse() : variants) {
      const base = `http://127.0.0.1:${v.port}${v.prefix}`
      const a = await good(() => loadAndLookup(browser, base, id))
      const b = await good(() => viaLink(browser, base, id))
      if (round < 0) continue
      const s = seen[v.name]
      s.firstLoad.push(a.firstLoad)
      s.lookup.push(a.lookup)
      s.link.push(b.link)
      s.requests.push(a.asked.length)
      const list = a.asked.find((e) => e.list)
      if (list) s.list.push(list.dur)
      s.target.push(Math.max(...a.asked.filter((e) => !e.list).map((e) => e.start + e.dur))) // when the last by-id answer was in
      console.error(`${v.name} run ${round + 1}: first load ${Math.round(a.firstLoad)} ms, lookup ${Math.round(a.lookup)} ms (${a.asked.length} indexer requests), #tx= link ${Math.round(b.link)} ms`)
    }
  }
} finally {
  await browser.close()
  servers.forEach((s) => s.close())
  rmSync(dir, { recursive: true, force: true })
}

const [b, a] = [seen.before, seen.after]
const diff = (x, y) => `${median(y) - median(x) >= 0 ? '+' : ''}${Math.round(median(y) - median(x))} ms`
console.log(`| What (median of ${RUNS}, with the range) | before | after | after minus before |`)
console.log('|---|---|---|---|')
console.log(`| first load, until the page works | ${spread(b.firstLoad)} | ${spread(a.firstLoad)} | ${diff(b.firstLoad, a.firstLoad)} |`)
console.log(`| lookup: press to shown | ${spread(b.lookup)} | ${spread(a.lookup)} | ${diff(b.lookup, a.lookup)} |`)
console.log(`| lookup through a #tx= link: open to shown | ${spread(b.link)} | ${spread(a.link)} | ${diff(b.link, a.link)} |`)
console.log(`| indexer requests in one lookup | ${median(b.requests)} | ${median(a.requests)} | |`)
if (a.list.length) console.log(`| of which the list of latest transactions took | | ${spread(a.list)} | |`)
console.log('')
console.log(JSON.stringify({ runs: RUNS, before: b, after: a }))
process.exit(0)
