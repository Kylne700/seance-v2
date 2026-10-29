// `npm run stranger` pages back through the recent list to find 3 private transfers. The paging and the way a run ends are checked here against a fake chain.
import { describe, expect, it } from 'vitest'
import { MAX_PAGES, PAGE, pickRecent, verdict } from '../scripts/stranger-pick.ts'

type Row = { transaction_id: string; priv: boolean }
const keep = (r: Row): Row | null => (r.priv ? r : null)

// A fake chain, newest first. list() answers as the indexer does: the PAGE rows that come after last_id (from the top when last_id is null).
function chain(length: number, isPrivate: (i: number) => boolean) {
  const rows: Row[] = Array.from({ length }, (_, i) => ({ transaction_id: `tx${i}`, priv: isPrivate(i) }))
  const asked: (string | null)[] = []
  const list = async (lastId: string | null): Promise<Row[]> => {
    asked.push(lastId)
    const from = lastId === null ? 0 : rows.findIndex((r) => r.transaction_id === lastId) + 1
    return rows.slice(from, from + PAGE)
  }
  return { list, asked }
}
const ids = (rows: Row[]): string[] => rows.map((r) => r.transaction_id)

describe('pickRecent', () => {
  it('asks for 100 rows at a time and at most 3 times', () => {
    expect([PAGE, MAX_PAGES]).toEqual([100, 3])
  })

  it('makes one request when the first page already holds 3 private transfers, and keeps the newest 3', async () => {
    const { list, asked } = chain(1000, (i) => i % 10 === 0)
    const { found, requests } = await pickRecent(list, keep, 3)
    expect(ids(found)).toEqual(['tx0', 'tx10', 'tx20'])
    expect(requests).toBe(1)
    expect(asked).toEqual([null])
  })

  it('pages back with the id of the last row of the page before', async () => {
    const { list, asked } = chain(1000, (i) => i === 150 || i === 250 || i === 260)
    const { found, requests } = await pickRecent(list, keep, 3)
    expect(ids(found)).toEqual(['tx150', 'tx250', 'tx260'])
    expect(requests).toBe(3)
    expect(asked).toEqual([null, 'tx99', 'tx199'])
  })

  it('never asks a 4th time on a quiet chain, and returns what it found', async () => {
    const { list, asked } = chain(1000, (i) => i === 150)
    const { found, requests } = await pickRecent(list, keep, 3)
    expect(ids(found)).toEqual(['tx150'])
    expect(requests).toBe(MAX_PAGES)
    expect(asked).toHaveLength(MAX_PAGES)
  })

  it('stops at the end of the chain: an empty page is the last request', async () => {
    const { list, asked } = chain(50, () => false)
    const { found, requests } = await pickRecent(list, keep, 3)
    expect(found).toEqual([])
    expect(requests).toBe(2)
    expect(asked).toEqual([null, 'tx49'])
  })

  it('counts a row once even if an indexer ignores last_id and repeats the same page', async () => {
    const page: Row[] = [{ transaction_id: 'a', priv: true }, { transaction_id: 'b', priv: false }]
    const { found, requests } = await pickRecent(async () => page, keep, 3)
    expect(ids(found)).toEqual(['a'])
    expect(requests).toBe(MAX_PAGES)
  })

  it('waits between list requests, not before the first', async () => {
    const { list } = chain(1000, () => false)
    let pauses = 0
    await pickRecent(list, keep, 3, async () => void pauses++)
    expect(pauses).toBe(MAX_PAGES - 1)
  })
})

describe('verdict', () => {
  it('a failed check is a FAIL, exit 1, and nothing is saved', () => {
    expect(verdict(2, true, 3, 3)).toEqual({ line: 'RESULT: FAIL (2 check(s))', exit: 1, save: false })
    expect(verdict(1, false, 2, 3)).toEqual({ line: 'RESULT: FAIL (1 check(s))', exit: 1, save: false })
  })

  it('3 of 3 found and all passed is a PASS, and the latest-transactions run is saved', () => {
    expect(verdict(0, true, 3, 3)).toEqual({ line: 'RESULT: PASS', exit: 0, save: true })
  })

  it('a quiet chain checks what it found, says "quiet chain: N of 3", exits 0 and is not saved', () => {
    const v = verdict(0, true, 2, 3)
    expect(v.line).toMatch(/quiet chain: 2 of 3/)
    expect(v.line).not.toMatch(/PASS/)
    expect(v).toMatchObject({ exit: 0, save: false })
  })

  it('no private transfer at all is a SKIP, exit 0, not saved', () => {
    expect(verdict(0, true, 0, 3)).toEqual({ line: 'RESULT: SKIP (quiet chain: 0 of 3)', exit: 0, save: false })
  })

  it('ids named on the command line are a PASS that is never saved, however many there are', () => {
    expect(verdict(0, false, 1, 3)).toEqual({ line: 'RESULT: PASS', exit: 0, save: false })
  })
})
