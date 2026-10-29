// A saved transaction (what ledger.json holds for an id) against an indexer's receipt for the same id: which fields both carry, and whether they agree.
// Kept apart from scripts/links.mjs so a test can run it offline against recorded receipts (test/fixtures/receipts.json).
//
// What can be compared, measured on 2026-10-29 over all 17 saved copies (15 demos and the 2 of the recorded sample):
//   outcome          summary.outcome                          receipt.outcome
//   fee paid         summary.total_fees_paid                  receipt.fee_receipt.total_fees_paid
//   spent notes      the utxo_ ids among the inputs           the utxo_ ids in receipt.diff_summary.downed (as sets)
//   epoch window     min_epoch and max_epoch of the saved transaction bound receipt.epoch (a bound, not an equal field)
// What cannot: the receipt body holds no transaction id (the id is only in the address it came from), and the saved inputs hold no version (null).
// The other inputs (a component, a vault, the token) are updated by the transaction, not spent, so they are not in `downed`; that is why only the utxo_ ids are compared.

export type Check = { name: string; ok: boolean; saved: string; receipt: string }

type Saved = {
  transaction?: {
    summary?: { outcome?: string | null; total_fees_paid?: number | null } | null
    transaction?: { V1?: { body?: { transaction?: { inputs?: { substate_id: string }[]; min_epoch?: number | null; max_epoch?: number | null } } } }
  }
}
type Receipt = {
  receipt?: { outcome?: string; epoch?: number; diff_summary?: { downed?: { substate_id: string }[] }; fee_receipt?: { total_fees_paid?: number } }
}

const show = (v: unknown): string => (v === undefined || v === null ? 'missing' : String(v))
const utxos = (ids: string[] | undefined): string | undefined => (ids ? ids.filter((i) => i.startsWith('utxo_')).sort().join(' ') : undefined)

/** The four comparisons, in this order. A field that is missing on either side is a failure, never a pass. */
export function compareReceipt(saved: Saved, body: Receipt): Check[] {
  const tx = saved.transaction
  const inner = tx?.transaction?.V1?.body?.transaction
  const r = body.receipt
  const spentSaved = utxos(inner?.inputs?.map((i) => i.substate_id))
  const spentReceipt = utxos(r?.diff_summary?.downed?.map((i) => i.substate_id))
  const lo = inner?.min_epoch ?? null
  const hi = inner?.max_epoch ?? null
  const epoch = r?.epoch
  const count = (s: string | undefined): string => (s === undefined ? 'missing' : `${s === '' ? 0 : s.split(' ').length} sealed notes`)
  return [
    { name: 'outcome', ok: tx?.summary?.outcome != null && tx.summary.outcome === r?.outcome, saved: show(tx?.summary?.outcome), receipt: show(r?.outcome) },
    { name: 'fee paid', ok: tx?.summary?.total_fees_paid != null && tx.summary.total_fees_paid === r?.fee_receipt?.total_fees_paid, saved: show(tx?.summary?.total_fees_paid), receipt: show(r?.fee_receipt?.total_fees_paid) },
    { name: 'spent notes', ok: spentSaved !== undefined && spentSaved === spentReceipt, saved: count(spentSaved), receipt: count(spentReceipt) },
    {
      name: 'epoch within the saved window',
      ok: inner !== undefined && typeof epoch === 'number' && (lo === null || epoch >= lo) && (hi === null || epoch <= hi),
      saved: `${lo ?? 'any'}..${hi ?? 'any'}`,
      receipt: show(epoch),
    },
  ]
}

/** What a failing row says: the names of the checks that failed, with both values. */
export const disagreements = (checks: Check[]): string => checks.filter((c) => !c.ok).map((c) => `${c.name} (saved ${c.saved}, receipt ${c.receipt})`).join('; ')
