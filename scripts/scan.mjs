// Repo scans. Prints COUNTS ONLY: never a secret, never a match, never a line of the denylist.
//   1. throwaway secrets (spike keys, seed words, passwords) must not appear anywhere in git history, the working tree or dist/ (and the wasm inside it)
//   2. no private-key blocks, walletd-style tokens or "spend secret = <hex>" assignments
//   3. a private list of words (path in DENYLIST, default ../../tools/privacy-denylist.txt) must match nothing, and no home paths
// Where the secret files or the denylist do not exist (a fresh clone) that scan says SKIPPED instead of passing silently.
// Usage: node scripts/scan.mjs      Exit code 0 only if every count is 0 (SKIPPED counts as 0 but is shown).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join, resolve } from 'node:path'

const APP = resolve(new URL('..', import.meta.url).pathname)
const SECRET_DIRS = ['.keys', '.walletd', '.l1'].map((d) => join(APP, '..', d))
const DENYLIST = process.env.DENYLIST ?? join(APP, '..', '..', 'tools', 'privacy-denylist.txt')
const git = (args, max = 1 << 29) => execFileSync('git', args, { cwd: APP, encoding: 'utf8', maxBuffer: max })

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (st.size < 8_000_000) out.push(p)
  }
  return out
}
const isText = (buf) => !buf.subarray(0, 4000).includes(0)

// The SDK's wasm sits inside the bundle as base64, so the text scan cannot see into it. Decode each one and keep what a "strings" tool would show
// (every run of printable characters on its own line, so the grep counts below are per run).
const inlinedWasm = (dir) =>
  walk(dir)
    .filter((f) => f.endsWith('.js'))
    .flatMap((f) => [...readFileSync(f, 'latin1').matchAll(/atob\((["'`])([A-Za-z0-9+/=]{1000,})\1\)/g)])
    .map((m) => Buffer.from(m[2], 'base64').toString('latin1').replace(/[^\x20-\x7e]+/g, '\n'))
const wasm = existsSync(join(APP, 'dist')) ? inlinedWasm(join(APP, 'dist')) : []

// What is scanned: everything ever committed, every file in the working tree that is not ignored, the built site, and the wasm inside it.
const corpora = {
  history: git(['log', '-p', '--all', '--no-color', '--format=fuller']),
  tree: git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter(Boolean)
    .map((f) => readFileSync(join(APP, f)))
    .filter(isText)
    .map(String)
    .join('\n'),
  dist: existsSync(join(APP, 'dist')) ? walk(join(APP, 'dist')).map((f) => readFileSync(f)).filter(isText).map(String).join('\n') : '',
  'dist wasm': wasm.join('\n'),
}

let bad = 0
const report = (what, count, note = '') => {
  if (count !== 'SKIPPED' && count > 0) bad++
  console.log(`${count === 'SKIPPED' || count === 0 ? 'ok  ' : 'FAIL'} ${what}: ${count}${note ? `  (${note})` : ''}`)
}
// A dist/ whose wasm the scan cannot find would make every "dist wasm" count below an empty 0.
if (existsSync(join(APP, 'dist')) && wasm.length === 0) {
  bad++
  console.log('FAIL no inlined wasm found in dist/: the "dist wasm" scans below would read nothing')
} else if (wasm.length > 0) console.log(`ok   inlined wasm modules decoded from dist: ${wasm.length}`)

// 1. Secret values, read in code from the throwaway folders. Only the number of values found is printed.
const secrets = new Set()
const seedWords = []
for (const dir of SECRET_DIRS) {
  if (!existsSync(dir)) continue
  for (const f of walk(dir)) {
    if (f.endsWith('.log') || f.endsWith('.sqlite') || f.endsWith('.toml') || f.endsWith('.yml')) continue // logs and databases hold no values we could name here
    const buf = readFileSync(f)
    if (!isText(buf)) continue
    const text = String(buf).trim()
    if (/\.json$/.test(f)) {
      try {
        const grab = (o, key = '') => {
          if (typeof o === 'string') {
            if (o.length >= 32 && /secret|seed|mnemonic|private|spend|password|token/i.test(key)) secrets.add(o) // public addresses are not secrets
          } else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) grab(v, k)
        }
        grab(JSON.parse(text))
      } catch {
        // not JSON after all: nothing to take
      }
    } else if (text.split(/\s+/).length >= 12 && /^[a-z]+(\s+[a-z]+)+$/.test(text)) seedWords.push(...text.split(/\s+/)) // a seed phrase
    else if (!/\s/.test(text) && text.length >= 8) secrets.add(text) // a password file
  }
}
if (secrets.size + seedWords.length === 0) {
  report('throwaway secrets in history / tree / dist', 'SKIPPED', 'no secret folders next to this checkout')
} else {
  const trigrams = seedWords.slice(0, Math.max(0, seedWords.length - 2)).map((_, i) => seedWords.slice(i, i + 3).join(' '))
  for (const [name, text] of Object.entries(corpora)) {
    const lower = text.toLowerCase()
    const hits = [...secrets].filter((s) => text.includes(s)).length
    const runs = trigrams.filter((t) => lower.includes(t)).length
    report(`secret values found in ${name}`, hits, `${secrets.size} values checked`)
    report(`seed-phrase runs of 3 words found in ${name}`, runs, `${trigrams.length} runs checked`)
  }
}

// 2. Shapes of secrets, whoever they belong to.
const SHAPES = {
  'private key blocks': /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  'JWT-style tokens': /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  'spend/private secrets assigned a 64-hex value': /["']?(?:spend|private)[A-Za-z_]*(?:secret|key)[A-Za-z_]*["']?\s*[:=]\s*["']?[0-9a-f]{64}/gi,
  'mnemonic or seed phrase fields': /["']?(?:mnemonic|seed_?phrase|seed_?words)["']?\s*[:=]\s*["'][a-z]+(?: [a-z]+){5,}/gi,
}
for (const [name, text] of Object.entries(corpora)) for (const [what, re] of Object.entries(SHAPES)) report(`${what} in ${name}`, (text.match(re) ?? []).length)

// 3. The private word list and home paths.
const homePieces = [['/ho', 'me/'].join(''), ['/Us', 'ers/'].join(''), ['C:\\Us', 'ers\\'].join('')]
const account = userInfo().username
for (const [name, text] of Object.entries(corpora)) {
  if (existsSync(DENYLIST)) {
    const r = spawnSync('grep', ['-c', '-i', '-F', '-f', DENYLIST, '-'], { input: text, encoding: 'utf8', maxBuffer: 1 << 20 })
    report(`denylist matches in ${name}`, Number(r.stdout.trim() || 0), r.status === 2 ? 'grep failed' : '')
    if (r.status === 2) bad++
  } else report(`denylist matches in ${name}`, 'SKIPPED', 'no denylist file')
  report(`home paths in ${name}`, homePieces.reduce((n, p) => n + text.split(p).length - 1, 0))
  report(`the account name in ${name}`, account ? text.split(account).length - 1 : 0)
}

// 4. Who wrote the history.
const people = [...new Set(git(['log', '--all', '--format=%an <%ae>%n%cn <%ce>']).split('\n').filter(Boolean))]
report('distinct author/committer identities outside the project identity', people.filter((p) => !/^Kylne700 <\d+\+Kylne700@users\.noreply\.github\.com>$/.test(p)).length, people.join(' | '))

console.log(bad === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${bad})`)
process.exit(bad === 0 ? 0 : 1)
