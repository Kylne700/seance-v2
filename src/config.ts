// Single source of truth: the app, the build (CSP) and the scripts all read these.
export const INDEXER_URL = 'https://esme-indexer-a.ootle.tari.com'
export const EXPLORER_URL = 'https://explorer.tari.mw'
// How long one indexer call may take before the page treats the indexer as down and falls back to recorded data.
export const INDEXER_TIMEOUT_MS = 8000
// How many of the latest transactions the "summon" button looks at. One request, never a scan of the chain.
export const RECENT_LIMIT = 40
// The explorer reads the same public indexer as this page (esme-indexer-a.ootle.tari.com), so it shows only what that indexer still holds.
export const explorerTx = (id: string): string => `${EXPLORER_URL}/tx/${id}`
// Tari's second public indexer. It is a stale mirror (its newest transaction is from 2026-10-21) that still answers for the demo transactions the main one dropped.
// Links only: this page never calls it, and the CSP lets the page talk to one indexer.
export const MIRROR_URL = 'https://esme-indexer-b.ootle.tari.com'
export const mirrorTx = (id: string): string => `${MIRROR_URL}/transactions/${id}`
// The first indexer's receipt of a transaction. Receipts are synced from the network's state, not from gossip, so one can outlive the body the indexer dropped. A link only, like mirrorTx.
export const receiptTx = (id: string): string => `${INDEXER_URL}/transaction-receipts/${id}`
// The recording behind the "Recorded" label, as it stands in the repository.
export const LEDGER_URL = 'https://raw.githubusercontent.com/Kylne700/seance/main/ledger.json'
// The demo token (made by template/, with an audit key). scripts/make-hero.mjs records the same address in ledger.json, and a test keeps the two equal.
export const SEANCE_RESOURCE = 'resource_469b4ea86f93dd363e7273940ced6ae30d1dede6668d27ddd56b14768b3a86e7'
