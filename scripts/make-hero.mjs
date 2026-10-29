// Maintainer script: the Auditor demo (the third ghost). Esmeralda testnet only, from the throwaway walletd account.
//
//   node scripts/make-hero.mjs setup   make the account public if it is not, publish template/ (stops if the fee is over 200 tTARI),
//                                      make the token with a fresh auditor key, mint. Skips every step that ledger.auditor already holds.
//   node scripts/make-hero.mjs send    turn POT base units of the public balance into ONE sealed note, then send the hero transfers out of
//                                      it (resumable: an id is written the moment it is submitted), capture the indexer replies and
//                                      record what each key should read.
//
// Why the shield step: a transfer paid from a PUBLIC balance writes its amount in the open ("revealed_amount"), and the sealed
// note then proves nothing. So the amount is first moved, all of it at once, into a sealed note; every hero transfer spends that
// note (or the change it leaves) and shows no amount in the open. A first try without this step (2026-10-18) is only in git history.
//
// The auditor SECRET is written into ledger.json on purpose, like the demo view secrets: it opens the amounts of the hero transfers
// and of nothing else (it cannot spend, and it cannot read a memo). Never reuse it. WD_URL=http://127.0.0.1:5100/json_rpc WD_ACCOUNT=spike
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { IndexerClient } from '@tari-project/ootle-indexer'
import { TARI_RESOURCE_ADDRESS, amountLiteral, fromHexStr, publicKeyLiteral, toHexStr } from '@tari-project/ootle'
import { decryptElgamalViewableBalance, generateKeypair } from '@tari-project/ootle-wasm'
import { INDEXER_URL } from '../src/config.ts'
import { parseTransaction } from '../src/chain.ts'
import { decryptOutput } from '../src/decrypt.ts'
import { call } from './wd.mjs'

const LEDGER = new URL('../ledger.json', import.meta.url)
const WASM = new URL('../template/target/wasm32-unknown-unknown/release/seance_auditor_token.wasm', import.meta.url)
const ACCOUNT = process.env.WD_ACCOUNT ?? 'spike'
const RANGE = [0n, 50_000n] // the search range of the Auditor lens; every hero amount is inside it
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const client = IndexerClient.usingFetchTransport(INDEXER_URL)

// The hero transfers: small amounts (the auditor reads an amount by trying values, so small is fast), memos only the recipient can read.
// POT is the sealed note everything is paid from. It is also the top of the range the Auditor lens searches, so every note below it is in range.
const POT = 50_000n
const PLAN = [
  { key: 'h01', to: 'bob', amount: 31415n, memo: 'Midnight at the old crypt. Come alone.' },
  { key: 'h02', to: 'carol', amount: 7000n, memo: 'I never told the auditor about the cat.' },
  { key: 'h03', to: 'bob', amount: 4096n, memo: 'The books are clean. The house is not.' },
  { key: 'h04', to: 'carol', amount: 250n, memo: 'Salt for the doorstep.' },
]
PLAN.reduce((pot, p) => ((p.pot = pot), pot - p.amount), POT) // pot = the sealed balance just before this transfer

const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'))
const save = () => writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n')
const addresses = (res) => [...new Set(JSON.stringify(res?.Accept?.up_substates ?? []).match(/(component|resource|vault|template|utxo)_[0-9a-f]{64}/g) ?? [])]

async function done(transaction_id) {
  const r = await call('transactions.wait_result', { transaction_id, timeout_secs: 180 })
  if (r.status !== 'Accepted') throw new Error(`${transaction_id} was not accepted: ${r.status} ${JSON.stringify(r.result?.result?.Reject ?? '').slice(0, 300)}`)
  return r
}

