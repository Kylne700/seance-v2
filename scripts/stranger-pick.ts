// Which transactions `npm run stranger` checks, and how a run ends. Kept apart from the script so a test can run it without the network.

export const PAGE = 100 // rows per list request
export const MAX_PAGES = 3 // list requests per run: at most 300 recent transactions are looked at, never a scan of the chain

/**
 * Pages back through the recent list (newest first) and keeps what `keep` accepts, until `want` are found, a page comes back empty or MAX_PAGES requests are made.
 * `list(lastId)` returns one page; the next page starts after the last row of the one before. A row is counted once, even if a page repeats it.
 */
export async function pickRecent<R extends { transaction_id: string }, K>(
  list: (lastId: string | null) => Promise<R[]>,
  keep: (row: R) => K | null,
  want: number,
  pause: () => Promise<void> = async () => {},
): Promise<{ found: K[]; requests: number }> {
  const found: K[] = []
  const seen = new Set<string>()
  let lastId: string | null = null
  let requests = 0
  while (requests < MAX_PAGES && found.length < want) {
    if (requests > 0) await pause()
    const rows = await list(lastId)
    requests++
    if (rows.length === 0) break
    for (const row of rows) {
      if (seen.has(row.transaction_id)) continue
      seen.add(row.transaction_id)
      const kept = keep(row)
      if (kept !== null && found.length < want) found.push(kept)
    }
    lastId = rows[rows.length - 1]!.transaction_id
  }
  return { found, requests }
}

/**
 * How a run ends. `auto` is a run on the latest transactions (no ids named). A chain with fewer than `want` private transfers is no failure: the ones found
 * were checked and the line says so, but only a full pass is saved to evidence/ (a quiet run must not replace it).
 */
export function verdict(failed: number, auto: boolean, found: number, want: number): { line: string; exit: 0 | 1; save: boolean } {
  if (failed > 0) return { line: `RESULT: FAIL (${failed} check(s))`, exit: 1, save: false }
  if (auto && found === 0) return { line: `RESULT: SKIP (quiet chain: 0 of ${want})`, exit: 0, save: false }
  if (auto && found < want) return { line: `RESULT: quiet chain: ${found} of ${want} (the ${found} found passed)`, exit: 0, save: false }
  return { line: 'RESULT: PASS', exit: 0, save: auto }
}
