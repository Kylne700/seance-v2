// The Poltergeist against ledger.json. Three kinds of check:
//  1. the expected numbers, pinned (the on-screen table is exactly this);
//  2. the facts behind each number, read from the raw replies by a blind walk over the JSON, not by the parser the page uses;
//  3. hand-made rows that pin each rule at its edge, and mutations that show each trick reads the field it claims to.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ledger from '../ledger.json'
import { parseTransaction, type TxView } from '../src/chain.ts'
import { ourIds, recordedWorld } from '../src/data.ts'
import { GAP_MS, matchAmounts, notes, openAmount, poltergeist, rules, score, summary, tariRow, transparentRow, utcMs, type Row, type World } from '../src/poltergeist.ts'

const txs = ledger.txs as unknown as { id: string; kind: string; amount: string; to: string; reply: unknown }[]
const sample = ledger.recent.transactions as unknown as { transaction_id: string }[]

/** Every value stored under `key`, anywhere in the JSON, in document order. */
function all(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) for (const x of node) all(x, key, out)
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v)
      all(v, key, out)
    }
  }
  return out
}
const ms = (s: unknown): number => Date.parse(`${String(s).slice(0, 10)}T${String(s).slice(11, 19)}Z`)
const copy = (w: World): World => ({ ...w, views: structuredClone(w.views), crowd: structuredClone(w.crowd) })
const ties = (w: World, gap = GAP_MS) => Object.fromEntries(poltergeist(w, gap).rows.map((r) => [r.id, r.tari.tied]))

const world = recordedWorld()
const FULL = { tied: 11, of: 11, wrong: 0 }

describe('the recorded world', () => {
  it('holds the 11 demo payments and 1 transaction that is not ours', () => {
    expect(world.payments.map((p) => p.id)).toEqual(world.views.map((v) => v.id))
    expect(world.payments).toHaveLength(11)
    expect(world.crowd).toHaveLength(1)
    expect(world.crowd.filter((v) => ourIds.has(v.id))).toEqual([])
  })
  it('the sample is that 1 and the first try of demo 1 (captured mid-run, before the re-send), which sits in ledger.earlier', () => {
    const ids = sample.map((t) => t.transaction_id)
    expect(ids).toHaveLength(2)
    expect(ids.filter((id) => world.payments.some((p) => p.id === id))).toHaveLength(0)
    expect(ledger.earlier.map((e) => e.id).filter((id) => ids.includes(id))).toHaveLength(1)
    expect(world.crowd.map((v) => v.id).sort()).toEqual(ids.filter((id) => !ourIds.has(id)).sort())
  })
  it('the attacker is handed no key', () => {
    const text = JSON.stringify(world)
    for (const k of Object.values(ledger.keys)) expect(text.includes(k.viewSecret)).toBe(false)
  })
})

describe('the expected numbers (the table on the page)', () => {
  const r = poltergeist(world)
  it('summary figures', () => {
    expect({ gapMs: r.gapMs, of: r.of, crowd: r.crowd, spanSeconds: r.spanSeconds, fee: r.fee }).toEqual({ gapMs: 60_000, of: 11, crowd: 1, spanSeconds: 135, fee: 100000 })
  })
  it('on the synthetic transparent ledger every trick gets all 11', () => {
    expect(r.rows.map((x) => [x.id, x.transparent])).toEqual([['reuse', FULL], ['amount', FULL], ['timing', FULL], ['fee', FULL], ['spend', null]])
  })
  it('on Tari: address reuse 0, amount matching 1, timing 11, fee 11, spend graph 11, none mixed up with the 1 other', () => {
    expect(r.rows.map((x) => [x.id, x.tari])).toEqual([['reuse', { tied: 0, of: 11, wrong: 0 }], ['amount', { tied: 1, of: 11, wrong: 0 }], ['timing', FULL], ['fee', FULL], ['spend', FULL]])
  })
  it('is deterministic', () => {
    expect(JSON.stringify(poltergeist(recordedWorld()))).toBe(JSON.stringify(r))
  })
  it('the gap was not tuned: 30 s to an hour agree, because the one other transaction is in another epoch window (the README says so)', () => {
    expect(ties(world, 30_000).timing).toBe(11)
    for (const gap of [30_000, 120_000, 300_000, 3_600_000]) expect(poltergeist(world, gap).rows[2].tari).toEqual(FULL)
  })
})

