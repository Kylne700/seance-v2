// Maintainer script: makes the demo set. Sends real Esmeralda stealth transactions from a walletd account ("Alice") to two
// recipients made here with randomWithViewKey (Bob, Carol), then records the indexer replies and the expected plaintexts in
// ledger.json (the fixture file and the test oracle). Esmeralda testnet only.
//
//   node scripts/make-demo.mjs            send what is missing, capture and verify (resumable: a tx id is written the moment it is
//                                         submitted, and an id that is already in the ledger is never sent again)
//   node scripts/make-demo.mjs --capture  no sending: capture the recent-transactions sample and re-verify
//   WD_URL=http://127.0.0.1:5100/json_rpc  WD_ACCOUNT=spike  LIMIT=<n> (send only the first n of the plan)
//
// Only the recipients' ADDRESS and VIEW secret are kept. Their spend keys exist in memory for the length of this process and are
// never written anywhere, so the demo outputs can never be spent. The view secrets are published on purpose (testnet only).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { IndexerClient } from '@tari-project/ootle-indexer'
import { Network, TARI_RESOURCE_ADDRESS, toHexStr } from '@tari-project/ootle'
import { SecretKeyWallet } from '@tari-project/ootle-secret-key-wallet'
import { INDEXER_URL } from '../src/config.ts'
import { parseTransaction } from '../src/chain.ts'
import { decryptOutput } from '../src/decrypt.ts'
import { call } from './wd.mjs'

const LEDGER = new URL('../ledger.json', import.meta.url)
const ACCOUNT = process.env.WD_ACCOUNT ?? 'spike'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const client = IndexerClient.usingFetchTransport(INDEXER_URL)

// The plan. Short Halloween memos of different lengths; one with no memo; the last one pays in the clear, for contrast.
const PLAN = [
  { key: 'd01', to: 'bob', amount: 666000n, memo: 'The candle went out. Did you do that?' },
  { key: 'd02', to: 'carol', amount: 1310000n, memo: 'Meet at the old well. Midnight.' },
  { key: 'd03', to: 'bob', amount: 31000n, memo: 'Trick or treat' },
  { key: 'd04', to: 'carol', amount: 500000n, memo: 'Boo!' },
  { key: 'd05', to: 'bob', amount: 2000000n, memo: 'Seven candles, one wish.' },
  { key: 'd06', to: 'carol', amount: 13000n, memo: 'Mind the third stair.' },
  { key: 'd07', to: 'bob', amount: 100000n, memo: null },
  { key: 'd08', to: 'carol', amount: 990000n, memo: 'Pumpkin pie fund.' },
  { key: 'd09', to: 'bob', amount: 404000n, memo: 'Page not found. Neither is the ghost.' },
  { key: 'd10', to: 'carol', amount: 700000n, memo: 'Garlic, salt, and a very long walk home.' },
  { key: 'd11', to: 'bob', amount: 250000n, memo: null, revealed: true },
]

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {}
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n')
ledger.network ??= 'esmeralda'
ledger.indexer ??= INDEXER_URL
ledger.warning ??= 'TESTNET ONLY. These view secrets are published on purpose so that anyone can try the Medium lens. They can read these demo transactions and nothing else. Never reuse them anywhere. The matching spend keys were never saved.'
ledger.keys ??= {}
ledger.txs ??= []

for (const [name, label] of [['bob', 'Bob (the recipient)'], ['carol', 'Carol (another recipient)'], ['eve', 'Eve (a stranger: a key that fits nothing here)']]) {
  if (ledger.keys[name]) continue
  const w = SecretKeyWallet.randomWithViewKey(Network.Esmeralda)
  ledger.keys[name] = { label, address: await w.getAddress(), viewSecret: toHexStr(w.getViewOnlySecret()) }
  save() // the keys are saved before anything is sent to them
}

async function waitForReply(id) {
  for (let i = 0; i < 60; i++) {
    try {
      const reply = await client.getTransaction(id)
      if (reply?.transaction?.summary?.outcome) return reply
    } catch { /* not indexed yet */ }
    await sleep(1500)
  }
  throw new Error(`indexer did not show a final outcome for ${id}`)
}

