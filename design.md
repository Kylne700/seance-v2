# Design decisions

Why the page looks and behaves the way it does, so a reviewer can disagree with a reason rather than a guess.

## The story

A private payment on Tari is a letter sealed in plain sight. Everyone can pass the envelope around, and only one key opens it. The page makes that literal with three ghosts looking at the same real transaction, and a fourth who never opens the envelope at all:

- The **Stranger** has no key. It shows what an indexer shows anyone.
- The **Medium** holds a recipient's view key and listens inside the page. It hears the amount and the memo of the notes made for that recipient.
- The **Auditor** holds the audit key of a token. That key reads the amount of every note of the token and nothing else: not the memo, and a view key does not spend.
- The **Poltergeist** holds no key. It asks a different question: not what is inside, but whether the payments can be tied together by what is public.

Under the three cards sits the **What still leaks** panel: what the Stranger reads from this transaction, field by field, so "private" is never taken on trust.

The theme asks for the best demonstration of Tari's privacy. A demonstration beats a claim: the page never says "this is private", it lets you hold the sealed bytes, try keys on them, and then shows what stays public. Where the honest answer is "this still leaks", it says that too.

## Show the real bytes, then say what they are

Every field of a sealed note is the real value from the chain, in monospace, with one plain sentence under it: the commitment ("a sealed number that locks the amount"), the one-time key, the locked message with its byte length, the spend rule, and for a token with an audit key the audit proof. The length is shown on purpose: a note without a memo is 80 bytes and one with a memo is longer, which is a small leak anyone can see. The fee paid out in the open is labelled as such. Nothing on the Stranger card is a mock-up. The same code renders a live answer and a recorded one, and the smoke test checks that the Stranger card never contains the amount or the memo.

## What still leaks

Ten items, each read from the parsed transaction with no lookup and no guess (`src/leaks.ts`): the token, audit proofs, the spent notes, the new notes, amounts in the open, the spend rule, the times, the epoch window, the fee and the size of the locked message. Each shows this transaction's real values and one sentence of caption. Two decisions:

- **No fix is named.** None was tested here, so the panel says what is visible and why it matters, and stops. A suggestion nobody measured would be a claim.
- **The panel is built from the same fields the Poltergeist reads.** The spent notes become its spend graph trick, the times and the epoch window its timing trick, the fee its fingerprint. The panel says what a stranger can see in one transaction; the Poltergeist shows what that is worth across eleven.

## The Auditor

An audit proof exists only on the notes of a token made with an audit (view) key. The ordinary TARI token has none, so the third ghost needs a token of our own. Esmeralda got a small template (`template/`, 34 lines of Rust, MIT, written for this contest from the public `tari_template_lib` API), one publish, a token called SEANCE, a mint, and four transfers to Bob and Carol. The demo token is a toy: anyone may mint it. Everything the Auditor shows is read from those four real transactions; nothing is built in the page.

- **The shield step.** The first four transfers we sent took their amount from the account's public balance, and a transfer paid from a public balance writes its amount in the open. The sealed note then hid nothing, and the Auditor would have had nothing to count. We found it by reading our own transactions. The fix: first move 50,000 base units into one sealed note, then spend only sealed notes (each demo spends the change of the one before). The four flawed transactions of 2026-10-18 were lost with the indexer history and were not re-made. The same mistake was made again on 2026-10-20 with the TARI demos (the account then held a public balance and the wallet paid from it); those 11 first tries are on chain, listed in `ledger.json` under `earlier`, and are not demos.
- **An audited token gives its auditor every amount.** The README's threat model says so, and so does the leaks panel (its "Audit proofs" item). That is the trade of the feature, not a bug, and it is why the audit key is named once, at the token's creation.
- **Two keys, two questions.** The Medium and the Auditor each have their own choice of key. "Hold the seance" gives the Medium the recipient's key and the Auditor the audit key. Handing Bob's key to the Auditor, or the audit key to the Medium, gives the same calm silence, which shows the two keys are not interchangeable.
- **A wrong audit key is silence, as a wrong view key is.** The wasm checks the proof against the key first and throws for a wrong one; the page turns that into "The spirits are quiet." and says no more, so a wrong key learns nothing about the amounts. A transaction with no audit proof at all is a different case: the card says there is nothing to count.
- **The range.** An audit proof opens only by trying amounts, so the page tries 0 up to 50,000 base units (0.0005 SEANCE, 8 decimals) and says so when an amount lies beyond. Every demo amount is in range, and a test pins that. It is about 2 s for the 50,000 candidates of demo 1 in headless Chromium.
- **The template on the page.** The Auditor card has a closed section with the 34 lines of `template/src/lib.rs`, imported as raw text so it cannot drift from the file, because the audit key is named in one line of it (`.with_view_key(auditor)`) and that is what lets the Auditor count. It links to the file on GitHub and to the token on the explorer, whose page lists the token's View key (the audit key's public half). A test checks that the quoted line is in the file and that the links name the ledger's token.
- **Never freeze the page.** The search runs on the main thread in slices of about 25 ms (it starts with 128 candidates and adapts between 64 and 1024) and hands the page back between slices. It also hands it back once before the first slice, so the work never shares a task with the card the click has just drawn: the smoke test found one 130 ms task at a CPU slowed 4 times, and this fixed it. A newer request stops an older search at its next slice (a sequence number), so a key changed in the middle of a count cannot leave a stale answer behind. There is no Worker: it would probably need its own copy of the 1.9 MB bundle and a `worker-src` rule, and was not tried because the slices already stay under the limit (see Testing).
- **Progress that does not shout.** A `<progress>` bar with a label, and a count line that screen readers skip (it would announce hundreds of updates). The "Counting" card is drawn once, and only if the search takes a moment. With `prefers-reduced-motion` the bar still fills, in steps, and nothing fades.

