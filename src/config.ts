// Single source of truth: the app, the build (CSP) and the scripts all read these.
export const INDEXER_URL = 'https://esme-indexer-a.ootle.tari.com'
export const EXPLORER_URL = 'https://explorer.tari.mw'
// How long one indexer call may take before the page treats the indexer as down and falls back to recorded data.
export const INDEXER_TIMEOUT_MS = 8000
// How many of the latest transactions the "summon" button looks at, and a lookup looks in for the id. One request, never a scan of the chain.
export const RECENT_LIMIT = 40
// How long that list is kept, so Summon and the lookups share one request for it. The indexer's own copy is good for 30 seconds (cache-control), so a minute is the same order.
export const LIST_KEPT_MS = 60_000
// The biggest saved transaction file the page will open. One transaction is a few KB.
export const MAX_FILE_BYTES = 1024 * 1024
// The explorer reads the same public indexer as this page (esme-indexer-a.ootle.tari.com), so it shows only what that indexer still holds.
export const explorerTx = (id: string): string => `${EXPLORER_URL}/tx/${id}`
// Tari's second public indexer. On 2026-10-24 it was a stale mirror (newest transaction 2026-10-21) that still answered for the demo transactions the main one dropped. On 2026-10-29 it answers 404 for a full transaction by id, but 200 for the receipt of the same id (README, dated note).
// Links only: this page never calls it, and the CSP lets the page talk to one indexer (the first).
export const MIRROR_URL = 'https://esme-indexer-b.ootle.tari.com'
// The second indexer's receipt of a transaction: its outcome, fee and the substates it spent and created, not the transaction itself.
export const mirrorReceipt = (id: string): string => `${MIRROR_URL}/transaction-receipts/${id}`
// The first indexer's receipt of a transaction. Receipts are synced from the network's state, not from gossip, so one can outlive the body the indexer dropped. A link only, like mirrorReceipt.
export const receiptTx = (id: string): string => `${INDEXER_URL}/transaction-receipts/${id}`
// The recording behind the "Recorded" label, as it stands in the repository.
export const LEDGER_URL = 'https://raw.githubusercontent.com/Kylne700/seance-v2/main/ledger.json'
// The demo token (made by template/, with an audit key). scripts/make-hero.mjs records the same address in ledger.json, and a test keeps the two equal.
export const SEANCE_RESOURCE = 'resource_469b4ea86f93dd363e7273940ced6ae30d1dede6668d27ddd56b14768b3a86e7'
