import { SEANCE_RESOURCE } from './config.ts'

// Amounts come off the chain as integers of a token's smallest unit. 1 tTARI = 1,000,000 uT (micro); the demo token SEANCE has 8 decimals.
export interface Token {
  symbol: string
  decimals: number
}

/** "0.031 tTARI": the whole part, then the decimals with trailing zeros dropped. No rounding. */
export function units(value: bigint | number | string, token: Token): string {
  const v = BigInt(value)
  const base = 10n ** BigInt(token.decimals)
  const frac = (v % base).toString().padStart(token.decimals, '0').replace(/0+$/, '')
  return `${v / base}${frac ? '.' + frac : ''} ${token.symbol}`
}

export const TARI: Token = { symbol: 'tTARI', decimals: 6 }
export const tari = (uT: bigint | number | string): string => units(uT, TARI)

const TOKENS: Record<string, Token> = { ['resource_' + '01'.repeat(32)]: TARI, [SEANCE_RESOURCE]: { symbol: 'SEANCE', decimals: 8 } }

/** An amount in the unit of the token it is of. A token this page does not know is shown as a plain count, never as tTARI. */
export const amountOf = (resource: string, value: bigint | number | string): string => {
  const token = TOKENS[resource]
  return token ? units(value, token) : `${baseUnits(value)} base units`
}

/** "31,415": the raw count of smallest units, which is what the auditor actually searches. */
export const baseUnits = (v: bigint | number | string): string => BigInt(v).toLocaleString('en-US')

/** First and last characters of a long hex string, for tight places. */
export const short = (h: string, n = 8): string => (h.length <= 2 * n + 1 ? h : `${h.slice(0, n)}…${h.slice(-n)}`)

/** A transaction without a summary was rejected before it ran, or is not finalized yet. */
export const outcomeLabel = (v: { outcome: string | null; rejectedReason: string | null }): string => v.outcome ?? (v.rejectedReason ? 'Rejected' : 'Not finalized yet')

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** "The other sealed note stays" for one, "The other 3 sealed notes stay" for more. Callers say nothing at all for 0. */
export const theOther = (n: number, noun: string, verbOne: string, verbMany: string): string => `The other ${n === 1 ? `${noun} ${verbOne}` : `${n} ${noun}s ${verbMany}`}`

/** "2026-10-18 16:55:51 UTC" from the indexer's timestamp, or the raw text when it has another shape. */
export const when = (s: string | null): string => {
  const m = s?.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)/)
  return m ? `${m[1]} ${m[2]} UTC` : (s ?? 'unknown')
}
