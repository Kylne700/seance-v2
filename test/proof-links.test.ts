// The links beside a saved copy. The second public indexer stopped serving whole transactions by id on 2026-10-29 (404), but still answers for their receipts.
import { describe, expect, it } from 'vitest'
import ledger from '../ledger.json'
import { EXPLORER_URL, INDEXER_URL, LEDGER_URL, MIRROR_URL, mirrorReceipt, receiptTx } from '../src/config.ts'
import { proofLinkSpecs } from '../src/render.ts'
import fixture from './fixtures/receipts.json'

const id = ledger.hero[0].id

describe('the proof links of a saved copy', () => {
  const links = proofLinkSpecs('recorded', id)

  it("are the second indexer's receipt, the saved ledger and the first indexer's receipt, in that order", () => {
    expect(links).toEqual([
      { href: `${MIRROR_URL}/transaction-receipts/${id}`, text: 'Receipt from the second public indexer' },
      { href: LEDGER_URL, text: 'The saved copy (ledger.json)' },
      { href: `${INDEXER_URL}/transaction-receipts/${id}`, text: 'Receipt from the first public indexer' },
    ])
  })

  it('start with the receipt, which is the one link the Medium card shows, and it is the second indexer, not the first', () => {
    expect(links[0]!.href).toBe(mirrorReceipt(id))
    expect(new URL(links[0]!.href).host).toBe('esme-indexer-b.ootle.tari.com')
    expect(links[2]!.href).toBe(receiptTx(id))
    expect(new URL(links[2]!.href).host).toBe('esme-indexer-a.ootle.tari.com')
  })

  it('never ask the second indexer for the whole transaction, which it answers 404', () => {
    expect(links.some((l) => l.href.startsWith(`${MIRROR_URL}/transactions/`))).toBe(false)
    expect(links.map((l) => l.text).join(' ')).not.toMatch(/raw answer/i)
  })

  it('point at the ledger in the v2 repository', () => {
    expect(LEDGER_URL).toBe('https://raw.githubusercontent.com/Kylne700/seance-v2/main/ledger.json')
  })

  it('are made for every id the links gate checks, and the second indexer has a receipt on record for each', () => {
    const ids = [...ledger.txs, ...ledger.hero, ...ledger.setup].map((e) => e.id).concat(ledger.recent.transactions.map((t) => t.transaction_id))
    expect(ids).toHaveLength(20)
    for (const one of ids) {
      expect(proofLinkSpecs('recorded', one)[0]!.href).toBe(`${MIRROR_URL}/transaction-receipts/${one}`)
      expect(Object.keys(fixture.receipts)).toContain(one)
    }
  })
})

describe('the proof links of a live answer and of an opened file', () => {
  it('are the explorer, and only that', () => {
    expect(proofLinkSpecs('live', id)).toEqual([{ href: `${EXPLORER_URL}/tx/${id}`, text: 'Open in the explorer' }])
    expect(proofLinkSpecs('file', id)).toEqual([{ href: `${EXPLORER_URL}/tx/${id}`, text: 'Open in the explorer' }])
  })
})
