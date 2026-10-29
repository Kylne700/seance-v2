// "What still leaks": every field of the panel is read from the transaction, nothing else. Two checks:
//  1. for each recorded demo, the panel equals values pulled out of the raw indexer reply by a deliberately different route
//     (a blind walk over the JSON by key name, not the parser the page uses);
//  2. change one field of a parsed transaction and exactly the matching panel item changes.
import { describe, expect, it } from 'vitest'
import ledger from '../ledger.json'
import { parseTransaction, type TxView } from '../src/chain.ts'
import { plural, short, tari, when } from '../src/format.ts'
import { leaks, NO_MEMO_BYTES, type LeakId } from '../src/leaks.ts'

const txs = ledger.txs as unknown as { key: string; id: string; memo: string | null; kind: string; reply: unknown; expected: { outputs: { output: string; reader: string | null }[] } }[]

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
const one = (node: unknown, key: string): unknown => {
  const found = all(node, key)
  expect(found.length, `exactly one "${key}" in the reply`).toBe(1)
  return found[0]
}
const byId = (list: ReturnType<typeof leaks>): Record<LeakId, string[]> => Object.fromEntries(list.map((l) => [l.id, l.values])) as Record<LeakId, string[]>

describe('the panel', () => {
  const view = parseTransaction(txs[0].reply)
  it('has the nine items of the brief and the audit proofs, once each, in a fixed order', () => {
    expect(leaks(view).map((l) => l.id)).toEqual(['token', 'audit', 'spent', 'created', 'revealed', 'rule', 'times', 'epochs', 'fee', 'length'])
  })
  it('gives every item one plain caption that names no fix', () => {
    for (const l of leaks(view)) {
      expect(l.caption.length, l.id).toBeGreaterThan(20)
      expect(l.caption.length, l.id).toBeLessThan(200)
      expect(l.caption, l.id).not.toMatch(/\b(avoid|mitigat|prevent|fix|solve|protect|hide it)/i)
    }
  })
})

describe('each field is read from the raw reply', () => {
  for (const tx of txs) {
    it(`${tx.key} ${tx.id.slice(0, 10)}`, () => {
      const got = byId(leaks(parseTransaction(tx.reply)))
      const stmt = one(tx.reply, 'inputs_statement') as { inputs: { commitment: string }[] }
      const outs = all(tx.reply, 'encrypted_data') as string[]
      const reveal = one(tx.reply, 'revealed_output') as { amount: string | number; receiver: string }
      const fee = Number(one(tx.reply, 'total_fees_paid'))

      expect(got.token).toEqual([one(one(tx.reply, 'resource_address_ref'), 'Address')])
      expect(got.audit, 'a TARI payment carries no audit proof').toEqual([])
      expect(all(tx.reply, 'viewable_balance_proof').filter((p) => p != null)).toEqual([])
      expect(got.spent).toEqual(stmt.inputs.map((i) => short(i.commitment, 12)))
      expect(got.created).toEqual([plural(outs.length, 'sealed note')])
      expect(got.revealed).toEqual([`Paid out in the open: ${tari(String(reveal.amount))}${Number(reveal.amount) === fee ? ', the network fee' : ''} (key ${short(reveal.receiver, 6)})`])
      const kinds = all(tx.reply, 'auth').map((a) => Object.keys(a as object)[0])
      expect(kinds.length).toBe(outs.length)
      expect(got.rule).toEqual([...new Set(kinds)].map((k) => `${k}: ${plural(kinds.filter((x) => x === k).length, 'note')}`))
      expect(got.times).toEqual([`Created: ${when(String(one(tx.reply, 'created_at')))}`, `Finalized: ${when(String(one(tx.reply, 'finalized_at')))}`])
      expect(got.epochs).toEqual([`Any epoch up to ${Number(one(tx.reply, 'max_epoch'))}`])
      expect(got.fee).toEqual([tari(fee)])
      expect(got.length).toEqual(outs.map((hex, i) => `Note ${i + 1}: ${hex.length / 2} bytes, ${hex.length / 2 <= NO_MEMO_BYTES ? 'no memo' : 'a memo is inside'}`))
    })
  }
})

describe('the audit-key transactions', () => {
  for (const tx of ledger.hero as unknown as { key: string; id: string; reply: unknown }[]) {
    it(`${tx.key} ${tx.id.slice(0, 10)}: two audit proofs, and no amount in the open`, () => {
      const got = byId(leaks(parseTransaction(tx.reply)))
      const proofs = all(tx.reply, 'viewable_balance_proof').filter((p) => p != null)
      expect(proofs.length).toBe(2)
      expect(got.audit).toEqual([`${proofs.length} of 2 sealed notes carry an audit proof`])
      expect(got.token).toEqual([ledger.auditor.resource])
      expect(got.revealed, 'a stranger reads no amount from this one').toEqual([])
      expect(got.spent.length).toBe(1)
      expect(got.created).toEqual(['2 sealed notes'])
    })
  }
})

