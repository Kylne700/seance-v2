// B1. Words the page must not use about what it protects, who can read it, or when a computer that breaks it will exist.
// The page shows what a copied key and a computer that solves discrete logarithms could read. It makes no promise of safety, no claim to
// be the first or the only one, and gives no date. This test reads the public text (README, the page, every source file) and fails on those words.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const files = ['README.md', 'index.html', ...readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.ts')).map((f) => `src/${f}`)]

/** Each rule is a name and a pattern for one line of text. "first" and "only" are everywhere in plain use ("the first indexer", "only if you press"), so only the shapes of a claim are caught. */
const FORBIDDEN: [string, RegExp][] = [
  ['quantum-proof', /quantum[- ]proof/i],
  ['quantum-safe', /quantum[- ]safe/i],
  ['quantum-secure', /quantum[- ]secure/i], // "quantum-resistant" is not here: research/80 line 191 uses it for NIST's ML-KEM standard, plainly named
  ['post-quantum private', /post-quantum private/i],
  ['untraceable', /untraceable/i],
  ['anonymous', /anonymous/i],
  ['unlinkable', /unlinkable/i],
  ['better than Monero', /better than monero/i],
  ['dramatically', /dramatic/i],
  ['safe', /\bsafe(ly|r|st|ty)?\b/i],
  ['harmless', /harmless/i],
  ['cannot be stolen', /cannot be stolen/i],
  ['funds will be stolen', /\b(funds|money|coins|tokens)\b[^.]{0,30}\b(will|would) be stolen/i],
  ['first, as a claim', /\bfirst (ever|of its kind|to (show|do|offer|let|read|use|make))\b|\bthe first (tool|viewer|app|wallet|page|explorer|project|private|working|real)\b/i],
  ['only, as a claim', /\bthe only (tool|viewer|app|wallet|page|way|explorer|project|one that)\b|\bonly (tool|viewer|app|wallet|page|explorer) (that|to|which)\b/i],
]
// A year or a span of years on the same line as such a computer is a date for it (this page says "when or whether one will exist" and no more).
const COMPUTER = /quantum|discrete[- ]log/i
const DATE = /\b20[2-9]\d\b|\b(years?|decades?)\b/i

/** Quoted on purpose: each fragment is a denial, never a claim. A fragment no file holds any more fails the last test, so the list cannot go stale. */
const QUOTED = ['it does not make it anonymous']

function hits(line: string): string[] {
  let l = line
  for (const q of QUOTED) l = l.replaceAll(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
  const found = FORBIDDEN.filter(([, re]) => re.test(l)).map(([name]) => name)
  if (COMPUTER.test(l) && DATE.test(l)) found.push('a date for such a computer')
  return found
}

describe('B1: the words the page does not use', () => {
  it('none is in README.md, index.html or src/*.ts', () => {
    const found = files.flatMap((f) =>
      readFileSync(new URL(f, root), 'utf8')
        .split('\n')
        .flatMap((line, i) => hits(line).map((name) => `${f}:${i + 1} ${name}`)),
    )
    expect(found).toEqual([])
  })

  it('the rules catch what they are for and let the allowed wording through', () => {
    for (const bad of ['A quantum-safe viewer', 'Post-quantum private payments', 'untraceable', 'You stay anonymous', 'it is unlinkable', 'better than Monero', 'dramatically better', 'Your key is safe here', 'a harmless key', 'The first viewer to read a note', 'first ever', 'The only viewer that opens it', 'Your funds will be stolen', 'A large quantum computer by 2030', 'a discrete logarithm solver within ten years'])
      expect(hits(bad), bad).not.toEqual([])
    for (const fine of [
      'Harvest now, decrypt later.',
      'A computer that can solve discrete logarithms (for example a large quantum computer).',
      'The commitment is perfectly hiding.',
      'It cannot spend (by the code; not tried).',
      'Notes not yet spent could be spent.',
      'This page does not say when or whether one will exist.',
      "ML-KEM is NIST's quantum-resistant key-establishment standard.",
      'The first indexer answers only if you press the button.',
      'Epoch 2026-10-20 is the first one it looked at.',
    ])
      expect(hits(fine), fine).toEqual([])
  })

  it('every quoted exemption is still in a file', () => {
    const all = files.map((f) => readFileSync(new URL(f, root), 'utf8').toLowerCase()).join('\n')
    for (const q of QUOTED) expect(all, q).toContain(q.toLowerCase())
  })
})