## The Poltergeist

Contents can be sealed while behaviour is not. The Poltergeist reads only what a stranger reads and asks one question of the 11 TARI demo payments: were they all sent by the same wallet? The answer is known (they were), so each trick can be scored.

- **Four tricks and an extra.** Address reuse, amount matching, timing and the fee fingerprint, plus the spend graph, which a transparent account ledger does not have and Tari still allows. Each rule is one line in `src/poltergeist.ts`, pure and deterministic, shared by the page and the tests. The attacker is handed no key, and a test checks that no demo view secret appears in the data it reads.
- **The metric.** *Tied* is how many of our payments the trick put in a group with another of ours (groups grow by chaining). *Mixed up* is how many ended up in a group that also holds a transaction that is not ours. Amount matching is different in kind: it is handed each amount, like an invoice, and counts a payment as found when exactly one row shows that amount.
- **Two ledgers.** Tari is the real recorded transactions, mixed with the recorded transactions that are not ours so there is something to be mixed up with (only 1 since the re-make of 2026-10-20: private transfers were sparse on the testnet in the sample, and the sample is not re-taken to look for more). The transparent ledger is **synthetic**: the same payments written the way an account ledger writes them (one sender, the receiver and the amount in the open), with the real times, epoch windows and fees. It is a model, not a measurement of any real chain, and the page says it is synthetic at the top of the section and again beside every number. It holds only our payments, so "mixed up" is 0 there by construction.
- **The result is mixed on purpose.** Address reuse finds none and amount matching finds one (demo 15, which reveals its amount on purpose). Timing, the fee fingerprint and the spend graph still tie all 11. That is how this wallet behaved (11 payments in 135 seconds, one epoch window, one fee, each spending the note before it made), not a statement about Tari. A page that only showed Tari winning would not be believed.
- **The one tunable number was fixed before the results.** The timing gap is 60 seconds. Every gap from 30 seconds to an hour gives the same result now, because the one other recorded transaction is in the previous epoch window and 29 minutes away. On the first set (2026-10-18, 9 other transactions) a gap of 120 or 300 seconds reached the nearest stranger and mixed all 11 up. The tests pin what the current data show, so the README can name the sensitivity.
- **Sentences from numbers.** The words under each trick are built from the report's numbers, so the page cannot say more than its table does. The tests pin the facts each sentence leans on, from the raw replies.
- **Scope.** The 11 TARI demo payments only. The four SEANCE transfers are not part of it, it runs on recorded data so every visit shows the same numbers, and it asks nobody.

## Silence is the answer to a wrong key

A key that fits nothing gets one calm line, "The spirits are quiet.", with no error colour and no "invalid key". Decryption cannot tell a wrong key from a note meant for someone else, so the page does not pretend to. A pasted string that is not 64 hexadecimal characters is different: that is a typing error, not a guess at a real key, so it gets a hint.

## Layout