describe('the facts behind the numbers, from the raw replies', () => {
  const demoTimes = txs.map((t) => ms(all(t.reply, 'created_at')[0]))
  const crowdTimes = sample.filter((t) => !ourIds.has(t.transaction_id)).map((t) => ms(all(t, 'created_at')[0]))
  const fees = (xs: unknown[]): number[] => xs.map((x) => Number(all(x, 'total_fees_paid')[0]))

  it('timing: the demo is one chain of gaps under 30 s, 135 s end to end, and the one other transaction is about half an hour away', () => {
    const t = [...demoTimes].sort((a, b) => a - b)
    expect(Math.max(...t.slice(1).map((x, i) => x - t[i]))).toBeLessThan(30_000)
    expect((t[t.length - 1] - t[0]) / 1000).toBe(135)
    const nearest = Math.min(...crowdTimes.flatMap((c) => t.map((d) => Math.abs(c - d))))
    expect(nearest).toBeGreaterThanOrEqual(1_700_000)
    expect(nearest).toBeLessThan(1_800_000)
  })
  it('timing: one epoch window for the demo, and the other transaction is in an earlier one', () => {
    const epoch = new Set(txs.map((t) => all(t.reply, 'max_epoch')[0]))
    expect(epoch.size).toBe(1)
    const others = sample.filter((t) => !ourIds.has(t.transaction_id)).map((t) => all(t, 'max_epoch')[0] as number)
    expect(others).toHaveLength(1)
    expect(others[0]).toBeLessThan([...epoch][0] as number)
  })
  it('fee: every payment paid 100000 and none of the others did', () => {
    expect(new Set(fees(txs.map((t) => t.reply)))).toEqual(new Set([100000]))
    expect(fees(sample.filter((t) => !ourIds.has(t.transaction_id))).includes(100000)).toBe(false)
  })
  it('address reuse: no key signs two transactions and no key is paid twice, in the demo or the others', () => {
    const items = [...txs.map((t) => t.reply), ...sample.filter((t) => !ourIds.has(t.transaction_id))]
    const signs = items.flatMap((x) => (all(x, 'public_key') as string[]).filter((k) => typeof k === 'string'))
    expect(new Set(signs).size).toBe(signs.length)
    const pays = items.flatMap((x) => [...(all(x, 'Key') as string[]), ...(all(x, 'receiver') as string[])])
    expect(pays.length).toBeGreaterThan(30)
    expect(new Set(pays).size).toBe(pays.length)
  })
  it('spend graph: every payment after the first spends a note the one before it made', () => {
    const made = (x: unknown): string[] => (all(all(x, 'outputs_statement'), 'output') as { commitment: string }[]).map((o) => o.commitment)
    const spent = (x: unknown): string[] => (all(all(x, 'inputs_statement'), 'inputs') as { commitment: string }[][]).flatMap((l) => l.map((i) => i.commitment))
    for (let i = 1; i < txs.length; i++) {
      expect(spent(txs[i].reply).length, `payment ${i + 1} spends something`).toBeGreaterThan(0)
      expect(spent(txs[i].reply).every((c) => made(txs[i - 1].reply).includes(c)), `payment ${i + 1}`).toBe(true)
    }
  })
  it('amount: only the payment that paid out in the open has a revealed amount above the fee, and it equals what was sent', () => {
    const open = txs.map((t) => {
      const revealed = all(t.reply, 'revealed_output').reduce<number>((sum, r) => sum + Number((r as { amount: string }).amount), 0)
      return revealed - fees([t.reply])[0]
    })
    expect(open.filter((x) => x > 0)).toHaveLength(1)
    const i = open.findIndex((x) => x > 0)
    expect(txs[i].kind).toBe('revealed')
    expect(open[i]).toBe(Number(txs[i].amount))
    expect(world.views.map(openAmount).filter((x) => x != null)).toEqual([BigInt(txs[i].amount)])
  })
  it('amount: the 11 amounts are all different, so on the transparent ledger each finds one payment', () => {
    expect(new Set(txs.map((t) => t.amount)).size).toBe(11)
  })
})

