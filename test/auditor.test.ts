// The Auditor: the audit key of the demo token reads the AMOUNT of every sealed note in the hero transactions, and nothing else.
// The expected numbers were written down when each transaction was sent (scripts/make-hero.mjs), before this page read them back.
import { afterEach, describe, expect, it, vi } from 'vitest'
import ledger from '../ledger.json'
import { audit, audited, RANGE_MAX, type Hooks } from '../src/auditor.ts'
import { parseTransaction, type TxView } from '../src/chain.ts'
import { SEANCE_RESOURCE } from '../src/config.ts'
import { createData, demoKeys, demos, ourIds } from '../src/data.ts'
import { decryptOutput } from '../src/decrypt.ts'
import { amountOf } from '../src/format.ts'

interface Hero {
  key: string
  id: string
  to: string
  amount: string
  memo: string
  reply: unknown
  expected: { outputs: { output: string; reader: string | null; value?: string; memo?: string; auditor: string }[]; fee: number; outcome: string }
}
const heroes = ledger.hero as unknown as Hero[]
const views = heroes.map((t) => parseTransaction(t.reply))
const auditKey = demoKeys.auditor.viewSecret
const quiet: Hooks = { alive: () => true, progress: () => {} }

afterEach(() => vi.unstubAllGlobals())

describe('the hero set', () => {
  it('is four transactions in the demo token, all in the demo list, all marked as ours', () => {
    expect(heroes.length).toBe(4)
    expect(SEANCE_RESOURCE).toBe(ledger.auditor.resource)
    expect(demos.filter((d) => d.kind === 'audited').map((d) => d.id)).toEqual(heroes.map((t) => t.id))
    for (const t of [...heroes, ...(ledger.setup as { id: string }[])]) expect(ourIds.has(t.id), t.id).toBe(true)
  })

  it('each one is a single private transfer that spends one sealed note, makes two, and opens no amount in the public', () => {
    for (const [i, v] of views.entries()) {
      const label = heroes[i].key
      expect(v.id, label).toBe(heroes[i].id)
      expect(v.outcome, label).toBe('Commit')
      expect(v.feePaid, label).toBe(heroes[i].expected.fee)
      expect(v.statements.length, label).toBe(1)
      const st = v.statements[0]
      expect(st.resource, label).toBe(SEANCE_RESOURCE)
      expect(st.inputCommitments.length, label).toBe(1)
      expect(st.outputs.length, label).toBe(2)
      expect(st.revealedIn, `${label}: nothing is taken from a public balance, or the amount would be in the open`).toBe('0')
      expect(st.revealedOut, label).toBeNull()
      expect(audited(v.outputs).length, `${label}: both notes carry an audit proof`).toBe(2)
    }
  })

  it('the notes add up along the spend graph: each transaction spends the change of the one before', () => {
    const pot = 50_000n // what the shield step sealed (ledger.setup, s5)
    let left = pot
    for (const [i, t] of heroes.entries()) {
      const [paid, change] = t.expected.outputs.map((o) => BigInt(o.auditor))
      expect(paid, t.key).toBe(BigInt(t.amount))
      expect(paid + change, `${t.key}: what came out is what went in`).toBe(left)
      if (i > 0) expect(views[i].statements[0].inputCommitments[0], `${t.key} spends the change of ${heroes[i - 1].key}`).toBe(views[i - 1].statements[0].outputs[1].commitment)
      left = change
    }
    expect(left).toBeGreaterThan(0n)
  })
})

