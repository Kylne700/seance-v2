// The links gate (scripts/links.mjs) compares each saved copy with the receipt a public indexer returns for the same id. The comparison is checked here, offline,
// against the receipts recorded on 2026-10-29 (test/fixtures/receipts.json), and shown to fail when a saved copy or a receipt is changed.
import { describe, expect, it } from 'vitest'
import ledger from '../ledger.json'
import { compareReceipt, disagreements } from '../scripts/receipt-check.ts'
import fixture from './fixtures/receipts.json'

type Saved = Parameters<typeof compareReceipt>[0]
type Receipt = Parameters<typeof compareReceipt>[1]
const receipts = fixture.receipts as Record<string, Receipt>

// the 17 saved copies: the 15 demos (ledger.txs and ledger.hero) and the 2 of the recorded sample, which the ledger keeps in the indexer's list shape
const copies: [string, Saved][] = [
  ...[...ledger.txs, ...ledger.hero].map((e): [string, Saved] => [e.id, e.reply as Saved]),
  ...ledger.recent.transactions.map((t): [string, Saved] => [t.transaction_id, { transaction: t } as Saved]),
]
const clone = <T>(v: T): T => structuredClone(v)
const failing = (c: ReturnType<typeof compareReceipt>): string[] => c.filter((x) => !x.ok).map((x) => x.name)
const inputsOf = (s: Saved) => s.transaction!.transaction!.V1!.body!.transaction!
// a demo that spends sealed notes, so a note can be taken away or added
const withNotes = copies.find(([, s]) => inputsOf(s).inputs!.some((i) => i.substate_id.startsWith('utxo_')))!

describe('the recorded receipts', () => {
  it('are 20: the 15 demos, the 3 set-up steps and the 2 of the recorded sample', () => {
    expect(copies).toHaveLength(17)
    expect(Object.keys(receipts)).toHaveLength(20)
    for (const e of ledger.setup) expect(receipts[e.id]).toBeDefined()
  })

  it('all say Commit, which is what the gate asks of a set-up step (it has no saved copy)', () => {
    for (const [id, r] of Object.entries(receipts)) expect(r.receipt?.outcome, id).toBe('Commit')
  })

  it('hold no transaction id of their own: the id is only in the address they come from', () => {
    for (const r of Object.values(receipts)) expect(JSON.stringify(r)).not.toMatch(/transaction_id|"id":/)
  })
})

describe('compareReceipt on the real saved copies', () => {
  it('finds all four checks agreeing for each of the 17, against its own receipt', () => {
    for (const [id, saved] of copies) {
      const checks = compareReceipt(saved, receipts[id]!)
      expect(checks.map((c) => c.name), id).toEqual(['outcome', 'fee paid', 'spent notes', 'epoch within the saved window'])
      expect(disagreements(checks), id).toBe('')
    }
  })

  it('has a real epoch window to hold each receipt to: every saved copy names a last epoch, so that check is never empty', () => {
    for (const [id, saved] of copies) expect(typeof inputsOf(saved).max_epoch, id).toBe('number')
  })

  it('does not care in which order the saved inputs are listed, nor about the inputs that are not sealed notes', () => {
    const [id, saved] = withNotes
    const shuffled = clone(saved)
    inputsOf(shuffled).inputs!.reverse()
    inputsOf(shuffled).inputs!.push({ substate_id: 'component_00', version: null, is_write: true } as never)
    expect(failing(compareReceipt(shuffled, receipts[id]!))).toEqual([])
  })
})

describe('compareReceipt catches a change', () => {
  const [id, saved] = withNotes
  const receipt = receipts[id]!

  it('in the outcome of the saved copy', () => {
    const t = clone(saved)
    t.transaction!.summary!.outcome = 'FeeIntentCommit'
    expect(failing(compareReceipt(t, receipt))).toEqual(['outcome'])
  })

  it('in the outcome of the receipt', () => {
    const r = clone(receipt)
    r.receipt!.outcome = 'Reject'
    expect(failing(compareReceipt(saved, r))).toEqual(['outcome'])
  })

  it('in the fee', () => {
    const t = clone(saved)
    t.transaction!.summary!.total_fees_paid! += 1
    expect(failing(compareReceipt(t, receipt))).toEqual(['fee paid'])
  })

  it('in the sealed notes the transaction spent: one taken away, one added, one swapped', () => {
    const away = clone(saved)
    inputsOf(away).inputs = inputsOf(away).inputs!.filter((i) => !i.substate_id.startsWith('utxo_'))
    expect(failing(compareReceipt(away, receipt))).toEqual(['spent notes'])
    const added = clone(saved)
    inputsOf(added).inputs!.push({ substate_id: `utxo_${'0'.repeat(64)}_${'f'.repeat(64)}`, version: null, is_write: true } as never)
    expect(failing(compareReceipt(added, receipt))).toEqual(['spent notes'])
    const swapped = clone(receipt)
    swapped.receipt!.diff_summary!.downed![0]!.substate_id = `utxo_${'0'.repeat(64)}_${'e'.repeat(64)}`
    expect(failing(compareReceipt(saved, swapped))).toEqual(['spent notes'])
  })

  it('in the epoch: a receipt from after the last epoch the transaction allowed, or before the first', () => {
    const late = clone(saved)
    inputsOf(late).max_epoch = receipt.receipt!.epoch! - 1
    expect(failing(compareReceipt(late, receipt))).toEqual(['epoch within the saved window'])
    const early = clone(saved)
    inputsOf(early).min_epoch = receipt.receipt!.epoch! + 1
    expect(failing(compareReceipt(early, receipt))).toEqual(['epoch within the saved window'])
    const open = clone(saved)
    inputsOf(open).min_epoch = null
    inputsOf(open).max_epoch = null
    expect(failing(compareReceipt(open, receipt))).toEqual([])
  })

  it('and names both values when it reports one', () => {
    const t = clone(saved)
    t.transaction!.summary!.total_fees_paid! += 1
    expect(disagreements(compareReceipt(t, receipt))).toBe(`fee paid (saved ${t.transaction!.summary!.total_fees_paid}, receipt ${receipt.receipt!.fee_receipt!.total_fees_paid})`)
  })
})

describe('compareReceipt never passes on what is missing', () => {
  it('fails every check for an answer that is no receipt (a 404 body, or an empty one)', () => {
    for (const body of [{ error: 'Transaction receipt txreceipt_00 not found' }, {}] as Receipt[]) {
      expect(failing(compareReceipt(copies[0]![1], body))).toEqual(['outcome', 'fee paid', 'spent notes', 'epoch within the saved window'])
    }
  })

  it('fails for a saved copy that holds nothing to compare', () => {
    expect(failing(compareReceipt({}, receipts[copies[0]![0]]!))).toEqual(['outcome', 'fee paid', 'spent notes', 'epoch within the saved window'])
  })

  it("fails when the receipt is another transaction's: every demo's receipt against every other demo's saved copy", () => {
    let wrong = 0
    for (const [a, saved] of copies) {
      for (const [b] of copies) {
        if (a === b) continue
        if (failing(compareReceipt(saved, receipts[b]!)).length === 0) wrong++
      }
    }
    // two transactions can share an outcome, a fee and an epoch window, but not the sealed notes they spent
    expect(wrong).toBe(0)
  })
})
