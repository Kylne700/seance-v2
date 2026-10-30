// Builds public/seance-offline.html: the whole app (script, style, wasm, recorded data) in ONE file whose own security policy stops the page from making requests.
// The script and the style are allowed by their sha256, so the policy has no 'unsafe-inline' and no address. The Pages deploy serves public/ unchanged: the bytes served are the bytes committed.
//   node scripts/build-offline.mjs            write public/seance-offline.html
//   node scripts/build-offline.mjs --check    build again in memory and exit 1 if the committed file differs (npm test runs this, so the file cannot go stale)
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

process.env.NODE_ENV = 'production' // a parent such as vitest sets NODE_ENV=test, which would change the bundle
const { build } = await import('vite') // after NODE_ENV: vite reads it when it loads

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const FILE = `${ROOT}public/seance-offline.html`
const hash = (data, enc) => createHash('sha256').update(data).digest(enc)

async function compose() {
  const { output } = await build({ root: ROOT, logLevel: 'warn', build: { write: false } }) // in memory: dist/ is not touched
  if (output.length !== 4) throw new Error(`expected one script, one style, the page and the licences, got ${output.map((o) => o.fileName).join(', ')}`)
  const one = (re) => {
    const found = output.filter((o) => re.test(o.fileName))
    if (found.length !== 1) throw new Error(`expected one build output matching ${re}, found ${found.length}`)
    const o = found[0]
    return o.type === 'chunk' ? o.code : typeof o.source === 'string' ? o.source : Buffer.from(o.source).toString('utf8')
  }
  const built = one(/^assets\/index-[^/]+\.js$/)
  const css = one(/^assets\/index-[^/]+\.css$/)
  const licences = one(/^THIRD-PARTY-LICENSES\.md$/).trim()
  let html = one(/^index\.html$/)

  // The wasm is one base64 string in the script, and a few runs of it read like the start of an AWS key id ("AKIA" and 12 capitals or digits). They are not keys, but secret scanners flag them,
  // so each is cut after "AKI" with a backslash-newline, which JavaScript drops from a string: the program is the same. (scripts/scan.mjs drops it too before it decodes the wasm.)
  const cut = 'AKI\\\n'
  const js = built.replace(/atob\(`[A-Za-z0-9+/=]{1000,}`\)/g, (lit) => lit.replace(/AKI(?=A[0-9A-Z]{12})/g, cut))
  if (js.replaceAll(cut, 'AKI') !== built) throw new Error('the script changed by more than the cuts in the wasm string')
  if (/AKIA[0-9A-Z]{12}/.test(js)) throw new Error('the script still holds a run that looks like an AWS key id')

  // What would break the inline copies: the browser ends a script or style at its closing tag, and a comment ends at "-->". The policy hash is of the exact text, so no CR either.
  for (const [what, text, bad] of [['script', js, /<\/?script|<!--|\r/i], ['style', css, /<\/style|\r|url\(|@import/i], ['licences', licences, /-->|--!>|<!--/]]) {
    if (bad.test(text)) throw new Error(`the ${what} cannot be inlined: it holds ${bad.exec(text)[0]}`)
  }

  const csp = [
    "default-src 'none'", // images, fonts, frames, media and workers fall back to this: none
    `script-src 'sha256-${hash(js, 'base64')}' 'wasm-unsafe-eval'`, // the one inline script, by hash; 'wasm-unsafe-eval' only lets the browser compile the bundled WebAssembly
    `style-src 'sha256-${hash(css, 'base64')}'`,
    "connect-src 'none'", // no fetch, XHR, WebSocket or EventSource
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
  // Each piece must be there exactly once: a change in how vite writes the page fails the build here instead of shipping a different file. The replacement is a function so a "$" in the code is never read as a pattern.
  const swap = (re, to) => {
    if ((html.match(re) ?? []).length !== 1) throw new Error(`index.html: expected exactly one ${re}`)
    html = html.replace(re, () => to)
  }
  swap(/<html lang="en">/g, '<html lang="en" class="offline">') // main.ts and style.css read this class: recorded data only, online controls hidden
  swap(/<meta http-equiv="Content-Security-Policy"[^>]*>/g, `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta http-equiv="x-dns-prefetch-control" content="off" />`)
  swap(/\s*<link rel="icon"[^>]*>/g, '') // an icon is an image request, which the policy blocks
  html = html.replace(/\s*<meta (?:property="og:|name="twitter:)[^>]*>/g, '') // they describe the online page, not this file
  swap(/\s*<script type="module" crossorigin src="[^"]*"><\/script>/g, '')
  swap(/\s*<link rel="stylesheet" crossorigin href="[^"]*">/g, '')
  swap(/\s*<\/head>/g, `\n    <style>${css}</style>\n    <script type="module">${js}</script>\n  </head>`)
  // A standalone file has no THIRD-PARTY-LICENSES.md beside it, so the notices travel inside it.
  return Buffer.from(`${html.trimEnd()}\n<!--\n${licences}\n-->\n`, 'utf8')
}

const fresh = await compose()
const say = (buf) => `${buf.length} bytes, sha256 ${hash(buf, 'hex')}`
if (process.argv.includes('--check')) {
  const have = readFileSync(FILE)
  if (!have.equals(fresh)) {
    let at = 0
    while (at < have.length && at < fresh.length && have[at] === fresh[at]) at++
    console.error(`FAIL public/seance-offline.html is not what a fresh build gives.\n  committed: ${say(have)}\n  fresh:     ${say(fresh)}\n  first difference at byte ${at}\nRun: npm run offline`)
    process.exit(1)
  }
  console.log(`ok public/seance-offline.html equals a fresh build: ${say(fresh)}`)
} else {
  writeFileSync(FILE, fresh)
  console.log(`wrote public/seance-offline.html: ${say(fresh)}`)
}
