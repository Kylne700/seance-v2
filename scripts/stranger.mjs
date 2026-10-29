// The Stranger lens without the browser: three recent live transactions, each fetched by its id, parsed with the same code the
// page uses, and checked. Exits 1 only if a check fails. Usage: node scripts/stranger.mjs [txid ...]  (no ids: use the latest ones)
// No ids: it pages back through the recent list (3 list requests of 100 rows at most) until it has 3 private transfers. On a quiet chain it
// checks the ones it found and says "quiet chain: N of 3" (exit 0; none found: SKIP, exit 0). It writes evidence/stranger-recent.txt only on a full pass.
// One request per list page and per transaction, 400 ms apart. It never scans the chain.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { IndexerClient } from '@tari-project/ootle-indexer'
import { parseTransaction, isTxId } from '../src/chain.ts'
import { outcomeLabel } from '../src/format.ts'
import { INDEXER_URL } from '../src/config.ts'
import { decryptOutput } from '../src/decrypt.ts'
import { PAGE, pickRecent, verdict } from './stranger-pick.ts'

const WANT = 3
const eve = JSON.parse(readFileSync(new URL('../ledger.json', import.meta.url), 'utf8')).keys.eve.viewSecret // fits nothing here
const client = IndexerClient.usingFetchTransport(INDEXER_URL)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lines = []
const say = (s) => {
  lines.push(s)
  console.log(s)
}
let failed = 0
const check = (ok, what) => {
  if (!ok) failed++
  say(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

let ids = process.argv.slice(2)
if (ids.some((i) => !isTxId(i))) throw new Error('every argument must be a 64-hex transaction id')
const auto = ids.length === 0
const listed = new Map() // id -> the entry from the recent list, to compare with the by-id answer
let requests = 0
if (auto) {
  const picked = await pickRecent(
    async (lastId) => (await client.listRecentTransactions({ limit: PAGE, last_id: lastId, source: null })).transactions,
    (item) => {
      try {
        const v = parseTransaction(item)
        return v.outputs.length === 0 || v.outcome !== 'Commit' ? null : v // the page prefers settled ones too
      } catch {
        return null // an entry this page cannot read is skipped, as it is on the page
      }
    },
    WANT,
    () => sleep(400),
  )
  requests = picked.requests
  for (const v of picked.found) {
    listed.set(v.id, v)
    ids.push(v.id)
  }
}
say(`Stranger lens, ${ids.length} transaction(s) from ${INDEXER_URL} at ${new Date().toISOString()}${auto ? ` (${requests} list request(s) of ${PAGE} rows)` : ''}`)

const ALLOWED = new Set(['resource', 'statement', 'index', 'commitment', 'senderNonce', 'ciphertext', 'ciphertextBytes', 'minimumValuePromise', 'viewableBalanceProof', 'spendCondition', 'lockKey'])
const hex = (s, bytes) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(s)

for (const id of ids) {
  await sleep(400)
  say(`${id}`)
  let v
  try {
    v = parseTransaction(await client.getTransaction(id))
  } catch (e) {
    check(false, `fetched and parsed (${e?.name}: ${e?.message})`)
    continue
  }
  check(v.id === id, 'the answer is for the id asked')
  check(typeof v.outcome === 'string' || typeof v.rejectedReason === 'string', `outcome is public: ${outcomeLabel(v)}`)
  check(v.outcome === null ? v.feePaid === null : typeof v.feePaid === 'number' && v.feePaid >= 0, `fee is public: ${v.feePaid === null ? 'none charged' : `${v.feePaid} uT`}`)
  check(v.statements.length > 0 && v.outputs.length > 0, `${v.statements.length} private transfer(s), ${v.outputs.length} sealed note(s)`)
  check(v.outputs.every((o) => hex(o.commitment, 32) && hex(o.senderNonce, 32) && o.ciphertext.length === o.ciphertextBytes * 2 && /^[0-9a-f]*$/.test(o.ciphertext)), 'every note shows real bytes: 32-byte commitment, 32-byte one-time key, ciphertext of the stated length')
  check(v.outputs.every((o) => Object.keys(o).every((k) => ALLOWED.has(k))), 'no note carries an amount or a memo field')
  check(v.statements.every((s) => s.inputCommitments.every((c) => hex(c, 32))), 'spent-note commitments are public and well formed')
  const before = listed.get(id)
  if (before) check(before.outcome === v.outcome && before.outputs.length === v.outputs.length && before.feePaid === v.feePaid, 'the recent list and the by-id answer agree')
  let heard = 0
  for (const o of v.outputs) if (await decryptOutput(eve, o)) heard++
  check(heard === 0, 'a key that fits nothing hears nothing from any note')
  say(`       notes: ${v.outputs.map((o) => `${o.ciphertextBytes}B/${o.spendCondition}`).join(' ')}  instructions: ${v.instructionKinds.join(', ')}`)
}

const end = verdict(failed, auto, ids.length, WANT)
say(end.line)
if (end.save) {
  mkdirSync(new URL('../evidence/', import.meta.url), { recursive: true })
  writeFileSync(new URL('../evidence/stranger-recent.txt', import.meta.url), lines.join('\n') + '\n')
}
process.exit(end.exit)
