// Asking in a crowd: who the page names to the indexer, and what it may truthfully say about it. Pure functions, no network.
import { describe, expect, it } from 'vitest'
import { crowdLine, DECOYS, planCrowd, secureInt, type CrowdFacts } from '../src/crowd.ts'

const idN = (n: number): string => n.toString(16).padStart(64, '0')
/** An indexer list of n transactions, newest first, one minute apart from 17:21. */
const listOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ transaction_id: idN(i + 1), created_at: `2026-10-29 17:${String(21 - Math.floor(i / 2)).padStart(2, '0')}:00.0` }))
const target = idN(0xabc)

describe('planCrowd', () => {
  it('asks for the target exactly once, with 7 different others from the list, and never the same id twice', () => {
    const list = listOf(40)
    for (let run = 0; run < 200; run++) {
      const { order, facts } = planCrowd(target, list)
      expect(order).toHaveLength(DECOYS + 1)
      expect(new Set(order).size).toBe(order.length)
      expect(order.filter((x) => x === target)).toHaveLength(1)
      const listed = new Set(list.map((t) => t.transaction_id))
      expect(order.filter((x) => x !== target).every((x) => listed.has(x))).toBe(true)
      expect(facts).toMatchObject({ size: 8, inWindow: false, listed: 40 })
    }
  })

  it('all ids look alike: 64 lowercase hex characters, so nothing in the shape marks the target', () => {
    const { order } = planCrowd(target, listOf(40))
    expect(order.every((x) => /^[0-9a-f]{64}$/.test(x))).toBe(true)
  })

  it('an id that is in the list is not asked twice and counts as inside the window', () => {
    const list = listOf(40)
    const inside = list[17].transaction_id
    for (let run = 0; run < 100; run++) {
      const { order, facts } = planCrowd(inside, list)
      expect(order.filter((x) => x === inside)).toHaveLength(1)
      expect(order).toHaveLength(8)
      expect(facts.inWindow).toBe(true)
    }
  })

  it('puts the target in every position about equally often, so the order gives it away to nobody', () => {
    const list = listOf(40)
    const seen = new Array<number>(8).fill(0)
    for (let run = 0; run < 4000; run++) seen[planCrowd(target, list).order.indexOf(target)]++
    for (const n of seen) expect(Math.abs(n - 500)).toBeLessThan(120) // 4000/8 each; 120 is about 5 standard deviations
  })

  it('does not always pick the same decoys', () => {
    const list = listOf(40)
    const first = new Set<string>()
    for (let run = 0; run < 300; run++) planCrowd(target, list).order.forEach((x) => first.add(x))
    expect(first.size).toBeGreaterThan(35) // 39 possible (the 40 listed ones and the target)
  })

  it('a short list gives a smaller crowd: 3 listed ids make 4, said as such', () => {
    const { order, facts } = planCrowd(target, listOf(3))
    expect(order).toHaveLength(4)
    expect(order).toContain(target)
    expect(facts).toMatchObject({ size: 4, listed: 3, inWindow: false })
  })

  it('an empty list, no list, or one that is not a list, sends the target alone', () => {
    for (const bad of [[], undefined, null, 'x', 7, {}, { transactions: [] }]) {
      const { order, facts } = planCrowd(target, bad)
      expect(order).toEqual([target])
      expect(facts).toMatchObject({ size: 1, listed: 0, inWindow: false, spanMinutes: null })
    }
  })

  it('a list that holds only the target sends the target alone (1 of 1)', () => {
    const { order, facts } = planCrowd(target, [{ transaction_id: target }])
    expect(order).toEqual([target])
    expect(facts).toMatchObject({ size: 1, listed: 1, inWindow: true })
  })

  it('ignores entries that are not transaction ids, and counts a repeated id once', () => {
    const list = [
      ...listOf(3),
      { transaction_id: idN(1) }, // repeat
      { transaction_id: 'xyz' },
      { transaction_id: 'AB'.repeat(32) }, // upper case is not what the indexer writes
      { transaction_id: 12 },
      { nothing: true },
      null,
      'abc',
    ]
    const { order, facts } = planCrowd(target, list)
    expect(order).toHaveLength(4)
    expect(new Set(order).size).toBe(4)
    expect(facts.listed).toBe(3)
  })

  it('takes the random source it is given, so a test can fix the outcome', () => {
    const a = planCrowd(target, listOf(40), () => 0)
    const b = planCrowd(target, listOf(40), () => 0)
    expect(a.order).toEqual(b.order)
  })

  it('asks for fewer decoys when told to', () => {
    expect(planCrowd(target, listOf(40), secureInt, 3).order).toHaveLength(4)
    expect(planCrowd(target, listOf(40), secureInt, 0).order).toEqual([target])
  })

  it('says how many minutes the list spans, at least 1, and nothing when it has no times', () => {
    expect(planCrowd(target, listOf(40)).facts.spanMinutes).toBe(19) // two per minute, from 17:21 down to 17:02
    expect(planCrowd(target, [{ transaction_id: idN(1), created_at: '2026-10-29 17:21:20.0' }, { transaction_id: idN(2), created_at: '2026-10-29 17:21:30.0' }]).facts.spanMinutes).toBe(1)
    expect(planCrowd(target, [{ transaction_id: idN(1) }, { transaction_id: idN(2) }]).facts.spanMinutes).toBeNull()
    expect(planCrowd(target, [{ transaction_id: idN(1), created_at: '2026-10-29 17:21:20.0' }]).facts.spanMinutes).toBeNull()
  })
})

