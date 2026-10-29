// The recorded demo set is the test oracle: every demo transaction, read with the real wasm, with the right and the wrong keys.
import { describe, expect, it } from 'vitest'
import ledger from '../ledger.json'
import { parseTransaction } from '../src/chain.ts'
import { decryptOutput, listen } from '../src/decrypt.ts'

interface Expected {
  outputs: { output: string; reader: string | null; value?: string; memo?: string | null }[]
  revealedOut: { amount: string; receiver: string }[]
  fee: number
  outcome: string
}
const keys = ledger.keys as Record<string, { viewSecret: string }>
const txs = ledger.txs as unknown as { key: string; id: string; amount: string; memo: string | null; kind: string; reply: unknown; expected: Expected }[]

const flipHex = (hex: string, at = 0): string => {
  const b = parseInt(hex.slice(at * 2, at * 2 + 2), 16) ^ 1
  return hex.slice(0, at * 2) + b.toString(16).padStart(2, '0') + hex.slice(at * 2 + 2)
}

describe('demo set', () => {
  it('has 8 to 12 transactions, with at least one revealed amount', () => {
    expect(txs.length).toBeGreaterThanOrEqual(8)
    expect(txs.length).toBeLessThanOrEqual(12)
    expect(txs.some((t) => t.kind === 'revealed')).toBe(true)
  })

  for (const tx of txs) {
    describe(`${tx.key} ${tx.id.slice(0, 10)} (${tx.kind})`, () => {
      const view = parseTransaction(tx.reply)

      it('parses to the recorded public facts', () => {
        expect(view.id).toBe(tx.id)
        expect(view.outcome).toBe(tx.expected.outcome)
        expect(view.feePaid).toBe(tx.expected.fee)
        expect(view.statements.flatMap((s) => (s.revealedOut ? [s.revealedOut] : []))).toEqual(tx.expected.revealedOut)
      })

      it('the right view key gives the expected amount and memo; every other key gives silence', async () => {
        for (const e of tx.expected.outputs) {
          const [s, i] = e.output.split('.').map(Number)
          const output = view.statements[s].outputs[i]
          for (const [name, k] of Object.entries(keys)) {
            const plain = await decryptOutput(k.viewSecret, output)
            if (name === e.reader) {
              expect(plain, `${name} reads ${e.output}`).not.toBeNull()
              expect(plain?.value).toBe(BigInt(e.value ?? '-1'))
              expect(plain?.memo ?? null).toBe(e.memo ?? null)
            } else {
              expect(plain, `${name} must hear nothing from ${e.output}`).toBeNull()
            }
          }
        }
      })
    })
  }

  it('the recorded amount and memo of each blinded demo tx are what the plan says', async () => {
    for (const tx of txs.filter((t) => t.kind === 'blinded')) {
      const e = tx.expected.outputs.find((o) => o.reader)
      expect(e?.value).toBe(tx.amount)
      expect(e?.memo ?? null).toBe(tx.memo)
    }
  })
})

describe('tampering and bad keys', () => {
  const tx = txs.find((t) => t.kind === 'blinded' && t.memo)!
  const e = tx.expected.outputs.find((o) => o.reader)!
  const [s, i] = e.output.split('.').map(Number)
  const output = parseTransaction(tx.reply).statements[s].outputs[i]
  const key = keys[e.reader!].viewSecret

  it('control: the untouched output opens', async () => {
    expect((await decryptOutput(key, output))?.value).toBe(BigInt(tx.amount))
  })
  it('a flipped bit in the ciphertext fails (first byte, last byte)', async () => {
    expect(await decryptOutput(key, { ...output, ciphertext: flipHex(output.ciphertext, 0) })).toBeNull()
    expect(await decryptOutput(key, { ...output, ciphertext: flipHex(output.ciphertext, output.ciphertext.length / 2 - 1) })).toBeNull()
  })
  it('a flipped bit in the sender nonce or the commitment fails', async () => {
    expect(await decryptOutput(key, { ...output, senderNonce: flipHex(output.senderNonce, 3) })).toBeNull()
    expect(await decryptOutput(key, { ...output, commitment: flipHex(output.commitment, 3) })).toBeNull()
  })
  it('a truncated ciphertext fails', async () => {
    expect(await decryptOutput(key, { ...output, ciphertext: output.ciphertext.slice(0, -2) })).toBeNull()
    expect(await decryptOutput(key, { ...output, ciphertext: '' })).toBeNull()
  })
  it('a malformed key is silence, not an exception', async () => {
    for (const bad of ['', 'zz', key.slice(1), key + '00', key.toUpperCase(), '0'.repeat(64)]) {
      expect(await decryptOutput(bad, output), JSON.stringify(bad.slice(0, 8))).toBeNull()
    }
  })
  it('a key one bit away from the right one is silence', async () => {
    expect(await decryptOutput(flipHex(key, 0), output)).toBeNull()
  })
})

describe('what the size of a sealed note gives away', () => {
  it('a note without a memo is 80 bytes; a note with a memo is longer (the caption on the page says exactly this)', () => {
    for (const tx of txs.filter((t) => t.kind === 'blinded')) {
      const view = parseTransaction(tx.reply)
      const e = tx.expected.outputs.find((o) => o.reader)!
      const [s, i] = e.output.split('.').map(Number)
      const bytes = view.statements[s].outputs[i].ciphertextBytes
      if (tx.memo) expect(bytes, `${tx.key} has a memo`).toBeGreaterThan(80)
      else expect(bytes, `${tx.key} has no memo`).toBe(80)
    }
  })
})

describe('listen: one key on every sealed note of a transaction', () => {
  const outputsOf = (tx: (typeof txs)[number]) => parseTransaction(tx.reply).outputs
  const first = txs[0]

  it('the right key opens exactly the note meant for it', async () => {
    const reader = first.expected.outputs.find((o) => o.reader)!.reader!
    const heard = await listen(keys[reader].viewSecret, outputsOf(first))
    expect(heard).toHaveLength(1)
    expect(heard[0].plain.value).toBe(BigInt(first.amount))
    expect(heard[0].plain.memo).toBe(first.memo)
  })
  it('a key that fits nothing hears nothing: an empty list, not an error', async () => {
    expect(await listen(keys.eve.viewSecret, outputsOf(first))).toEqual([])
  })
  it('the recipient hears nothing from a transaction where the amount was revealed', async () => {
    const revealed = txs.find((t) => t.kind === 'revealed')!
    expect(await listen(keys.bob.viewSecret, outputsOf(revealed))).toEqual([])
  })
  it('no notes, no sound', async () => {
    expect(await listen(keys.bob.viewSecret, [])).toEqual([])
  })
})

describe('a transaction the network did not settle', () => {
  const reason = 'Execution failure (InsufficientFunds): At instruction #3: not enough revealed funds'
  const rejected = (() => {
    const reply = structuredClone(txs[0].reply) as { transaction: Record<string, unknown> }
    reply.transaction.summary = null
    reply.transaction.rejected_reason = reason
    return reply
  })()

  it('still parses: no outcome, no fee, the reason kept, the sealed notes still shown', () => {
    const view = parseTransaction(rejected)
    expect(view.outcome).toBeNull()
    expect(view.feePaid).toBeNull()
    expect(view.rejectedReason).toBe(reason)
    expect(view.outputs).toHaveLength(2)
  })
  it('a settled one has no rejection reason', () => {
    expect(parseTransaction(txs[0].reply).rejectedReason).toBeNull()
  })
})
