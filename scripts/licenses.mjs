// Dependency licence check. Reads package-lock.json for the tree (and which packages ship vs. are dev-only) and each installed
// package.json for its licence. Flags GPL / AGPL (exit 1) and lists other copyleft or missing licences as notes.
// Usage: node scripts/licenses.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APP = resolve(new URL('..', import.meta.url).pathname)
const lock = JSON.parse(readFileSync(join(APP, 'package-lock.json'), 'utf8'))

// Names the licence of a LICENSE file by its opening words; "MISSING" if there is no file, "UNRECOGNISED" if it says something else.
function fromLicenseFile(dir) {
  const f = readdirSync(dir).find((n) => /^licen[cs]e(\.(md|txt))?$/i.test(n))
  if (!f) return undefined
  const head = readFileSync(join(dir, f), 'utf8').slice(0, 400)
  if (/BSD 3-Clause/i.test(head)) return 'BSD-3-Clause (LICENSE file)'
  if (/^\s*(The )?MIT License/i.test(head)) return 'MIT (LICENSE file)'
  if (/Apache License/i.test(head)) return 'Apache-2.0 (LICENSE file)'
  return 'UNRECOGNISED (LICENSE file)'
}

const byLicense = { prod: new Map(), dev: new Map() }
const flagged = [] // GPL / AGPL
const notes = [] // weak copyleft, missing or unusual
let checked = 0

for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path.startsWith('node_modules/')) continue
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const file = join(APP, path, 'package.json')
  let license = meta.license
  if (existsSync(file)) {
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    license = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : pkg.licenses)
    if (license && typeof license === 'object') license = license.type
    if (!license) license = fromLicenseFile(join(APP, path)) // some packages carry a LICENSE file and no field
  } else if (!meta.optional) notes.push(`${name}: not installed here, licence taken from the lockfile (${license ?? 'none'})`)
  else continue // an optional platform build for another system: not installed, not shipped
  license = String(license ?? 'MISSING')
  checked++
  const scope = meta.dev ? 'dev' : 'prod'
  byLicense[scope].set(license, (byLicense[scope].get(license) ?? 0) + 1)
  if (/(^|[^L])GPL|AGPL/i.test(license)) flagged.push(`${scope} ${name}@${meta.version}: ${license}`)
  else if (/LGPL|MPL|SSPL|EPL|CDDL|CC-BY-SA|UNLICENSED|MISSING|UNKNOWN|UNRECOGNISED|SEE LICENSE/i.test(license)) notes.push(`${scope} ${name}@${meta.version}: ${license}`)
}

for (const scope of ['prod', 'dev']) {
  const rows = [...byLicense[scope]].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} x${n}`)
  console.log(`${scope === 'prod' ? 'shipped in the bundle (or its toolchain-free runtime)' : 'development only'}: ${rows.join(', ') || 'none'}`)
}
console.log(`${checked} installed packages checked`)
for (const n of notes) console.log(`note: ${n}`)
for (const f of flagged) console.log(`FLAG: ${f}`)

// The notice the build ships (dist/THIRD-PARTY-LICENSES.md): every entry must carry licence text, and the three @tari-project packages must be listed.
const notice = join(APP, 'dist', 'THIRD-PARTY-LICENSES.md')
const noticeProblems = []
if (existsSync(notice)) {
  const entries = readFileSync(notice, 'utf8').split(/^## /m).slice(1)
  for (const e of entries) if (!/Copyright/i.test(e)) noticeProblems.push(`no licence text under "${e.split('\n')[0]}"`)
  for (const n of ['ootle', 'ootle-indexer', 'ootle-wasm']) if (!entries.some((e) => e.startsWith(`@tari-project/${n} - `))) noticeProblems.push(`@tari-project/${n} is not listed`)
  console.log(`notice file: ${entries.length} entries, ${noticeProblems.length ? `${noticeProblems.length} problem(s)` : 'every one carries licence text'}`)
  for (const p of noticeProblems) console.log(`FLAG: notice: ${p}`)
} else console.log('notice file: NOT CHECKED (no dist/ yet; run npm run build first)')

const ok = flagged.length === 0 && noticeProblems.length === 0
console.log(ok ? 'RESULT: PASS (no GPL or AGPL; notice complete)' : `RESULT: FAIL (${flagged.length} GPL/AGPL, ${noticeProblems.length} notice problem(s))`)
process.exit(ok ? 0 : 1)