describe('secureInt', () => {
  it('stays in range, reaches both ends, and is close to evenly spread', () => {
    const n = 7
    const seen = new Array<number>(n).fill(0)
    for (let i = 0; i < 7000; i++) {
      const x = secureInt(n)
      expect(Number.isInteger(x) && x >= 0 && x < n).toBe(true)
      seen[x]++
    }
    for (const c of seen) expect(Math.abs(c - 1000)).toBeLessThan(160) // about 5 standard deviations
  })

  it('works for 1 (always 0) and for a number that does not divide 2^32', () => {
    for (let i = 0; i < 50; i++) expect(secureInt(1)).toBe(0)
    for (let i = 0; i < 50; i++) expect(secureInt(3_000_000_000)).toBeLessThan(3_000_000_000)
  })
})

describe('crowdLine: what the page says about the lookup, and every number in it is the lookup', () => {
  const facts = (o: Partial<CrowdFacts>): CrowdFacts => ({ size: 8, inWindow: true, listed: 40, spanMinutes: 4, ...o })

  it('inside the window: 1 in 8 is the best the indexer can do, it sees IP, time and the 8 ids, and a repeat can be compared', () => {
    const t = crowdLine(facts({}))
    expect(t).toContain('7 others')
    expect(t).toContain('latest 40 transactions')
    expect(t).toContain('about 4 minutes')
    expect(t).toContain('IP address, the time and the 8 ids')
    expect(t).toContain('1 in 8 is the best it can do for one lookup')
    expect(t).toMatch(/Ask again and it gets a new set/)
  })

  it('outside the window: says the id is the odd one out and that the indexer can tell', () => {
    const t = crowdLine(facts({ inWindow: false }))
    expect(t).toContain('is not among the indexer')
    expect(t).toContain('odd one out')
    expect(t).toContain('can tell which one you came for')
    expect(t).not.toContain('1 in 8')
  })

  it('a smaller crowd says its real size', () => {
    const t = crowdLine(facts({ size: 4, listed: 3, spanMinutes: 1 }))
    expect(t).toContain('3 others')
    expect(t).toContain('the 4 ids')
    expect(t).toContain('1 in 4')
    expect(t).toContain('3 transactions')
    expect(t).toContain('about 1 minute ')
  })

  it('alone: no claim of hiding, with the reason', () => {
    expect(crowdLine(facts({ size: 1, listed: 0, spanMinutes: null }))).toMatch(/went alone.*list of latest transactions was empty.*which id you asked for/)
    expect(crowdLine(facts({ size: 1, listed: 1 }))).toMatch(/went alone.*no other id/)
    expect(crowdLine(facts({ size: 1, listed: 0 }))).not.toContain('1 in 1')
  })

  it('leaves out the minutes when the list carried no times', () => {
    expect(crowdLine(facts({ spanMinutes: null }))).not.toContain('minutes of traffic')
  })
})
