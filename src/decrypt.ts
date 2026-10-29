// The Medium lens: decrypt one stealth output with a recipient's view secret. Runs entirely in this page (wasm).
// A wrong key, a tampered ciphertext and an output that is not the key's all come back as null: silence, not an error.
import { WasmStealthCrypto, decryptInputData, fromHexStr } from '@tari-project/ootle'
import type { StealthOutput } from './chain.ts'
import { plural } from './format.ts'

export interface Plain {
  value: bigint // micro-tTARI
  memo: string | null // text of the memo, or a short description for memo kinds that are not text
}

let crypto: WasmStealthCrypto | undefined

export const isViewSecret = (s: string): boolean => /^[0-9a-f]{64}$/.test(s)

/** What is wrong with a pasted key, in words, or null when it is a view secret. A 64-character string is not "too short or too long", so it gets its own sentence. */
export const viewSecretProblem = (s: string): string | null =>
  isViewSecret(s) ? null : s.length === 64 ? 'That is 64 characters, but a view secret uses only 0-9 and a-f.' : `A view secret is 64 hexadecimal characters (0-9 and a-f). You have typed ${plural(s.length, 'character')}.`

// The wasm returns the memo as the JSON of Rust's `Memo` enum: {"Message":"text"} | {"U256":..} | {"Bytes":[..]} | {"PayRefAndBytes":..}
export function memoText(json: string | undefined | null): string | null {
  if (!json) return null
  try {
    const m = JSON.parse(json) as Record<string, unknown>
    if (typeof m.Message === 'string') return m.Message
    const kind = Object.keys(m)[0]
    return kind ? `(${kind} memo, not text)` : null
  } catch {
    return json
  }
}

export async function decryptOutput(viewSecretHex: string, o: Pick<StealthOutput, 'commitment' | 'senderNonce' | 'ciphertext'>): Promise<Plain | null> {
  if (!isViewSecret(viewSecretHex)) return null
  try {
    crypto ??= new WasmStealthCrypto()
    const d = await decryptInputData(crypto, fromHexStr(o.commitment), fromHexStr(o.ciphertext), {
      senderPublicNonce: fromHexStr(o.senderNonce),
      viewSecret: fromHexStr(viewSecretHex),
      skipMemo: false,
    })
    return { value: BigInt(d.value), memo: memoText(d.memo) }
  } catch {
    return null
  }
}

export interface Reading {
  output: StealthOutput
  plain: Plain
}

/** Try one key on every sealed note of a transaction. An empty list is the answer for a key that opens none of them. */
export async function listen(viewSecretHex: string, outputs: StealthOutput[]): Promise<Reading[]> {
  const heard: Reading[] = []
  for (const output of outputs) {
    const plain = await decryptOutput(viewSecretHex, output)
    if (plain) heard.push({ output, plain })
  }
  return heard
}
