// The README makes claims a judge will click or copy: the transaction links, the demo keys, the numbers. They must match the data.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ledger from '../ledger.json'
import { MIRROR_URL, receiptTx } from '../src/config.ts'
import template from '../template/src/lib.rs?raw'

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const entries = [...ledger.txs, ...ledger.hero, ...ledger.setup]

describe('the transaction links', () => {
  const linked = [...readme.matchAll(new RegExp(`\\(${MIRROR_URL.replaceAll('.', '\\.')}/transactions/([0-9a-f]{64})\\)`, 'g'))].map((m) => m[1])

  it('are one per transaction in the ledger: the 15 demos and the 3 set-up steps', () => {
    expect(entries).toHaveLength(18)
    expect(new Set(entries.map((e) => e.id)).size).toBe(18)
    expect([...linked].sort()).toEqual(entries.map((e) => e.id).sort())
  })

  it("link demo 1's receipt on the first indexer, the same address the saved-copy card links", () => {
    expect(readme).toContain(`(${receiptTx(ledger.hero[0].id)})`)
  })

  it('no longer point at explorer pages, which the public indexer cannot fill any more', () => {
    expect(readme).not.toMatch(/explorer\.tari\.mw\/tx\//)
  })

  it('say how many saved answers the ledger holds: 15 of the 18', () => {
    expect(entries.filter((e) => 'reply' in e)).toHaveLength(15)
    expect(readme).toMatch(/15 of 15 saved answers/)
    expect(readme).toMatch(/the 3 set-up transactions have no saved answer/)
  })
})

describe('the numbers about the template', () => {
  it('every "N lines" or "N-line" about the Rust file is the real line count', () => {
    const real = template.trimEnd().split('\n').length
    const said = [...readme.matchAll(/(\d+)(?:-line Rust| lines of Rust)/g)].map((m) => Number(m[1]))
    expect(said.length).toBeGreaterThan(0)
    for (const n of said) expect(n).toBe(real)
  })
})

describe('the demo keys', () => {
  it('are the ones in the ledger (the table is copied by hand)', () => {
    for (const secret of [ledger.keys.bob.viewSecret, ledger.keys.carol.viewSecret, ledger.keys.eve.viewSecret, ledger.auditor.secret]) {
      expect(readme).toContain(`\`${secret}\``)
    }
  })
})
