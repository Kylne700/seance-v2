// Words that depend on a count: each is checked for none, one and many, so the page never says "1 sealed notes" or "The other 1 sealed note stays shut".
import { describe, expect, it } from 'vitest'
import { viewSecretProblem } from '../src/decrypt.ts'
import { plural, theOther } from '../src/format.ts'

describe('plural', () => {
  it('adds the s for none and many, not for one', () => {
    expect(plural(0, 'sealed note')).toBe('0 sealed notes')
    expect(plural(1, 'sealed note')).toBe('1 sealed note')
    expect(plural(2, 'sealed note')).toBe('2 sealed notes')
  })
})

describe('theOther (the caption under a reading)', () => {
  it('one other note: no number, singular verb', () => {
    expect(theOther(1, 'sealed note', 'stays', 'stay')).toBe('The other sealed note stays')
    expect(theOther(1, 'sealed note', 'carries', 'carry')).toBe('The other sealed note carries')
  })
  it('several other notes: the number, plural noun and verb', () => {
    expect(theOther(2, 'sealed note', 'stays', 'stay')).toBe('The other 2 sealed notes stay')
    expect(theOther(5, 'sealed note', 'carries', 'carry')).toBe('The other 5 sealed notes carry')
  })
  it('never reads "other 1"', () => {
    for (const n of [1, 2, 3, 10]) expect(theOther(n, 'sealed note', 'stays', 'stay')).not.toMatch(/other 1 /)
  })
})

describe('the hint for a pasted view secret', () => {
  const hex64 = 'ab'.repeat(32)
  it('says nothing about a good key', () => {
    expect(viewSecretProblem(hex64)).toBeNull()
  })
  it('counts the characters typed: one, many, too long', () => {
    expect(viewSecretProblem('a')).toBe('A view secret is 64 hexadecimal characters (0-9 and a-f). You have typed 1 character.')
    expect(viewSecretProblem(hex64.slice(1))).toMatch(/You have typed 63 characters\.$/)
    expect(viewSecretProblem(`${hex64}a`)).toMatch(/You have typed 65 characters\.$/)
  })
  it('does not say "you have typed 64" about a key of the right length with a wrong character', () => {
    const bad = `${hex64.slice(1)}g`
    expect(bad).toHaveLength(64)
    expect(viewSecretProblem(bad)).toBe('That is 64 characters, but a view secret uses only 0-9 and a-f.')
  })
})