describe('what each trick reads: change the field and the number moves', () => {
  it('timing reads the created time', () => {
    const w = copy(world)
    w.views[5].createdAt = '2031-01-01 00:00:00.0' // payment 6 is now far from the rest
    expect(ties(w).timing).toBe(10)
  })
  it('timing reads the epoch window', () => {
    const w = copy(world)
    w.views[5].maxEpoch = 99
    expect(ties(w).timing).toBe(10)
  })
  it('the fee fingerprint reads the fee', () => {
    const w = copy(world)
    w.views[2].feePaid = 90000
    expect(ties(w).fee).toBe(10)
  })
  it('the spend graph reads the spent commitments', () => {
    const w = copy(world)
    w.views[10].statements[0].inputCommitments = ['ab'.repeat(32)]
    expect(ties(w).spend).toBe(10)
  })
  it('address reuse reads signer keys and output lock keys', () => {
    const w = copy(world)
    w.views[1].signers[0] = w.views[0].signers[0]
    expect(ties(w).reuse).toBe(2)
    const v = copy(world)
    v.views[4].outputs[0].lockKey = v.views[7].outputs[0].lockKey
    expect(ties(v).reuse).toBe(2)
  })
  it('a stranger that shares a fee with us is mixed in, and all of our payments in that group are counted', () => {
    const w = copy(world)
    w.crowd[0].feePaid = 100000
    expect(poltergeist(w).rows[3].tari).toEqual({ tied: 11, of: 11, wrong: 11 })
  })
  it('amount matching reads the revealed output and the fee', () => {
    const w = copy(world)
    w.views[0].statements[0].revealedOut = { amount: String(100000 + 666000), receiver: 'ab'.repeat(32) }
    expect(poltergeist(w).rows[1].tari.tied).toBe(2) // payment 1 now paid out 666000 above its fee
    w.views[0].feePaid = null
    expect(poltergeist(w).rows[1].tari.tied).toBe(1) // without the fee the attacker cannot tell what was the fee
  })
})

describe('the rules at their edges', () => {
  const row = (id: string, o: Partial<Row> = {}): Row => ({ id, keys: [], amount: null, at: 0, epoch: 1, fee: 1, spends: [], makes: [], ...o })
  const r = rules(60_000)
  it('timing: exactly the gap ties, one millisecond more does not, another epoch window does not, no time does not', () => {
    expect(r.timing(row('a', { at: 0 }), row('b', { at: 60_000 }))).toBe(true)
    expect(r.timing(row('a', { at: 0 }), row('b', { at: 60_001 }))).toBe(false)
    expect(r.timing(row('a'), row('b', { epoch: 2 }))).toBe(false)
    expect(r.timing(row('a', { at: null }), row('b', { at: null }))).toBe(false)
  })
  it('address reuse: the same key in the same role ties, the same key in another role does not', () => {
    expect(r.reuse(row('a', { keys: ['pays:k'] }), row('b', { keys: ['x', 'pays:k'] }))).toBe(true)
    expect(r.reuse(row('a', { keys: ['signs:k'] }), row('b', { keys: ['pays:k'] }))).toBe(false)
  })
  it('fee: the same fee ties, an unknown fee never does', () => {
    expect(r.fee(row('a', { fee: 5 }), row('b', { fee: 5 }))).toBe(true)
    expect(r.fee(row('a', { fee: 5 }), row('b', { fee: 6 }))).toBe(false)
    expect(r.fee(row('a', { fee: null }), row('b', { fee: null }))).toBe(false)
  })
  it('spend graph: a note made by one and spent by the other ties, in either order', () => {
    expect(r.spend(row('a', { makes: ['c'] }), row('b', { spends: ['c'] }))).toBe(true)
    expect(r.spend(row('b', { spends: ['c'] }), row('a', { makes: ['c'] }))).toBe(true)
    expect(r.spend(row('a', { makes: ['c'] }), row('b', { spends: ['d'] }))).toBe(false)
  })
  it('every rule is symmetric on the real rows', () => {
    const rows = [...world.views, ...world.crowd].map(tariRow)
    for (const rule of Object.values(r)) for (const a of rows) for (const b of rows) expect(rule(a, b)).toBe(rule(b, a))
  })

  const link = (...pairs: [string, string][]) => (a: Row, b: Row): boolean => pairs.some(([x, y]) => (a.id === x && b.id === y) || (a.id === y && b.id === x))
  const ours = new Set(['a', 'b', 'c'])
  it('groups grow by chaining: A to B and B to C ties all three', () => {
    expect(score([row('a'), row('b'), row('c')], ours, link(['a', 'b'], ['b', 'c']))).toEqual({ tied: 3, of: 3, wrong: 0 })
  })
  it('a payment with no tie is not counted', () => {
    expect(score([row('a'), row('b'), row('c')], ours, link(['a', 'b']))).toEqual({ tied: 2, of: 3, wrong: 0 })
  })
  it('a stranger in the group counts as mixed up for every payment of ours in it, and a group of strangers alone counts for nothing', () => {
    expect(score([row('a'), row('b'), row('c'), row('x')], ours, link(['a', 'b'], ['b', 'x']))).toEqual({ tied: 2, of: 3, wrong: 2 })
    expect(score([row('a'), row('x'), row('y')], new Set(['a']), link(['x', 'y']))).toEqual({ tied: 0, of: 1, wrong: 0 })
  })
  it('amount matching: a unique match is found, a shared amount is not found, a match on someone else is wrong', () => {
    const want = new Map([['a', 5n], ['b', 6n], ['c', 7n]])
    const rows = [row('a', { amount: 5n }), row('x', { amount: 6n }), row('y', { amount: 6n }), row('z', { amount: 7n }), row('b')]
    expect(matchAmounts(rows, want)).toEqual({ tied: 1, of: 3, wrong: 1 })
  })
})