- One page, one column on phones. From 960 px wide the three cards sit side by side and the picker is two columns (an id and Summon on the left, the prepared demos on the right).
- At 1280x800 the hero and picker fill the first screen and the cards begin at its foot, so after a call the page scrolls the Stranger card to the top if it is more than half-way down the screen. In one column it always does. On an error it scrolls the message into view. The smoke test caught the first version hiding its own result below the fold.
- No card is sticky. An earlier version pinned the Medium card, but once the Auditor card and the audit-proof blocks made the cards taller than a 1280x800 screen, the pinned card was cut off at the bottom and could not be scrolled to. Measured at 1280x800: the cards are 2425, 965 and 991 px tall.
- Sealed notes are `<details>`: open by default only from 960 px wide. On a 375x800 phone the Stranger card is 1393 px tall with the notes shut and 4218 px with every note and ciphertext open (measured 2026-10-24 on the first screen's example, demo 1, with its proof links).
- The leaks panel and the Poltergeist sit below the cards. Each trick is a block of its own, not a wide table, so nothing scrolls sideways on a phone.
- 44 px tap targets, no horizontal scroll, long hex wraps inside its box. Text fields scroll their own content, so a 64-character id in a narrow field is not treated as clipped.

## Mood

Dark and calm, not loud. Near-black violet ground with a faint glow at the top, amber for the candle (primary buttons, amounts, the flame), pale violet for labels, mint for "live" and rose for errors. Headings use the system serif stack, body text the system sans, bytes the system monospace. No web fonts, no images except three small inline SVG ghosts. Nothing is fetched to draw the page.

Colour is checked by numbers, not by eye. Every text and background pair in the palette reaches 4.5:1 (the lowest is 6.5:1). Text on the bare page sits over a radial gradient that axe cannot judge ("needs review"), so it is bounded by the gradient's lightest colour instead. The borders of fields, selects, outline buttons and key choices use a lighter violet (`--control`) that reaches 3:1 on every surface. The focus ring is a 3 px light amber outline offset by 3 px on every interactive element.

## Motion

The ghost's flame flickers and a reading fades in over 0.9 s, blurred to sharp, like a voice coming through. With `prefers-reduced-motion` all animation and transition is off (one rule for the whole page) and scrolling is instant. The smoke test runs the page once with it on and checks the flame and the readings stand still.

## Keyboard and screen readers

A skip link, real labels on every field, native `<details>`, `<select>` and radio buttons (arrow keys move between keys). Polite live regions report results and errors (the status line), the Medium's reading, the Auditor's reading and the hint on the key field. While a call runs the Stranger body says `aria-busy` and the buttons are `aria-disabled`, not `disabled`, so keyboard focus never falls off the button that was pressed. Before the page's code has loaded, the four buttons ship `aria-disabled` (dimmed, a progress cursor) and the status line says the code is still loading; the code clears both when it is ready. "Look at it" also ships `disabled`: it is a submit button, and a click or Enter on it before the code has run made the browser cancel the code that was still on its way (the form is blocked by the page's policy, but the load was not resumed), which left the page dead until a reload. The smoke test holds the scripts back to check this. The recorded-data switch is a toggle button with `aria-pressed`; its label does not change. External links say they open in a new tab. The smoke test tabs through the whole page at both widths and checks every stop is visible, outlined and in the expected order.

## Where answers come from

The page asks the indexer for one transaction by id, or for the 40 latest when you press Summon. It never scans the chain. The recorded set (`ledger.json`) is imported as a module, so it needs no request. The leaks panel, the Auditor and the Poltergeist compute in the page from a transaction it already holds, and ask nothing.

- Network error, no answer in 8 s (the SDK has no timeout of its own, so the page races it against a timer), a 5xx or a 429: the page switches to recorded data for good, says so, labels every answer "Recorded", and the switch back to live is one click.
- A 404 for an id that is not one of ours is "the indexer does not know this id", not a fallback; the message adds that the public indexer drops old history. A 404 for an id we hold a recording of means the indexer no longer holds it (its history was dropped: 2026-10-14 to 2026-10-18 once, and by 2026-10-24 our 2026-10-20 demos). Only that one answer is the recording. Its card says so, with the date the copy was saved, and the page stays live: the badge is not flipped, because the indexer is up and the next id you paste deserves a live answer. The status line is calm (an info line, not a warning). The page does not remember the 404: every demo click asks the live indexer first (one 404 per click), so a demo the indexer holds again is read live again. Tests pin all three.
- The page opens on demo 1 from the recording, with no request, labelled as the page's starting example (the status line says nothing has been asked of the indexer yet). Before, the first screen held three empty cards, and a judge who did not click saw nothing happen. The address bar and the id box stay untouched, so a shared link and a pasted id are never confused with the example. A `#tx=` link goes to the live indexer as before.
- Proof links. A live answer links to the same id in the explorer. A saved copy cannot: the explorer reads the same indexer as the page, which no longer holds the id. So it links to the raw answer from Tari's second public indexer, to `ledger.json` on GitHub and, last, to the receipt the first indexer keeps for that id (receipts are synced from the network's state, so one can outlive the dropped body). The page never calls any of them: they are plain links, so the Content Security Policy (`connect-src`: one indexer) is unchanged. The second indexer is a stale mirror and may drop history too; the README says so, and `npm run links` compares its answers with the recording.
- A recorded-mode lookup of an id we do not hold says so and points at live mode.
- A quiet live chain (no private transfer among the latest 40) gives a recorded sample, labelled, and the page stays live. Summon prefers a settled transaction to a rejected one, and a transaction by someone else to one of ours. When only ours are there it says so.
- A pasted id is trimmed and lower-cased. A malformed one is refused before any request.
- The page trusts the indexer's reply: it does not check it against the chain. An indexer that lied could show a different transaction. This is named in the README.