// Decrypt every output with every demo key: this is both the expected-plaintext record and the first run of the oracle.
async function describe(plan, reply) {
  const tx = parseTransaction(reply)
  const outputs = []
  for (const o of tx.outputs) {
    const hits = []
    for (const [name, k] of Object.entries(ledger.keys)) {
      const plain = await decryptOutput(k.viewSecret, o)
      if (plain) hits.push({ reader: name, value: plain.value.toString(), memo: plain.memo })
    }
    if (hits.length > 1) throw new Error(`${tx.id}: output ${o.statement}.${o.index} opens with more than one demo key`)
    outputs.push({ output: `${o.statement}.${o.index}`, ...(hits[0] ?? { reader: null }) })
  }
  const mine = outputs.filter((o) => o.reader === plan.to)
  const wantBlinded = plan.revealed ? 0 : 1
  if (mine.length !== wantBlinded) throw new Error(`${tx.id}: expected ${wantBlinded} output(s) readable by ${plan.to}, found ${mine.length}`)
  if (!plan.revealed && (mine[0].value !== String(plan.amount) || mine[0].memo !== plan.memo)) throw new Error(`${tx.id}: decrypted plaintext differs from what was sent`)
  const revealed = tx.statements.map((s) => s.revealedOut).filter(Boolean)
  return { outputs, revealedOut: revealed, fee: tx.feePaid, outcome: tx.outcome }
}

if (!process.argv.includes('--capture')) {
  for (const plan of PLAN.slice(0, Number(process.env.LIMIT ?? PLAN.length))) {
    let entry = ledger.txs.find((t) => t.key === plan.key)
    if (!entry) {
      const k = ledger.keys[plan.to]
      // ConfidentialOnly, both for the payment and for the fee: an account that holds a public balance would otherwise pay from it
      // (PreferRevealed), and then the amount sits in the open and the sealed note hides nothing.
      const req = (dry_run) => ({
        owner_account: { Name: ACCOUNT },
        fee_params: { input_selection: 'ConfidentialOnly', pay_fee_with_swap: null },
        input_selection: 'ConfidentialOnly',
        resource_address: TARI_RESOURCE_ADDRESS,
        transfers: [{
          destination_address: k.address,
          blinded_output_amount: plan.revealed ? '0' : String(plan.amount),
          revealed_output_amount: plan.revealed ? Number(plan.amount) : 0,
          output_memo: plan.memo ? { Message: plan.memo } : null,
          pay_to: 'StealthPublicKey',
          attach_sender_address: false,
        }],
        max_fee: 100000,
        dry_run,
      })
      await call('accounts.stealth_transfer', req(true)) // a bad request fails here, before anything is spent
      const sent = await call('accounts.stealth_transfer', req(false))
      entry = { key: plan.key, id: sent.transaction_id, to: plan.to, amount: String(plan.amount), memo: plan.memo, kind: plan.revealed ? 'revealed' : 'blinded', submittedAt: new Date().toISOString() }
      ledger.txs.push(entry)
      save()
      console.log(`${plan.key} submitted ${entry.id}`)
    }
    if (!entry.reply) {
      await call('transactions.wait_result', { transaction_id: entry.id, timeout_secs: 180 })
      entry.reply = await waitForReply(entry.id)
      Object.assign(entry, { expected: await describe(plan, entry.reply) })
      save()
      console.log(`${plan.key} ${entry.expected.outcome} fee ${entry.expected.fee} uT; readable outputs: ${entry.expected.outputs.filter((o) => o.reader).map((o) => `${o.output}->${o.reader}`).join(',') || 'none'}`)
      await sleep(2500) // polite pace, and lets the wallet settle its change output before the next send
    }
  }
}

// Re-verify everything that is on file, then take the recent-transactions sample for the offline "summon" button.
for (const e of ledger.txs) await describe(PLAN.find((p) => p.key === e.key), e.reply)
console.log(`verified ${ledger.txs.length} demo transactions against the plan`)
if (!ledger.recent || process.argv.includes('--capture')) {
  const list = await client.listRecentTransactions({ limit: 40 })
  const keep = list.transactions.filter((t) => { try { return parseTransaction(t).outputs.length > 0 } catch { return false } })
  ledger.recent = { capturedAt: new Date().toISOString(), note: 'Public Esmeralda transactions that contain a stealth transfer, as returned by the indexer. For the offline "summon" button.', transactions: keep.slice(0, 12) }
  save()
  console.log(`recent sample: ${ledger.recent.transactions.length} stealth transactions`)
}