async function setup() {
  const a = (ledger.auditor ??= {})
  ledger.setup ??= []
  const note = (key, id, text) => {
    if (!ledger.setup.some((s) => s.key === key)) ledger.setup.push({ key, id, note: text })
    save()
  }
  const balances = await call('accounts.get_balances', { account: { Name: ACCOUNT }, refresh: true })
  const tari = balances.balances.find((b) => b.resource_address === TARI_RESOURCE_ADDRESS)
  const accountId = balances.address
  if (!tari?.vault_address) {
    const acct = await call('accounts.get', { name_or_address: { Name: ACCOUNT } })
    const sent = await call('accounts.stealth_transfer', {
      owner_account: { Name: ACCOUNT }, fee_params: { input_selection: 'PreferRevealed', pay_fee_with_swap: null }, input_selection: 'PreferRevealed', resource_address: TARI_RESOURCE_ADDRESS,
      transfers: [{ destination_address: acct.address, blinded_output_amount: '0', revealed_output_amount: 220_000_000, output_memo: null, pay_to: 'StealthPublicKey', attach_sender_address: false }],
      max_fee: 1_000_000, dry_run: false,
    })
    await done(sent.transaction_id)
    note('s1', sent.transaction_id, 'Made the throwaway account public on chain with 220 tTARI of public balance, so it can pay the fee of the next steps.')
    return setup() // read the vault address again
  }
  const w = (substate_id) => ({ substate_id, version: null, is_write: true })
  const fees = { fee_account: { Name: ACCOUNT }, max_fee: 5_000_000, proof_ids: [], min_epoch: null, max_epoch: null, new_outputs: null, override_inputs: true }
  if (!a.template) {
    const req = (dry_run) => ({ binary: readFileSync(WASM).toString('base64'), fee_account: { Name: ACCOUNT }, max_fee: 5_000_000, detect_inputs: true, dry_run, metadata: null })
    const dry = await call('transactions.publish_template', req(true))
    if (dry.dry_run_fee > 200_000_000) throw new Error(`the publish fee would be ${dry.dry_run_fee} uT, over the 200 tTARI that was approved`)
    const sent = await call('transactions.publish_template', req(false))
    const r = await done(sent.transaction_id)
    a.template = JSON.stringify(r).match(/template_[0-9a-f]{64}/)[0]
    note('s2', sent.transaction_id, 'Published template/ (no metadata).')
    save()
  }
  if (!a.secret) {
    const k = generateKeypair()
    Object.assign(a, { publicKey: toHexStr(k.public_key), secret: toHexStr(k.secret_key) })
    save() // the key is saved before anything is made with it
  }
  if (!a.resource) {
    const sent = await call('transactions.submit_instruction', {
      ...fees, inputs: [w(accountId), w(tari.vault_address)],
      instructions: [{ CallFunction: { address: a.template.replace('template_', ''), function: 'new', args: [publicKeyLiteral(a.publicKey)] } }],
    })
    const r = await done(sent.transaction_id)
    const made = addresses(r.result.result)
    a.component = made.find((x) => x.startsWith('component_') && x !== accountId)
    a.resource = made.find((x) => x.startsWith('resource_') && x !== TARI_RESOURCE_ADDRESS)
    note('s3', sent.transaction_id, 'Made the token (a stealth resource with the auditor view key) and its component.')
    save()
  }
  if (!ledger.setup.some((s) => s.key === 's4')) {
    const sent = await call('transactions.submit_instruction', {
      ...fees, inputs: [w(accountId), w(tari.vault_address), w(a.component), w(a.resource)],
      instructions: [
        { CallMethod: { call: { Address: a.component }, method: 'mint', args: [amountLiteral(1_000_000n)] } },
        { PutLastInstructionOutputOnWorkspace: { key: 0 } },
        { CallMethod: { call: { Address: accountId }, method: 'deposit', args: [{ Workspace: { id: 0, offset: null } }] } },
      ],
    })
    await done(sent.transaction_id)
    note('s4', sent.transaction_id, 'Minted 1,000,000 base units of the token as a public balance of the throwaway account.')
  }
  console.log('setup done:', a.resource)
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

/** What each key reads from each sealed note of the token, and the amount the auditor reads from its proof. Throws if it differs from the plan. */
async function describe(plan, reply) {
  const a = ledger.auditor
  const tx = parseTransaction(reply)
  const mine = tx.statements.filter((s) => s.resource === a.resource) // the fee side is another token
  if (mine.length !== 1) throw new Error(`${tx.id}: expected one transfer of the auditor token, found ${mine.length}`)
  const [st] = mine
  if (st.revealedIn !== '0' || st.revealedOut || st.inputCommitments.length !== 1) throw new Error(`${tx.id}: it must spend one sealed note and show no amount in the open`)
  const outputs = []
  for (const o of st.outputs) {
    const hits = []
    for (const [name, k] of Object.entries(ledger.keys)) {
      const plain = await decryptOutput(k.viewSecret, o)
      if (plain) hits.push({ reader: name, value: plain.value.toString(), memo: plain.memo })
    }
    if (hits.length > 1) throw new Error(`${tx.id}: note ${o.statement}.${o.index} opens with more than one demo key`)
    if (!o.viewableBalanceProof) throw new Error(`${tx.id}: note ${o.statement}.${o.index} has no viewable balance proof`)
    if (await decryptOutput(a.secret, o)) throw new Error(`${tx.id}: the auditor key opened the locked message`)
    const audited = decryptElgamalViewableBalance(o.viewableBalanceProof, fromHexStr(o.commitment), fromHexStr(a.publicKey), fromHexStr(a.secret), ...RANGE)
    outputs.push({ output: `${o.statement}.${o.index}`, ...(hits[0] ?? { reader: null }), auditor: audited === undefined ? null : String(audited) })
  }
  const theirs = outputs.filter((o) => o.reader === plan.to)
  if (theirs.length !== 1) throw new Error(`${tx.id}: expected one note readable by ${plan.to}, found ${theirs.length}`)
  if (theirs[0].value !== String(plan.amount) || theirs[0].memo !== plan.memo || theirs[0].auditor !== String(plan.amount)) throw new Error(`${tx.id}: what was read differs from what was sent`)
  if (outputs.some((o) => o.auditor === null) || outputs.reduce((sum, o) => sum + BigInt(o.auditor), 0n) !== plan.pot) throw new Error(`${tx.id}: the amounts the auditor reads must add up to the note that was spent (${plan.pot})`)
  return { outputs, fee: tx.feePaid, outcome: tx.outcome }
}

const balance = async () => (await call('accounts.get_balances', { account: { Name: ACCOUNT }, refresh: true })).balances.find((b) => b.resource_address === ledger.auditor.resource)

/** A wallet request: `amount` of the token to `to`, from the public balance ('RevealedOnly') or from sealed notes ('ConfidentialOnly'). */
const request = (to, amount, memo, from, dry_run) => ({
  owner_account: { Name: ACCOUNT }, fee_params: { input_selection: 'PreferRevealed', pay_fee_with_swap: null }, input_selection: from, resource_address: ledger.auditor.resource,
  transfers: [{ destination_address: to, blinded_output_amount: String(amount), revealed_output_amount: 0, output_memo: memo ? { Message: memo } : null, pay_to: 'StealthPublicKey', attach_sender_address: false }],
  max_fee: 100000, dry_run,
})

/** Dry run first (a bad request fails here, before anything is spent), then the real one. Returns the transaction id. */
async function submit(...args) {
  await call('accounts.stealth_transfer', request(...args, true))
  return (await call('accounts.stealth_transfer', request(...args, false))).transaction_id
}

async function send() {
  const a = ledger.auditor
  if (!a?.resource) throw new Error('run "setup" first')
  ledger.hero ??= []
  ledger.setup ??= []
  if (!ledger.setup.some((s) => s.key === 's5')) {
    if ((await balance()).confidential_balance !== '0') throw new Error('the wallet already holds sealed notes of the token; check them before shielding more')
    const own = (await call('accounts.get', { name_or_address: { Name: ACCOUNT } })).address
    const id = await submit(own, POT, null, 'RevealedOnly')
    ledger.setup.push({ key: 's5', id, note: `Turned ${POT} base units of the public balance into one sealed note of the throwaway account. Every hero transfer is paid from that note, so none of them shows an amount in the open.` })
    save()
    console.log(`s5 shield submitted ${id}`)
  }
  await done(ledger.setup.find((s) => s.key === 's5').id)
  for (const plan of PLAN) {
    let entry = ledger.hero.find((t) => t.key === plan.key)
    if (!entry) {
      const sealed = (await balance()).confidential_balance
      if (sealed !== String(plan.pot)) throw new Error(`${plan.key}: the wallet holds ${sealed} sealed base units, not ${plan.pot}`)
      const id = await submit(ledger.keys[plan.to].address, plan.amount, plan.memo, 'ConfidentialOnly')
      entry = { key: plan.key, id, to: plan.to, amount: String(plan.amount), memo: plan.memo, kind: 'audited' }
      ledger.hero.push(entry)
      save()
      console.log(`${plan.key} submitted ${id}`)
    }
    if (!entry.reply) {
      await done(entry.id)
      entry.reply = await waitForReply(entry.id)
      Object.assign(entry, { expected: await describe(plan, entry.reply) })
      save()
      console.log(`${plan.key} ${entry.expected.outcome} fee ${entry.expected.fee} uT; ${entry.expected.outputs.map((o) => `${o.output}->${o.reader ?? 'nobody'}/auditor ${o.auditor}`).join(', ')}`)
      await sleep(2500)
    }
  }
  for (const e of ledger.hero) await describe(PLAN.find((p) => p.key === e.key), e.reply)
  console.log(`verified ${ledger.hero.length} hero transactions against the plan`)
}

const mode = process.argv[2]
if (mode === 'setup') await setup()
else if (mode === 'send') await send()
else console.log('usage: node scripts/make-hero.mjs setup|send')
if (!existsSync(LEDGER)) throw new Error('ledger.json missing')
