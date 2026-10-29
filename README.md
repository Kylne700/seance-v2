# Seance

**Live: <https://kylne700.github.io/seance/>** (Tari Esmeralda testnet only) [![pages](https://github.com/Kylne700/seance/actions/workflows/pages.yml/badge.svg)](https://github.com/Kylne700/seance/actions/workflows/pages.yml)

**Watch:** a [silent screen recording of about 60 seconds](https://kylne700.github.io/seance/media/seance-demo.mp4), filmed on the live page on 2026-10-25.

Seance reads real Tari Esmeralda transactions in your browser and shows, side by side, what a stranger with no key can read, what a recipient's view key adds, and what a token's audit key counts. It also lists what a sealed payment still shows to everyone with no key at all, such as the token, the times, the fee and the notes it spends. Open the page and a real private transfer is already on the table with the three ghosts at work; paste any transaction id to see another.

> **Dated note, 2026-10-24.** The public Esmeralda indexer that this page and Tari's explorer read (`esme-indexer-a.ootle.tari.com`) no longer holds the 18 transactions linked in this file: it answers 404. The page copes. When the indexer is up but has dropped a demo transaction, that one card shows the copy saved in `ledger.json` (it says so, with the date the copy was saved, 2026-10-20) while the rest of the page stays live. The links in this file point to Tari's second public indexer, a stale mirror (its newest transaction is from 2026-10-21) that may drop history too. More, and how to check it: [Where the demo transactions went](#where-the-demo-transactions-went).

![Seance on first load, scrolled to the three ghosts: a real transaction (demo 1) from a copy saved on 2026-10-20, labelled as saved, already read by all three. The Stranger sees only public fields, the Medium reads 0.00031415 SEANCE and a memo with Bob's view key, the Auditor counts both amounts with the audit key](docs/seance-ghosts.png)

**Quickstart for a judge** (2 minutes, nothing to install, no wallet):

1. Open <https://kylne700.github.io/seance/>. A saved real transaction (demo 1) is already on the table, labelled as a saved copy. **The Stranger** shows what anyone can read from it. **The Medium**, with Bob's view key, has read 0.00031415 SEANCE and the memo "Midnight at the old crypt. Come alone." **The Auditor**, with the demo token's audit key, has counted both sealed notes (0.00031415 and 0.00018585 SEANCE) and cannot open the memos. **What still leaks**, under the cards, lists what stays public.
2. Press **Summon a recent transaction**, or paste any Esmeralda transaction id and press **Look at it**. That asks the live indexer, and the Stranger shows the real public fields of that transaction. If the indexer's latest transactions hold no private transfer (the testnet is sometimes quiet), the page shows a recorded one from 2026-10-20 instead and says so. Give the Medium or the Auditor a key that fits (the demo keys are listed below) or a wrong one (Eve's) and watch it answer "The spirits are quiet."
3. Press **Hold the seance** on another prepared transaction, then scroll to **The Poltergeist**: a ghost with no key that tries four chain-analysis tricks on our 11 TARI demo payments and says which still work on Tari.
4. Check rather than trust. Beside each shown transaction are proof links: a live answer links to the explorer, a saved copy links to the raw answer from the second public indexer, to `ledger.json` and to its receipt on the first indexer. The Auditor card has a closed section with the 34-line Rust template that made the token, with a link to the token on the explorer, whose page lists the token's View key (the audit key's public half). `npm test` runs offline.

**Limits, up front.** Testnet only: nothing here touches mainnet. The page trusts the indexer's answer and does not check it against the chain. The Auditor reads only the notes of our own demo token. The demo transactions come from one throwaway wallet, so the Poltergeist's numbers describe that wallet. The cryptography is the official SDK, which we did not audit. More in the [threat model](#threat-model).

Three ghosts read one transaction; a fourth studies the demo payments as a set:

- **The Stranger** holds no key. It shows what everyone can see: the id, the outcome, the fee, the sealed notes as real bytes, each with a plain caption. Under the cards, **What still leaks** lists what stays public, with this transaction's real values.
- **The Medium** holds a recipient's view key and listens inside the page. With the right key it hears the amount and the memo. With a wrong key it hears nothing: "The spirits are quiet."
- **The Auditor** holds the audit key of a token. It counts the amount of every sealed note of that token. It cannot read a memo, and a view key cannot spend. It works on the four payments in our own demo token (SEANCE), which was made with an audit key. On any other transaction it says there is nothing to count.
- **The Poltergeist** holds no key. It reads only public data and tries four chain-analysis tricks (address reuse, amount matching, timing, fee fingerprint), plus the spend graph as an extra, on the 11 TARI demo payments and on a **synthetic** transparent ledger of the same payments. Some tricks still work on Tari, and the page says which.

Made for the Tari October Build Contest, "Spooky Secrets". Testnet only. Nothing here touches mainnet.

Status: live at <https://kylne700.github.io/seance/> (GitHub Pages, rebuilt from `main` on every push). The link-preview image is `public/og.png`. A result card was made for the contest post; it is not part of this repo. A silent screen recording of about 60 seconds, filmed on the live page on 2026-10-25, is `public/media/seance-demo.mp4`, served at <https://kylne700.github.io/seance/media/seance-demo.mp4>; it shows the page as it was that day. An older 56-second recording, made on 2026-10-18 and not part of this repo, shows the first set of transaction ids (see "Where the demo transactions went" below) and the page as it was that day.

## Try it

| Time | Do this | You should see |
|---|---|---|
| 0 s | Open the page and wait about two seconds | A saved real transaction (demo 1, a copy saved on 2026-10-20) already on the table, labelled as a saved copy; nothing has been asked of the indexer yet. The Stranger shows its public fields, the Medium has read 0.00031415 SEANCE and the memo with Bob's key, the Auditor has counted both sealed notes with the audit key, and **What still leaks** is filled in |
| 10 s | Press **Summon a recent transaction**, or paste any transaction id and press **Look at it** | The Stranger card with the real public fields of that transaction, the sealed notes as bytes, proof links (a live answer links to the same id in the explorer; a saved copy links to the raw answer from the second public indexer, to `ledger.json` and to its receipt on the first indexer), and the **What still leaks** panel for it. Summon looks at the latest 40 transactions and prefers a private transfer by someone else; when there is none it says so and shows one of ours, or a recorded one |
| 60 s | Leave demo 1 picked and press **Hold the seance** | All three ghosts on one payment. The Stranger sees bytes. The Medium, with Bob's key, reads 0.00031415 SEANCE and "Midnight at the old crypt. Come alone." The Auditor, with the audit key, counts both sealed notes (0.00031415 and 0.00018585 SEANCE) in about two seconds behind a progress bar, and says "Memo: shut." Give either ghost Eve's key and it answers "The spirits are quiet." The page asks the live indexer first. On 2026-10-24 it answers 404 for every prepared transaction, so the Stranger card says it is the copy saved on 2026-10-20 and the badge stays **Live** |
| 5 min | Scroll to **The Poltergeist** and read the table. Then summon or pick any other transaction, paste a view secret into the Medium's field (the demo keys are below, or use your own), and hand the Auditor a different key | The Poltergeist's five tricks on two ledgers, with the real counts. The Medium decrypts in the page: the key is never sent, stored or put in the address, and the page's Content Security Policy only lets it talk to the indexer, which you can check in the page source. On a transaction of an ordinary token the Auditor says there is nothing to count |

If the indexer cannot be reached (network error, no answer in 8 s, a 5xx or a 429), the page switches by itself to recorded data, says so, and labels every answer "Recorded". "Use recorded data" switches by hand. If the indexer is up but answers 404 for a demo transaction the page holds a copy of (on 2026-10-24 it does, for all 15 demos), only that answer is the saved copy: its card says so with the date, the badge stays **Live**, and the next id you paste still goes to the live indexer. An id that is not a demo and that the indexer does not know gets "The indexer does not know this transaction id on Esmeralda. The public indexer drops old history, so an old id may be gone." Recorded mode needs no network at all, and the Auditor and the Poltergeist work in it the same way.

## Where the demo transactions went

The first set of demo transactions, sent on 2026-10-18, was lost when the public Esmeralda indexer dropped its 2026-10-14 to 2026-10-18 history (their explorer pages said "not known to this indexer"). We sent the demos again on 2026-10-20, and every transaction link in this file is to that second set. By 2026-10-24 the first indexer no longer holds the second set either (see the dated note at the top): it answers 404, and the explorer's pages for them say "not known to this indexer". The indexer's own API description says a missing body proves nothing: `/transactions/{id}` is "BEST EFFORT" and "a 404 means this indexer has no body for the transaction, not that the transaction does not exist", while receipts are "synced from network state rather than gossip". On 2026-10-26 the first indexer answers 200 at `/transaction-receipts/<id>` for all 18 transactions of the second set (outcome Commit, epoch 12530), for example [demo 1](https://esme-indexer-a.ootle.tari.com/transaction-receipts/891b43606b33d8cdfcc37a44793210ef4a517312c3180772b154d86fc08a2ace), and it still holds 16 of the 30 notes they created, byte for byte as in `ledger.json` (demo 1's 144-byte note: [link](https://esme-indexer-a.ootle.tari.com/substates/utxo_469b4ea86f93dd363e7273940ced6ae30d1dede6668d27ddd56b14768b3a86e7_7a1bcd37de9aa510f527106d67f4d0bf7527c5d1c3aa32623cf93ce0e1d95d10)). We do not know why the bodies were dropped; the indexer holds no transaction dated between 2026-10-14 and 2026-10-23 15:53 UTC, so its store was probably replaced then. On 2026-10-24 Tari's second public indexer still returned all 18 transactions of the second set (it may drop history too; `npm run links` shows whether it still does), and `ledger.json` keeps the indexer's answer for 15 of them (the 3 set-up transactions have no saved answer), so what the page shows about them can be checked against a raw answer. The saved copies equal what the second indexer returns at `https://esme-indexer-b.ootle.tari.com/transactions/<id>`, except one field, `transaction.source` (15 of 15 saved answers on 2026-10-24, compared by `npm run links`).

If Esmeralda has been reset since 2026-10-26, every indexer, receipt and explorer link in this file is gone together (Tari's docs say the testnet may be reset, which invalidates all on-chain state). What stays checkable without a network: `ledger.json` (the indexer's saved answers for the 15 demos and the recorded sample), `npm test` (187 tests, offline), the page's "Use recorded data" mode, and the recording of the live page filmed on 2026-10-25.

## Run it

Needs Node 24 (tested with 24.18; `package.json` also allows 22.18). The scripts import the TypeScript files directly.

```
npm ci
npm run dev                          # http://127.0.0.1:5273
npm test                             # offline, no network
npm run build && npm run preview     # production build at http://127.0.0.1:4273
```

The build uses a relative base path, so `dist/` works from any folder once a web server serves it, for example under `/seance/`; `npm run preview` is that server. Opening `dist/index.html` straight from the disk does not work in Chromium or WebKit (the page stays on "The page's code is still loading"); Firefox opens it.

`npm run smoke`, `npm run links`, `node scripts/make-og.mjs` and `node scripts/shoot-ghosts.mjs` drive headless Chromium, so they need it installed: they look for `/usr/bin/chromium`, and `CHROMIUM=/path/to/chromium` points them elsewhere. `npm run smoke` takes about 3.5 minutes.

The link preview (`og:image`, 1200 x 630) is `public/og.png`. It is drawn headless from the page's own stylesheet and ghosts; redraw it after a change to either with `node scripts/make-og.mjs` (needs Chromium). The meta tags are in `index.html`; the smoke test checks them and that the built site serves the image under `/seance/`. The picture at the top of this file, `docs/seance-ghosts.png`, is the page's first load drawn headless from the production build; redraw it after a change to the page with `npm run build && node scripts/shoot-ghosts.mjs` (needs Chromium).

## What still leaks

Sealed notes hide the amount, the memo and the receiver. They do not hide everything. Under the three cards the page lists, for the transaction on screen, what anyone can still read with no key at all. Each item shows this transaction's real value and one plain sentence. The page names no fix for any of them, because none was tested here.

| Item | What it shows | Why it matters |
|---|---|---|
| Token (resource address) | Which token moved | The token is public even when the amount is sealed |
| Audit proofs | How many sealed notes carry an audit proof | Whoever holds the token's audit key can read those amounts. That key cannot read a memo |
| Spent notes (the spend graph) | The commitments of the old notes this transaction spends | Which notes were spent is public, so a note can be followed from one transaction to the next. What was inside is not |
| New sealed notes | How many notes were made | The count is public. Who holds them, and what they hold, is not |
| Amounts in the open | Any amount that moved in or out of a public balance | Readable by everyone, unlike a sealed note (demo 15 shows one on purpose) |
| Spend rule | The kind of lock on each new note | The kind is public. A Key lock means one private key can spend the note |
| Created and finalized | When it was sent and when the network settled it | Payments sent in quick succession can be tied together by their times |
| Epoch window | The span of epochs the sender allowed | One wallet sending in one sitting tends to leave the same window every time |
| Fee | What was paid, in the open | A wallet that always pays the same fee has a habit anyone can see |
| Locked message size | The byte length of each note's locked message | A note with no memo is 80 bytes. More means a memo is inside, and the size hints at how long it is |

## Threat model

Who can read what, on the demo transactions:

| Who | Holds | Can read | Cannot |
|---|---|---|---|
| Anyone (the Stranger, the Poltergeist) | Nothing | The public fields listed above, and patterns across transactions | Amounts, memos or receivers of sealed notes |
| A recipient (the Medium) | The recipient's view key | The amount and memo of the notes made for that recipient | Spend. Read notes made for anyone else |
| An auditor (the Auditor) | The token's audit key | The amount of every sealed note of that token | Read a memo. Spend: it is a view key and the spend key is a separate secret, but we did not try to spend with it |

- **An audited token gives its auditor every amount.** The audit key is named once, when the token is made, and every note of the token carries a proof that key can open: in our four transfers 8 of 8 notes do. That is the point of the demo token. For a real token it is a decision to make knowingly. We did not test whether the key can be changed afterwards.
- **The demo keys are public on purpose.** They are testnet-only view keys. Each reads the demo payments made for it and nothing else, and none can spend. `scripts/make-demo.mjs`, which made Bob and Carol, writes only their address and view secret to `ledger.json`; their spend keys existed in memory for that one run and the script never writes them anywhere. That is what the script does; nothing in this repository can prove that no other copy exists.
- **Patterns leak even when contents do not.** The Poltergeist below ties all 11 TARI demo payments by timing, fee and spend graph. That is a result about how this demo wallet behaved, not a statement about Tari in general.
- **The page trusts the indexer's answer.** It does not check it against the chain, so an indexer that lied could show you a different transaction. The indexer also sees which transaction id you ask for.
- **Not shown here:** anything about mainnet, and anything about the strength of the cryptography. The page uses the official SDK and was not audited.

## The Poltergeist

A ghost with no keys and only patience. It reads what a stranger reads and asks the question of a chain analyst: were these payments all sent by the same wallet? The answer is known (all 11 TARI demo payments come from one wallet of ours), so each trick can be scored.

**Method.** The code is `src/poltergeist.ts`, pure and deterministic. It is handed no key (a test checks that no demo view secret appears anywhere in the data it reads). For each transaction it reads the keys named in the open, any amount paid out in the open, the created time, the epoch window, the fee and the notes spent and made. The tricks:

- **Address reuse** ties two payments that show the same key as sender or receiver.
- **Amount matching** is handed what each payment was for, like an invoice, and looks for that exact amount on the ledger.
- **Timing** ties payments sent within 60 seconds of each other in the same epoch window.
- **Fee fingerprint** ties payments that paid exactly the same fee.
- **Spend graph** (an extra) ties a payment to the one whose note it spends. A transparent account ledger has no notes, so it is "not applicable" there.

**Metric.** Each count is out of the 11 demo payments. *Tied* is how many of our payments the trick put in a group with another of ours (groups grow by chaining: if A is tied to B and B to C, all three are one group). Amount matching is scored as *found*: a payment counts when exactly one row on the ledger shows its amount. *Mixed up* is how many of our payments ended in a group that also holds a transaction that is not ours. It is 0 for every trick on Tari. The synthetic ledger holds only our payments, so nothing can be mixed up there.

**Two ledgers.** Tari is recorded and real: the 11 payments, read together with the 1 recorded transaction that is not ours, taken from a sample of the network's latest transactions (captured 2026-10-20 at 20:44 UTC), so there is something to be mixed up with. A crowd of one is thin: private transfers by other people were sparse on the testnet that evening, the sample was taken once and not repeated to look for more, and the 2026-10-18 sample had 9. The **synthetic transparent ledger** is not a real chain. The page builds it from the same 11 payments, written the way an account ledger writes them: one sender, the receiver and the amount in the open. Its times, epoch windows and fees are the real ones. It holds only these payments. It is a model of what a transparent ledger shows, not a measurement of any real chain, and the page says it is synthetic at the top of the section and again beside every number.

| Trick | Synthetic transparent ledger | Tari (recorded, real) |
|---|---|---|
| Address reuse | 11 of 11 tied | 0 of 11 |
| Amount matching | 11 of 11 found | 1 of 11 (demo 15, which reveals its amount on purpose) |
| Timing | 11 of 11 tied | 11 of 11 tied |
| Fee fingerprint | 11 of 11 tied | 11 of 11 tied |
| Spend graph (extra) | not applicable | 11 of 11 tied |

What that says. On Tari no key repeats and 10 of the 11 amounts are sealed, so address reuse and amount matching find almost nothing. Timing, the fee fingerprint and the spend graph still tie all 11, with the 1 other transaction not mixed in (a weak test, with a crowd of one). The reasons are plain: one wallet sent all 11 within 135 seconds (no two further apart than 27 seconds), in one epoch window, each paying exactly 0.1 tTARI, and each after the first spent a note the one before it made. A wallet that behaved differently would likely fare differently. We did not test that, and these numbers do not say how a busy wallet would fare.

**The one number that could be tuned** is the timing gap of 60 seconds. It was fixed before the results were computed. Any gap from 30 seconds to an hour gives the same result, because the one other transaction is in the previous epoch window and 29 minutes away. On the 2026-10-18 sample, with its 9 other transactions, 120 or 300 seconds reached the nearest of them (120 to 121 seconds away) and mixed all 11 payments up; this thin crowd cannot show that. The tests pin what the current data show (`test/poltergeist.test.ts`).

**Scope.** The Poltergeist covers the 11 TARI demo payments (demos 5 to 15). The four SEANCE transfers are not part of it. It runs on recorded data only, so every visit shows the same numbers, and it asks nobody.

## The Auditor

**Outcome: on chain.** The third ghost reads real transactions of a token made with an audit key on Esmeralda, not a proof built in the page. Evidence: the four transfers below, `ledger.json` (the indexer's recorded answers and what each key must read) and `test/auditor.test.ts`.

**Why a token of our own.** An audit proof exists only on the notes of a token made with an audit (view) key, and the ordinary TARI token has none. So the demo makes one. Its template is `template/`, a 34-line Rust file written for this contest (MIT), using `ResourceBuilder::stealth().with_view_key(..)` from `tari_template_lib`. **Which template we used:** our own, `template/`. We called no template published by anyone else and copied no code from one. The only dependency is `tari_template_lib` 0.34.0 (BSD-3-Clause), and none of the 34 crates in its dependency tree is under the GPL or AGPL (`evidence/template-licences.txt`). The demo token is a toy on a test network: anyone may mint it.

Before it was published, the `.wasm` was built with a path prefix remap and searched for the home folder path, the account name, a private word list and the throwaway wallet's secrets (3 secret values, 22 seed-phrase runs, key and token shapes): 0 matches each, with a planted-copy control that the same counters do catch (`evidence/template-wasm-scan.txt`). To rebuild (needs the `wasm32-unknown-unknown` target): `cd template && RUSTFLAGS="--remap-path-prefix=$HOME=/build" cargo build --release --target wasm32-unknown-unknown`. We did not check that a rebuild is byte-for-byte the published one.

**What was sent** (all on Esmeralda, from one throwaway account, and **re-made on 2026-10-20**: 7 transactions, all committed; fees add up to 0.505717 tTARI). The first set, of 2026-10-18, also had two steps that were not repeated:

- **Step 1** (making the throwaway account public with 220 tTARI of public balance) was not repeated: the account is already public on chain, so there was nothing to make.
- **Step 2** (publishing `template/`, 0.976133 tTARI) was not repeated, and its link is dropped with the rest of the lost history. The template is still on chain at `template_e2094ebe40267236cc14b144cfe56426322065effd7de255f532bbb6622d299a`: its address is the hash of the binary, so it cannot be published twice (a second publish on 2026-10-20 was rejected with "already exists" and charged no fee), and step 3 below makes the token from that very template, which could not work if it were not there.

The token below is a new one (the 2026-10-18 token was left as it is and is not used), made with the same audit key.

| Step | Transaction | What it did | Fee |
|---|---|---|---|
| Step 3 | [`52396cf13c…468193`](https://esme-indexer-b.ootle.tari.com/transactions/52396cf13c732ba72e6b248462d980dc392795c7e0c115b1cb0203248e468193) | Made the token (a stealth resource with the auditor view key) and its component. | 0.002408 tTARI |
| Step 4 | [`6602b7b2a5…ddf9f8`](https://esme-indexer-b.ootle.tari.com/transactions/6602b7b2a5d84e5ca2ac4cfb38699efe1ae73d183eec943794fd484d47ddf9f8) | Minted 1,000,000 base units of the token as a public balance of the throwaway account. | 0.003309 tTARI |
| Step 5 | [`3b12856d3f…140f33`](https://esme-indexer-b.ootle.tari.com/transactions/3b12856d3f83792977244e795fb53a49d6a26ce09591a92aab42defe4f140f33) | Turned 50000 base units of the public balance into one sealed note of the throwaway account. Each of demos 1 to 4 is paid from that note, so none of them shows an amount in the open. | 0.1 tTARI |

**The shield step, and the flawed first tries.** The first four SEANCE transfers we sent on 2026-10-18 took their amount from the account's public balance. A transfer paid from a public balance writes its amount in the open ("revealed amount"), so the sealed note hid nothing and the Auditor would have had nothing to show. We found it by reading our own transactions. The fix is the shield step: all 50,000 base units were first moved into one sealed note, and each of demos 1 to 4 spends the note the one before it left (the first spends the sealed 50,000). Those four flawed tests were lost with the rest of the 2026-10-18 history and were not re-made, so they are no longer linked. The same mistake happened once more in the re-make: the first 11 TARI demos of 2026-10-20 were paid from the account's public balance (it has one since step 1), so each wrote its amount in the open. They were sent again from sealed notes. Those 11 first tries are still on chain; they are not demos, they are not linked, and `ledger.json` lists them under `earlier`.

**The four demo payments** (demos 1 to 4). Each spends one sealed note and makes two (the payment and the change), pays 0.1 tTARI of fee from the public TARI balance, and shows no amount in the open. Each spends the change of the one before. Memos are readable by the recipient only.

| Demo | Transaction (raw indexer answer) | Recipient | Amount | Memo | The Auditor counts (payment + change) |
|---|---|---|---|---|---|
| 1 | [`891b43606b…8a2ace`](https://esme-indexer-b.ootle.tari.com/transactions/891b43606b33d8cdfcc37a44793210ef4a517312c3180772b154d86fc08a2ace) | Bob | 0.00031415 SEANCE | "Midnight at the old crypt. Come alone." | 0.00031415 + 0.00018585 SEANCE |
| 2 | [`1666311102…48ff8c`](https://esme-indexer-b.ootle.tari.com/transactions/1666311102df4c809a4092de5064d40114ff4616218df8ac74a7662b2c48ff8c) | Carol | 0.00007 SEANCE | "I never told the auditor about the cat." | 0.00007 + 0.00011585 SEANCE |
| 3 | [`0c3cc69e2a…8a5adb`](https://esme-indexer-b.ootle.tari.com/transactions/0c3cc69e2a59bcd331ac4759c5187ed3c212d5f9a424cc1eeaa7293be68a5adb) | Bob | 0.00004096 SEANCE | "The books are clean. The house is not." | 0.00004096 + 0.00007489 SEANCE |
| 4 | [`8206f7cc9c…6776aa`](https://esme-indexer-b.ootle.tari.com/transactions/8206f7cc9cde4a7ede73ee9c27e7198744df0d97a13abc4cb451f85fd26776aa) | Carol | 0.0000025 SEANCE | "Salt for the doorstep." | 0.0000025 + 0.00007239 SEANCE |

**In the page.** The Auditor card has its own choice of key: Bob's, Carol's, Eve's or the audit key. With the audit key it counts the amount of each sealed note and shows "Memo: shut. The audit key cannot open it." With any other key it hears nothing: "The spirits are quiet." On a transaction whose token has no audit key it says there is nothing to count. **Hold the seance** on a demo of the first group hands the Medium the recipient's key and the Auditor the audit key. Under the key choice, a closed section, "How this token was made: 34 lines of Rust", shows `template/src/lib.rs` itself (the page imports the file, so the text cannot drift from it) with a link to the file on GitHub and one to the token on the explorer, whose page lists the token's View key: the audit key's public half (`d0f610b1e6…d19fd532`). The indexers say the same: the token's record at `https://esme-indexer-b.ootle.tari.com/resources/resource_469b4ea86f93dd363e7273940ced6ae30d1dede6668d27ddd56b14768b3a86e7` has `"view_key"` equal to the audit key (`npm run links` checks that on both public indexers).

**How it counts.** An audit proof is the amount, encrypted to the audit key, with a proof that it fits the note's commitment. Opening it has no shortcut: the WebAssembly in the page tries every amount from 0 to 50,000 base units (0.0005 SEANCE) against the proof, a few microseconds each. A larger amount is reported as past the range. The search is cut into slices of about 25 ms and the page is handed back between them, so it never freezes. It needs no Worker, so the Content Security Policy is unchanged. A progress bar shows how far it has got (also for screen readers), and with `prefers-reduced-motion` the fade-ins, the flame and every transition are switched off (the bar still fills, in steps). Measured with headless Chromium on the maintainer's machine: about two seconds for demo 1 with no long task (50 ms or more) reported; with the CPU slowed 4 times, about 8 seconds, again with no long task, so the page keeps answering in between (`evidence/smoke.txt`).

What the Auditor does not claim: it does not read memos, it does not spend, it counts only the demo token's notes, and it searches only the range above.

## Checks

| Command | What it checks |
|---|---|
| `npm test` | 187 tests in 10 files, offline: every demo against every key, the Auditor's counts, the Poltergeist's pinned numbers, the fallback rules, how `npm run stranger` pages back and ends, and the README's links, numbers and demo keys against `ledger.json` |
| `npm run stranger` | Live. Fetches 3 recent transactions by id from the indexer, parses them with the page's own code and checks the real bytes. **Depends on what the testnet holds today:** it pages back through the latest 300 transactions (3 requests of 100) until it has 3 private transfers. On a quiet chain it checks the ones it found and says "quiet chain: N of 3" (exit 0; none found: SKIP, exit 0), and it writes `evidence/stranger-recent.txt` only on a full pass. (It used to look at the latest 40 only, and on 2026-10-24 that failed because there were fewer than 3.) `node scripts/stranger.mjs <id> ...` checks the ids you name |
| `npm run smoke` | Run `npm run build` first. Headless Chromium over the production build served under `/seance/`, at 1280 and 375 px wide, live and in recorded mode: the first screen, the 10 s and 60 s steps, all 15 demos through the page, the proof links, the Poltergeist, the Auditor, key privacy, 0 console errors, axe, overflow, contrast, the CSP, the link-preview tags, and a mocked indexer that answers 404 for every demo but one. Writes `evidence/smoke.txt` and the screenshots |
| `npm run links` | About 50 plain requests, one at a time. For each of the 18 transactions this file links to, the second public indexer must return it with outcome Commit, equal to `ledger.json` where that holds an answer (`transaction.source` aside); the first indexer's answer (200 or 404) is reported, not judged. Also the demo token's records on both indexers, the explorer's page for the token, the repository links the page uses, and a made-up id as the negative control. **Depends on what the testnet holds today:** it fails if the second indexer drops the history too. Writes `evidence/links.txt` |
| `npm run scan` | History, tree and `dist/` read as text, and the SDK's wasm decoded from the bundle (it sits inside as base64; the scan fails if it finds none). The template's wasm has its own scan, `evidence/template-wasm-scan.txt`. Looks for throwaway secrets, key and token shapes, a private word list (counts only), home paths |
| `npm run licenses` | Licence of every installed dependency; fails on GPL or AGPL |

Every row in full: [docs/checks.md](docs/checks.md).

Last results are in `evidence/`. From 2026-10-24: `links.txt`, `smoke.txt`, and the screenshots `seance-<width>-<live|recorded>-*.png` at 1280 and 375 px (the first screen, the three ghosts, the template card, a demo the indexer dropped, the leaks panel, the Poltergeist, the Auditor counting). From 2026-10-20: `stranger-recent.txt` (it passed then). It needs 3 recent private transactions on the testnet, and they come and go: two runs on 2026-10-24 found none, then 2 (among the latest 40, which is all it looked at then), so it failed and was not saved again. It now pages back through the latest 300, and a run that finds fewer than 3 or fails does not overwrite the saved one. From 2026-10-18, not re-run: `template-wasm-scan.txt` and `template-licences.txt` (the template did not change).

Maintainer scripts that need a local Tari wallet daemon and cannot run from a clean clone: `npm run demo` (sent the 11 TARI payments from sealed notes only, then recorded the indexer's answers in `ledger.json`) and `node scripts/make-hero.mjs` (published the template, made and minted the token, shielded, sent the four SEANCE transfers and recorded them). The 2026-10-20 re-make used the Ootle wallet daemon 0.47.0: version 0.46.1 could no longer read the account after the upgrade.

## The demo transactions

Fifteen real Esmeralda transactions, sent from a throwaway testnet account. The page numbers them as demos 1 to 15. `ledger.json` holds the indexer's answer for each one and the amount and memo each key must read. It is the recorded data the page uses and the oracle the tests check against. Demos 1 to 4 are the SEANCE payments above. Demos 5 to 15 pay in TARI. Demo 11 has no memo. Demo 15 reveals its amount on purpose, so no key reads anything sealed in it.

| Demo | Transaction (raw indexer answer) | Amount | Recipient | Value | Memo |
|---|---|---|---|---|---|
| 5 | [`e99ccae247…0ae15b`](https://esme-indexer-b.ootle.tari.com/transactions/e99ccae24789ef34dbba783c9675f90f89757043a5f456b6d521df6df60ae15b) | sealed | Bob | 0.666 tTARI | "The candle went out. Did you do that?" |
| 6 | [`e04e6e7802…074a7f`](https://esme-indexer-b.ootle.tari.com/transactions/e04e6e78021a71bdfa6902674a5401fb64efb54ce948c5c4e5fc287cf6074a7f) | sealed | Carol | 1.31 tTARI | "Meet at the old well. Midnight." |
| 7 | [`80a13d44a4…dc0125`](https://esme-indexer-b.ootle.tari.com/transactions/80a13d44a497870e01bdf42af626633c792f3df1f6fb802da884f37991dc0125) | sealed | Bob | 0.031 tTARI | "Trick or treat" |
| 8 | [`f302e0ba4d…3f85c3`](https://esme-indexer-b.ootle.tari.com/transactions/f302e0ba4dabc96c694934b4c11b857fd3d09de61c62428d991ffff78d3f85c3) | sealed | Carol | 0.5 tTARI | "Boo!" |
| 9 | [`1bee7f75e8…cbc009`](https://esme-indexer-b.ootle.tari.com/transactions/1bee7f75e876d109cbe3bb9317a416b96cd9da8386fa082530c0682301cbc009) | sealed | Bob | 2 tTARI | "Seven candles, one wish." |
| 10 | [`a920bd7d69…9a10c0`](https://esme-indexer-b.ootle.tari.com/transactions/a920bd7d69cbbf53f27c149b2fef7336c25e1db16c666d4c65176343be9a10c0) | sealed | Carol | 0.013 tTARI | "Mind the third stair." |
| 11 | [`4fd2cbd216…512939`](https://esme-indexer-b.ootle.tari.com/transactions/4fd2cbd216c2c3a3d556b55a2235197f895ad88cc0ac8230aa47146262512939) | sealed | Bob | 0.1 tTARI | none |
| 12 | [`05d7f7a531…5efd55`](https://esme-indexer-b.ootle.tari.com/transactions/05d7f7a53117fed5dbe0fcd262b2c72af5b2251b4a10d78bdfcb97cbbf5efd55) | sealed | Carol | 0.99 tTARI | "Pumpkin pie fund." |
| 13 | [`90b2373bd0…2a4fe2`](https://esme-indexer-b.ootle.tari.com/transactions/90b2373bd044ec96ce42ebf8f0d3e6f1e040bdda5931211a259f37e8ee2a4fe2) | sealed | Bob | 0.404 tTARI | "Page not found. Neither is the ghost." |
| 14 | [`99e275ac21…0dc59c`](https://esme-indexer-b.ootle.tari.com/transactions/99e275ac213ac64549e03ce53ea1e49f3f05b500ea7e73d16b7667b6450dc59c) | sealed | Carol | 0.7 tTARI | "Garlic, salt, and a very long walk home." |
| 15 | [`571724b644…0f9ba8`](https://esme-indexer-b.ootle.tari.com/transactions/571724b644ed8c4b9efee6a528fa867a388fc68e87066c92809f2b8ae10f9ba8) | amount revealed | Bob | 0.25 tTARI | none |

## The demo keys

These are the view secrets of the demo identities and of the demo token's audit key. They are published on purpose, for testnet only. Bob's and Carol's read the demo payments made to them (in TARI and in SEANCE) and nothing else. Eve's reads nothing at all. The audit key counts the amounts of the SEANCE demo payments and nothing else. A view key cannot spend. **Never reuse these keys for anything real.**

| Who | View secret |
|---|---|
| Bob (the recipient) | `cd094efe16ad55a188f3f8551dd21a71a2ad0ada03e0760f4fd312ce534c1203` |
| Carol (another recipient) | `68f76ca93c0ffa48eacca00f04b4f8948b6f4661894cb7c74f0d309af1bc4308` |
| Eve (a stranger: a key that fits nothing here) | `b2c2d4cb4841c1ab2d57d712bd28d1cb84aedad00fc14e55e144d55831cea709` |
| The auditor (holds the demo token's audit key) | `713ead2c3c9ee52431b4826898b70874751b27a6780c8428d5f3e4688a89fe06` |

## What the page asks the network

- `GET /transactions/<id>` on the indexer, for the id you give. `GET /transactions/recent?limit=40` when you press Summon. It never scans the chain.
- Nothing else. The leaks panel, the Auditor and the Poltergeist compute in the page from a transaction it already holds (the Poltergeist from the recorded set). The built page carries a Content Security Policy in a meta tag; `connect-src` allows only the indexer host, and the smoke test shows the browser blocking a fetch to anywhere else, `eval` and injected scripts.
- No external fonts, CDNs, analytics or trackers. No cookies, local storage or session storage.
- The links beside a result (the explorer, the raw answer from the second public indexer, `ledger.json`, the first indexer's receipt) and the docs links open in a new tab. The page does not call them: only a click on them leaves this page.
- The address can carry `#tx=<id>`, which is public. A key you paste is never in it.

Design decisions are in [design.md](design.md).

## Reused code

The contest asks for new code. Everything here was written for this contest after 2026-10-01. Two files come from our own experiment of 2026-10-16 to 2026-10-18, the spike that checked the SDK before this build (not published):

- `scripts/wd.mjs`: the walletd JSON-RPC helper, copied unchanged from the spike apart from a header comment. Only the maintainer scripts `scripts/make-demo.mjs` and `scripts/make-hero.mjs` use it.
- `scripts/make-demo.mjs`: written for this repo; its way of building and polling a stealth transfer through walletd follows the spike's `gate-c.mjs` (a few lines are the same). `scripts/make-hero.mjs` is new and follows the same pattern.

`template/` is new code written for this contest, from the public `tari_template_lib` API. No code was copied from tari-project example repositories, from other published templates or from other contest entries. The Tari packages below are used as dependencies, not copied.

## Built with

`@tari-project/ootle`, `@tari-project/ootle-indexer`, `@tari-project/ootle-wasm` (the official SDK: indexer client, the view-key decryption and the audit-proof check, in WebAssembly; the build embeds its wasm unchanged except that the 56 build-machine home folders rustc left in its panic messages are blanked at the same length, `scripts/wasm-paths.ts`, and a test checks that nothing else differs), Vite, TypeScript, vitest, puppeteer-core and axe-core for the checks. The demo token's template is Rust on `tari_template_lib`, compiled to WebAssembly and published on Esmeralda; the page does not need it to run. Third-party licence notices ship in `dist/THIRD-PARTY-LICENSES.md`.

This is not a wallet or an explorer. The parsing of transactions, the ghosts, the recorded mode and the page are new.

Developed with an AI coding agent (Claude Code).

## Licence

MIT. See [LICENSE](LICENSE).
