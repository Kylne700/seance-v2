// The Auditor lens: count the AMOUNT of a sealed note with a token's audit key, and nothing else. Runs entirely in this page (wasm).
//
// A token made with an audit key puts a proof on every note: the amount, encrypted to the audit key (ElGamal). Opening it has no
// shortcut, so the wasm tries every amount in a range against the proof, a few microseconds each. The search is cut into slices of
// about SLICE_MS and the page is handed back between slices, so it never freezes and can show progress.
// The audit key never touches the message (the memo): that is locked to the recipient's own view key, and this module never tries.
import { fromHexStr } from '@tari-project/ootle'
import { decryptElgamalViewableBalance, publicKeyFromSecretKey } from '@tari-project/ootle-wasm'
import type { StealthOutput } from './chain.ts'
import { isViewSecret } from './decrypt.ts'

/** The search runs from 0 up to this many base units; a bigger amount is reported as outside the range. The demo transfers are all below it. */
export const RANGE_MAX = 50_000n

const SLICE_MS = 25 // the slice of work one turn may take; a frame is about 16 ms and a "long task" starts at 50 ms
const FIRST = 128 // candidates in the first slice, before any speed is known
const SLICE_MIN = 64
const SLICE_MAX = 1024 // also the cap if a coarse timer (a privacy mode rounds it) makes a slice look free: about 30 ms here, 150 ms on a phone five times slower

export interface Heard {
  output: StealthOutput
  amount: bigint | null // null: this key fits the note, but the amount is not between 0 and RANGE_MAX
}

export interface Hooks {
  alive(): boolean // false once a newer request has taken over: the search stops at the next slice
  progress(p: { note: number; notes: number; tried: number }): void // `tried` amounts of this note so far
}

/** Notes that carry an audit proof: only these can be counted by anyone. */
export const audited = (outputs: StealthOutput[]): StealthOutput[] => outputs.filter((o) => o.viewableBalanceProof != null)

const nextTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Count the notes the key fits. A note whose proof does not check out against the key is left out, so a key that fits none returns [].
 * Resolves to null if `hooks.alive()` went false meanwhile. `max` is only for tests; the page always searches up to RANGE_MAX.
 */
export async function audit(viewSecretHex: string, outputs: StealthOutput[], hooks: Hooks, max: bigint = RANGE_MAX): Promise<Heard[] | null> {
  const heard: Heard[] = []
  if (!isViewSecret(viewSecretHex)) return heard
  let secret: Uint8Array
  let publicKey: Uint8Array
  try {
    secret = fromHexStr(viewSecretHex)
    publicKey = publicKeyFromSecretKey(secret) // the public half is worked out here, so a pasted secret needs nothing else
  } catch {
    return heard // 64 hex characters that are not a valid key
  }
  const notes = audited(outputs)
  if (notes.length) {
    await nextTurn() // the caller has just drawn a card: let that task end, so the first slice is a task of its own (4x slower CPU: 143 ms in one, 61 ms apart)
    if (!hooks.alive()) return null
  }
  let slice = FIRST
  for (const [i, o] of notes.entries()) {
    const commitment = fromHexStr(o.commitment)
    let amount: bigint | null = null
    let fits = true
    for (let from = 0n; fits && amount === null && from <= max; ) {
      const last = from + BigInt(slice) - 1n
      const started = performance.now()
      try {
        amount = decryptElgamalViewableBalance(o.viewableBalanceProof as string, commitment, publicKey, secret, from, last > max ? max : last) ?? null
      } catch {
        fits = false // the wasm checks the proof against the key first, and a wrong key fails that check at once
        break
      }
      if (amount !== null) break
      from = last + 1n
      slice = Math.min(SLICE_MAX, Math.max(SLICE_MIN, Math.round((slice * SLICE_MS) / Math.max(performance.now() - started, 1))))
      hooks.progress({ note: i + 1, notes: notes.length, tried: Number(from) })
      await nextTurn()
      if (!hooks.alive()) return null
    }
    if (fits) heard.push({ output: o, amount })
  }
  return heard
}