describe('the two ledgers', () => {
  it('openAmount: the fee alone is nothing, more than the fee is an amount, no fee known is nothing', () => {
    const v: TxView = structuredClone(world.views[0])
    expect(openAmount(v)).toBeNull()
    v.statements[0].revealedOut = { amount: '350000', receiver: 'ab'.repeat(32) }
    expect(openAmount(v)).toBe(250000n)
    v.feePaid = null
    expect(openAmount(v)).toBeNull()
  })
  it('utcMs reads the indexer time as UTC and refuses anything else', () => {
    expect(utcMs('2026-10-18 16:55:51.0')).toBe(Date.UTC(2026, 9, 18, 16, 55, 51))
    expect(utcMs(null)).toBeNull()
    expect(utcMs('soon')).toBeNull()
  })
  it('the transparent rows show what an account ledger shows: one sender, the receiver and the amount; and keep the real time, epoch and fee', () => {
    const rows = world.views.map((v, i) => transparentRow(v, world.payments[i], world.accounts[world.payments[i].to]))
    expect(new Set(rows.map((x) => x.keys[0]))).toEqual(new Set(['signs:the sender']))
    expect(rows.map((x) => x.amount)).toEqual(world.payments.map((p) => BigInt(p.amount)))
    const bob = world.payments.flatMap((p, i) => (p.to === 'bob' ? [rows[i].keys[1]] : []))
    expect(new Set(bob).size).toBe(1)
    expect(bob[0]).toBe(`pays:${ledger.keys.bob.address}`)
    expect(rows.map((x) => [x.at, x.epoch, x.fee])).toEqual(world.views.map((v) => [utcMs(v.createdAt), v.maxEpoch, v.feePaid]))
  })
  it('the Tari rows hide the amount of every sealed payment and show nothing that needs a key', () => {
    const rows = world.views.map((v) => tariRow(parseTransaction(txs.find((t) => t.id === v.id)!.reply)))
    expect(rows.filter((x) => x.amount != null)).toHaveLength(1)
    for (const x of rows) expect(x.keys.every((k) => /^(signs|pays):[0-9a-f]{64}$/.test(k))).toBe(true)
  })
})

describe('the words on the page', () => {
  const r = poltergeist(world)
  it('the page says in its own markup that the transparent ledger is synthetic', () => {
    expect(readFileSync(new URL('../index.html', import.meta.url), 'utf8')).toMatch(/The transparent ledger is synthetic\.<\/strong> It is not a real chain/)
  })
  it('the headline is built from the numbers', () => {
    expect(summary(r)).toBe('On the synthetic transparent ledger each of the 4 tricks gets all 11. On Tari, address reuse ties 0 of 11 and amount matching finds 1 of 11. Timing, the fee fingerprint and the spend graph still tie all 11.')
  })
  it('each note leans on a fact checked above and names no fix', () => {
    const n = notes(r)
    expect(n.reuse).toMatch(/No key signs two payments and no key is paid twice/)
    expect(n.amount).toMatch(/One payment paid out in the open/)
    expect(n.amount).toMatch(/The other 10 are sealed/)
    expect(n.timing).toMatch(/all 11 within 135 seconds, in one epoch window/)
    expect(n.timing).toMatch(/Of the 1 other transaction recorded, none was close enough in time/)
    expect(n.fee).toMatch(/exactly 0\.1 tTARI/)
    expect(n.spend).toMatch(/Spent notes/)
    for (const text of Object.values(n)) expect(text).not.toMatch(/\b(avoid|mitigat|prevent|fix|solve|protect|hide it)/i)
  })
  it('the notes turn honest when a number changes', () => {
    const w = copy(world)
    w.views[5].createdAt = '2031-01-01 00:00:00.0'
    const n = notes(poltergeist(w))
    expect(n.timing).toMatch(/tie 10 of the 11/)
    expect(n.timing).not.toMatch(/all 11 within/)
  })
})