describe('the memo caption is true of the demo set', () => {
  it('a note sent without a memo is exactly NO_MEMO_BYTES long and every note with a memo is longer', () => {
    let withMemo = 0
    let without = 0
    for (const tx of txs) {
      const view = parseTransaction(tx.reply)
      for (const e of tx.expected.outputs) {
        if (e.reader == null) continue
        const [s, i] = e.output.split('.').map(Number)
        const bytes = view.statements[s].outputs[i].ciphertextBytes
        if (tx.memo == null) {
          expect(bytes, `${tx.key} has no memo`).toBe(NO_MEMO_BYTES)
          without++
        } else {
          expect(bytes, `${tx.key} has a memo`).toBeGreaterThan(NO_MEMO_BYTES)
          withMemo++
        }
      }
    }
    expect(withMemo).toBeGreaterThan(3)
    expect(without).toBeGreaterThanOrEqual(1)
  })
})

describe('change one field and only its item changes', () => {
  const base = parseTransaction(txs[0].reply)
  const edit = (f: (v: TxView) => void): Record<LeakId, string[]> => {
    const v = structuredClone(base)
    f(v)
    return byId(leaks(v))
  }
  const before = byId(leaks(base))
  const only = (id: LeakId, changed: Record<LeakId, string[]>, ...alsoMoves: LeakId[]): void => {
    for (const k of Object.keys(before) as LeakId[]) {
      if (k === id || alsoMoves.includes(k)) expect(changed[k], k).not.toEqual(before[k])
      else expect(changed[k], `${k} must not move when ${id} does`).toEqual(before[k])
    }
  }

  it('token', () => {
    const c = edit((v) => (v.statements[0].resource = 'resource_' + 'ab'.repeat(32)))
    expect(c.token).toEqual(['resource_' + 'ab'.repeat(32)])
    expect(c.revealed[0], 'an amount is shown in the unit of its token, and this token is unknown').toMatch(/^Paid out in the open: 100,000 base units, the network fee/)
    only('token', c, 'revealed')
  })
  it('audit proofs', () => {
    expect(before.audit).toEqual([])
    const c = edit((v) => (v.statements[0].outputs[0].viewableBalanceProof = '{}'))
    expect(c.audit).toEqual(['1 of 2 sealed notes carry an audit proof'])
    only('audit', c)
    const both = edit((v) => v.statements[0].outputs.forEach((o) => (o.viewableBalanceProof = '{}')))
    expect(both.audit).toEqual(['2 of 2 sealed notes carry an audit proof'])
    const one = edit((v) => ((v.statements[0].outputs = v.statements[0].outputs.slice(0, 1)), (v.statements[0].outputs[0].viewableBalanceProof = '{}')))
    expect(one.audit).toEqual(['1 of 1 sealed note carries an audit proof'])
  })
  it('spent notes', () => {
    const c = edit((v) => v.statements[0].inputCommitments.push('cd'.repeat(32)))
    expect(c.spent).toEqual([...before.spent, short('cd'.repeat(32), 12)])
    only('spent', c)
  })
  it('new sealed notes', () => {
    const c = edit((v) => v.statements[0].outputs.pop())
    expect(c.created).toEqual(['1 sealed note'])
    only('created', c)
  })
  it('amounts in the open', () => {
    const c = edit((v) => {
      v.statements[0].revealedIn = '5000000'
      v.statements[0].revealedOut = { amount: '350000', receiver: 'ef'.repeat(32) }
    })
    expect(c.revealed).toEqual([`Taken from a public balance: 5 tTARI`, `Paid out in the open: 0.35 tTARI (key ${short('ef'.repeat(32), 6)})`])
    only('revealed', c)
  })
  it('spend rule', () => {
    const c = edit((v) => (v.outputs[0].spendCondition = 'Script'))
    expect(c.rule).toEqual(['Script: 1 note', 'Key: 1 note'])
    only('rule', c)
  })
  it('created and finalized', () => {
    const c = edit((v) => {
      v.createdAt = '2031-02-03 04:05:06.789'
      v.finalizedAt = null
    })
    expect(c.times).toEqual(['Created: 2031-02-03 04:05:06 UTC', 'Finalized: unknown'])
    only('times', c)
  })
  it('epoch window', () => {
    expect(edit((v) => (v.minEpoch = 12400)).epochs).toEqual([`Epochs 12400 to ${base.maxEpoch}`])
    expect(edit((v) => (v.maxEpoch = null)).epochs).toEqual([])
    expect(edit((v) => ((v.maxEpoch = null), (v.minEpoch = 7))).epochs).toEqual(['Epoch 7 or later'])
    only('epochs', edit((v) => (v.maxEpoch = 99)))
  })
  it('fee', () => {
    const c = edit((v) => (v.feePaid = 123456))
    expect(c.fee).toEqual(['0.123456 tTARI'])
    expect(edit((v) => (v.feePaid = null)).fee).toEqual(['Not known without a summary'])
    // the fee also decides whether a revealed output is called "the network fee", so that item moves with it
    expect(c.revealed).not.toEqual(before.revealed)
  })
  it('locked message size', () => {
    const c = edit((v) => (v.outputs[1].ciphertextBytes = 144))
    expect(c.length[1]).toBe('Note 2: 144 bytes, a memo is inside')
    only('length', c)
  })
  it('a transaction with no private transfer says so item by item', () => {
    const c = edit((v) => {
      v.statements = []
      v.outputs = []
    })
    expect([c.token, c.spent, c.created, c.revealed, c.rule, c.length]).toEqual([[], [], [], [], [], []])
    expect(c.fee).toEqual(before.fee)
  })
})