describe('the audit key', () => {
  it('reads the recorded amount of every sealed note of every hero transaction, in recorded mode, with the network blocked', async () => {
    const fetchSpy = vi.fn(async () => Promise.reject(new TypeError('fetch failed')))
    vi.stubGlobal('fetch', fetchSpy)
    const data = createData()
    data.setMode('recorded')
    for (const t of heroes) {
      const shown = await data.lookup(t.id)
      expect(shown.mode).toBe('recorded')
      const heard = await audit(auditKey, shown.view.outputs, quiet)
      expect(heard?.map((x) => x.amount), t.key).toEqual(t.expected.outputs.map((o) => BigInt(o.auditor)))
      expect(heard?.map((x) => x.output), t.key).toEqual(shown.view.outputs)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  }, 60_000)

  it('shows nothing but the amount: the result holds no memo, and the key opens no locked message', async () => {
    const heard = await audit(auditKey, views[3].outputs, quiet)
    expect(heard?.length).toBe(2)
    for (const x of heard ?? []) expect(Object.keys(x).sort()).toEqual(['amount', 'output'])
    for (const [i, v] of views.entries()) {
      for (const o of v.outputs) expect(await decryptOutput(auditKey, o), `${heroes[i].key} note ${o.index}`).toBeNull()
    }
  })

  it('is told apart from the recipient: each key reads exactly what the recording says (amount and memo for the recipient, nothing for the others)', async () => {
    for (const [i, t] of heroes.entries()) {
      for (const e of t.expected.outputs) {
        const [s, n] = e.output.split('.').map(Number)
        const output = views[i].statements[s].outputs[n]
        for (const [name, k] of Object.entries(demoKeys)) {
          const plain = await decryptOutput(k.viewSecret, output)
          if (name === e.reader) expect([plain?.value, plain?.memo]).toEqual([BigInt(e.value!), e.memo])
          else expect(plain, `${t.key} note ${e.output} with ${name}'s key`).toBeNull()
        }
      }
    }
  })
})

describe('a key that is not the audit key', () => {
  it('hears nothing at all, for every hero transaction: Bob, Carol, a stranger, a made-up key and junk', async () => {
    const wrong = [...['bob', 'carol', 'eve'].map((n) => demoKeys[n].viewSecret), 'ab'.repeat(32), 'not a key', '', '0'.repeat(63)]
    for (const secret of wrong) {
      for (const v of views) expect(await audit(secret, v.outputs, quiet), secret.slice(0, 6)).toEqual([])
    }
  })

  it('hears nothing from a transaction that carries no audit proof, whoever holds the key', async () => {
    const plain: TxView = parseTransaction((ledger.txs[0] as { reply: unknown }).reply)
    expect(audited(plain.outputs)).toEqual([])
    expect(await audit(auditKey, plain.outputs, quiet)).toEqual([])
  })
})

describe('the search', () => {
  it('works in slices and shows progress: many turns, a rising count, never past the range', async () => {
    const seen: number[] = []
    const heard = await audit(auditKey, [views[0].outputs[0]], { alive: () => true, progress: (p) => seen.push(p.tried) })
    expect(heard?.[0].amount).toBe(31_415n)
    expect(seen.length, 'a slice holds at most 1024 candidates, so 31,415 takes at least 30 turns').toBeGreaterThanOrEqual(25)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(Math.max(...seen)).toBeLessThanOrEqual(31_415)
    expect(seen.every((n) => Number.isInteger(n) && n > 0)).toBe(true)
  })

  it('gives the turn back before the first slice, so it never shares a task with the card the caller has just drawn', async () => {
    const order: string[] = []
    const run = audit(auditKey, [views[3].outputs[0]], { alive: () => true, progress: () => order.push('progress') })
    order.push('returned')
    expect((await run)?.[0].amount).toBe(250n)
    expect(order[0]).toBe('returned')
    expect(order.includes('progress')).toBe(true)
    let asked = 0
    expect(await audit(auditKey, views[0].outputs, { alive: () => asked++ > 0, progress: () => {} })).toBeNull() // taken over while it waited: not a single slice ran
    expect(asked).toBe(1)
  })

  it('stops at the next slice when a newer request has taken over, and answers null', async () => {
    let turns = 0
    const out = await audit(auditKey, views[0].outputs, { alive: () => turns < 2, progress: () => void turns++ })
    expect(out).toBeNull()
    expect(turns).toBeLessThanOrEqual(3)
  })

  it('a note whose amount lies past the range is reported as such, not as silence', async () => {
    const [big, small] = [views[0].outputs[0], views[3].outputs[0]] // 31,415 and 250
    const heard = await audit(auditKey, [big, small], quiet, 1000n)
    expect(heard?.map((x) => x.amount)).toEqual([null, 250n])
    expect(RANGE_MAX).toBeGreaterThanOrEqual(31_415n) // the page searches far enough for every demo amount
    for (const t of heroes) for (const o of t.expected.outputs) expect(BigInt(o.auditor)).toBeLessThanOrEqual(RANGE_MAX)
  })
})

describe('amounts in their own unit', () => {
  it('the demo token has 8 decimals, TARI has 6, and a token this page does not know is a plain count', () => {
    expect(amountOf(SEANCE_RESOURCE, 31_415n)).toBe('0.00031415 SEANCE')
    expect(amountOf(SEANCE_RESOURCE, 100_000_000n)).toBe('1 SEANCE')
    expect(amountOf('resource_' + '01'.repeat(32), 100_000n)).toBe('0.1 tTARI')
    expect(amountOf('resource_' + 'cd'.repeat(32), 31_415n)).toBe('31,415 base units')
  })
})