## Privacy of the key

A key you paste is read from the field, used for a local decryption call, and forgotten on reload. It is never stored, never in the address or the history, never sent. Defences, none of which is the main one:

- the CSP: `connect-src` allows only the indexer host, `form-action 'none'`, `default-src 'none'`;
- the field is `type=text` on purpose (a view key cannot spend, and seeing what you pasted catches mistakes) with spell-check, auto-complete, auto-correct and password-manager hooks off, so a browser service has nothing to send;
- the smoke test pastes keys and then looks for them in every request (address, headers, body), the address, storage, cookies, history state and the page text.

The demo keys are the opposite case: Bob's, Carol's, Eve's and the audit key are published on purpose in the README and the bundle. They are testnet view keys; each reads only the demo payments made for it, and none can spend. `scripts/make-demo.mjs` writes only the recipients' address and view secret; their spend keys lived in memory for that one run.

## Content Security Policy and the wasm

`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; connect-src https://esme-indexer-a.ootle.tari.com; base-uri 'none'; form-action 'none'`, set in a meta tag in the production build (the dev server's reload socket would be blocked by it). There are no inline scripts or styles, so `unsafe-inline` is not needed. `wasm-unsafe-eval` is the narrowest source that lets the browser compile WebAssembly; plain `unsafe-eval` stays off and the smoke test checks that `eval` is refused. The Auditor needed no change to this policy.

The decryptor ships as WebAssembly. The usual bundler route fetches the `.wasm` file at run time, which would force `'self'` into `connect-src`. A small Vite plugin embeds the bytes in the JavaScript instead. It changes one thing in them: the SDK's wasm carries 56 build-machine home folders in its panic messages, and the plugin blanks each at the same length (`scripts/wasm-paths.ts`), so no offset moves. The cost is one chunk of 1.93 MB (734 kB gzipped), nearly all of it the decryptor. The indexer client needs it too (`@tari-project/ootle-indexer` imports `@tari-project/ootle`, which imports the wasm), so splitting it would make the buttons work sooner but would not bring the first answer sooner, and it was left as it is. Measured on a throttled Fast 3G profile (Chromium, a local server that gzips, median of 3): the text and the picker paint at 1.3 s, the buttons work at 5.2 s and the first live answer shows at 6.2 s. Real hosting was not measured. The chunk size warning limit is raised on purpose. The same build writes `THIRD-PARTY-LICENSES.md` with the licence text of the SDK packages, the wasm decryptor included.

## Testing approach

`ledger.json` is both the offline data and the oracle: each demo transaction records the indexer's answer and what each key must read. For the four SEANCE transfers the expected amounts and memos were written down when each transaction was sent, before the page read them back. Unit tests decrypt every demo with every key and compare, read the amounts with the audit key, and pin the Poltergeist's numbers together with the facts behind them taken from the raw replies, so tuning the code cannot change a claim unseen.

The smoke test then drives the production build the way a judge would (summon, paste, hold the seance, wrong key, own key) live and in recorded mode, where every outside host is made unresolvable, so any request the page tried to make would show up as a failure. It also walks the leaks panel and the Poltergeist, the Auditor with its progress bar and a key changed mid-count, and runs the Auditor with the CPU slowed 4 times. That last check needs a control: the Long Tasks API does not report a busy loop run inside `page.evaluate`, so the control is a 120 ms block scheduled as a page task, which the observer must see before its silence about the Auditor means anything. Two earlier runs failed on exactly this and on the shared task described above.

## Left for later

- A real check of the "cannot spend" claim for the audit key by trying to spend with it. Today it rests on what a view key is.
- Checking the indexer's reply against the chain, and testing what a sender can change to leak less. The Poltergeist measures what leaks; it does not claim a fix.
- A Worker for the Auditor's search, and splitting the chunk if the decryptor ever becomes optional.
