// public/seance-offline.html: the policy in its meta tag names exactly the file's own script and style, nothing in the page asks for another file, and the committed bytes are what a fresh build gives.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const bytes = readFileSync(new URL('public/seance-offline.html', root))
const html = bytes.toString('utf8')
const readme = readFileSync(new URL('README.md', root), 'utf8')
const section = readme.split(/^## /m).find((s) => s.startsWith('Offline copy')) ?? ''
const b64 = (s: string) => createHash('sha256').update(s).digest('base64')

const only = (re: RegExp) => {
  const found = [...html.matchAll(re)]
  if (found.length !== 1) throw new Error(`public/seance-offline.html: expected one ${re}, found ${found.length}`)
  return found[0]![1]!
}
const script = only(/<script type="module">([\s\S]*?)<\/script>/g)
const style = only(/<style>([\s\S]*?)<\/style>/g)
const csp = only(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g)
// The page without its one script, its one style and the licence comment that follows </html>.
const shell = html.slice(0, html.indexOf('</html>')).replace(/<script\b[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/, '')

describe('the offline copy', () => {
  it('is what a fresh build gives, so it cannot go stale', () => {
    // vitest sets NODE_ENV=test: the build script must still make the production bundle, and `npm run offline` is the fix when this fails.
    const r = spawnSync(process.execPath, ['scripts/build-offline.mjs', '--check'], { cwd: root, encoding: 'utf8', timeout: 120_000 })
    expect(`${r.stdout}${r.stderr}`).toMatch(/^ok public\/seance-offline\.html equals a fresh build/m)
    expect(r.status).toBe(0)
  }, 150_000)

  it('has a policy that allows its own script and style by hash and nothing else', () => {
    const rules = Object.fromEntries(csp.split('; ').map((d) => { const [name = '', ...sources] = d.split(' '); return [name, sources.join(' ')] }))
    expect(rules).toEqual({
      'default-src': "'none'",
      'script-src': `'sha256-${b64(script)}' 'wasm-unsafe-eval'`,
      'style-src': `'sha256-${b64(style)}'`,
      'connect-src': "'none'",
      'form-action': "'none'",
      'base-uri': "'none'",
    })
    expect(html).toContain('<meta http-equiv="x-dns-prefetch-control" content="off" />')
  })

  it('has nothing in the page that loads another file', () => {
    expect(shell).not.toMatch(/<(link|img|iframe|frame|object|embed|base|audio|video|source|track|script|style)\b/i)
    expect(shell).not.toMatch(/\s(src|srcset|style|action|poster|ping)\s*=/i) // dom.ts allows no style attribute, and the form has no action
    expect(shell).not.toMatch(/http-equiv="refresh"/i)
  })

  it('has no run that reads like an AWS key id (the build cuts the wasm text with backslash-newline)', () => {
    expect(html).not.toMatch(/AKIA[0-9A-Z]{12}/)
  })

  it('marks itself offline and says what to do', () => {
    expect(html).toContain('<html lang="en" class="offline">')
    expect(html).toContain('Offline copy: open a saved transaction file.')
  })

  it('is the file whose SHA-256 the README gives, with the one command that rebuilds it', () => {
    expect(section).toContain(createHash('sha256').update(bytes).digest('hex'))
    expect(section).toContain('`npm run offline`')
  })

  it('claims only what the policy enforces', () => {
    const banned = new RegExp(['air-?gap', 'unhack', 'quantum[- ]proof'].join('|'), 'i') // spelled in parts so a search for the banned words finds only real uses
    expect(html).not.toMatch(banned)
    expect(section).not.toMatch(banned)
    expect(section).toMatch(/does not (stop|block) a link/i)
    expect(section).toMatch(/top-level navigation/i)
  })
})
