// The Auditor card quotes the token template and links to it: the words and the links must match the file and the ledger.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ledger from '../ledger.json'
import { SEANCE_RESOURCE } from '../src/config.ts'
import template from '../template/src/lib.rs?raw'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])

describe('the "How this token was made" card', () => {
  it('quotes a line that is in the file', () => {
    const quoted = [...html.matchAll(/<code>(\.with_view_key\([^<]*\))<\/code>/g)].map((m) => m[1])
    expect(quoted).toEqual(['.with_view_key(auditor)'])
    expect(template).toContain(quoted[0])
  })

  it('links to the file on GitHub, which is in the repository', () => {
    const file = 'template/src/lib.rs'
    expect(hrefs).toContain(`https://github.com/Kylne700/seance/blob/main/${file}`)
    expect(existsSync(new URL(`../${file}`, import.meta.url))).toBe(true)
  })

  it('links to the demo token on the explorer, and that token is the one the ledger records', () => {
    expect(SEANCE_RESOURCE).toBe(ledger.auditor.resource)
    expect(hrefs).toContain(`https://explorer.tari.mw/substate/${SEANCE_RESOURCE}`)
  })
})

describe('the picker hint', () => {
  it('does not promise an explorer link: a recorded answer has other links', () => {
    expect(html).not.toMatch(/its explorer link/)
  })
})
