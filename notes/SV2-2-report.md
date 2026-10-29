# SV2-2 report: Seance v2 ready to publish, and the forum text

Done on 2026-10-29 (UTC), after SV2-1. Nothing was pushed, published or posted, no repository or remote was created, and v1 (`ROOT/seance`) was not touched. `ROOT` is the folder that holds this repository.

## Read first

1. **The dead link is fixed and the links gate checks receipts now.** The page's link to the second public indexer opens that indexer's receipt for the id. The gate asks both indexers for the receipt of all 20 ids and compares four fields that a saved copy and a receipt both carry. All 20 pass on both indexers.
2. **`npm run links` is FAIL (7), and all 7 wait for the push** (the repository, its Pages site and the three forum pictures; named in section 3). Nothing else in the gate fails: 30 ok.
3. **Every other gate passes on the final code**: tests 13 files, 259 passed; smoke 927 ok, 0 FAIL; scan 31 ok plain and with the denylist; privacy grep 0.
4. **Three pictures** are in `public/media/` (1280 px wide, 47 to 188 KB, each looked at). **The forum text** is outside the repo, at `ROOT/scratch/why-us/seance/forum-v2.md` (block A, 3 lines; block B, 198 words by `wc -w`). A judge model graded the final text of both blocks against the 17 forbidden claims: none was made, every probability 0.006 or lower (section 5).
5. **Both live paths ran on the final code.** At 20:19 UTC the live list held no private transfer, so the live walks took the quiet-chain path for real (smoke 915 ok); at 20:35 UTC it held one, so they took the stranger path (smoke 927 ok, the run in `evidence/smoke.txt`). The mocked quiet-chain scenario (10 checks) is in both runs.

## 1. Commits (all on `main`, author Kylne700, no remote)

| Commit | What |
|---|---|
| b1a339e | The saved-copy link opens the second indexer's receipt; the links gate checks receipts; repo links point at `Kylne700/seance-v2`; README badge back; dated notes in README and `docs/checks.md`; offline tests from fixtures; a quiet-chain scenario in the smoke test |
| 81b8af7 | The three forum pictures and `scripts/shoot-forum.mjs` that draws them |
| d0c02d1 | Evidence rerun on the final code, 20:19 to 20:25 UTC: smoke 915 ok (the live list held no private transfer), links FAIL (7) |
| a4ffc50 | First version of this report |
| d628bff | Evidence rerun at 20:35 UTC with a private transfer in the live list: smoke 927 ok. `evidence/smoke.txt` and the screenshots are from this run; `evidence/links.txt` is from d0c02d1 |
| 309988b | This report, with the numbers brought up to d628bff (927) and the late corrections to the forum text recorded in it |
| (last commit) | This report: the judge model run again on the final forum text, the screenshot check, the word counts of block B |

## 2. The dead link and the links gate (2026-10-29)

- **What the indexers answer (checked 2026-10-29, 20:24 UTC).** At `/transactions/<id>` both answer 404 for all 20 ids we hold (15 demos, 3 set-up steps and the 2 of the recorded sample): the first has done so since 2026-10-24 (as the README says; SV2-1 section 2), the second since today. At `/transaction-receipts/<id>` both answer 200 for all 20, with identical JSON for 20 of 20. A made-up id gets 404 at the receipt address on both.
- **The page.** Beside a saved copy the links now read "Receipt from the second public indexer", "The saved copy (ledger.json)" and "Receipt from the first public indexer". A live or file answer keeps "Open in the explorer".
- **What the gate compares.** For each of the 20 ids both receipts must answer 200 with outcome Commit. For the 17 ids that have a saved copy, each receipt must also agree with it on every field both carry (measured over all 17 saved copies, 15 demos and the 2 of the recorded sample): the outcome, the fee paid, the sealed notes the transaction spent (the `utxo_` ids among the saved inputs against the `utxo_` ids in the receipt's `downed`, as sets) and the epoch (the receipt's epoch must lie inside the saved `min_epoch` to `max_epoch`: a bound, not an equal field). A field missing on either side fails. The 3 set-up steps have no saved copy: answer and outcome only.
- **What cannot be compared.** The receipt body holds no transaction id (the id binds a receipt to a transaction only through the address it came from), and the saved inputs hold no version (null).
- **Weaker than before, and said so in README and `docs/checks.md`.** The old check compared the whole answer, so the sealed bytes and memos in `ledger.json` are no longer compared with any public answer.
- **Kept.** The made-up-id negative control (now at the receipt address of both indexers), a new control (a saved copy against another transaction's receipt must disagree), the template and token checks on both indexers, the explorer page, the other links.
- **Tests, offline.** `test/receipts.test.ts` (15 tests, from `test/fixtures/receipts.json`, the 20 receipts recorded on 2026-10-29) and `test/proof-links.test.ts` (6 tests). They show each of the four checks failing when one field of a saved copy or of a receipt is changed, an answer that is no receipt failing every check, and every demo's receipt against every other demo's saved copy failing.
- **Real run, 20:24 UTC.** Both receipts 200 with Commit and agreeing with the saved copy for 18 of 18 and 2 of 2; identical on both indexers for 18 of 18 and 2 of 2; whole transaction by id: 404 on both for all 20 (reported, not judged); both negative controls, the template and token on both indexers and the explorer page ok.

## 3. Repo links, and the checks that need the push

Repo links now point at `Kylne700/seance-v2` in the five places SV2-1 section 6 lists (`src/config.ts`, `index.html`, `scripts/links.mjs`, `scripts/smoke.mjs`, `test/page.test.ts`), and the README has its workflow badge back. The history mentions in `notes/` were left alone. No link to v1 remains outside `notes/` and `evidence/`.

The 7 checks of `npm run links` that fail until the repository exists and Pages has run (all HTTP 404 today, 20:24 UTC):

1. `https://raw.githubusercontent.com/Kylne700/seance-v2/main/ledger.json` (the saved-copy link)
2. `https://github.com/Kylne700/seance-v2/blob/main/template/src/lib.rs` (the template source link)
3. `https://github.com/Kylne700/seance-v2/actions/workflows/pages.yml/badge.svg` (the README badge)
4. `https://kylne700.github.io/seance-v2/` (the site)
5. to 7. `https://kylne700.github.io/seance-v2/media/` followed by `ask-for-it-anyway.png`, `ghost-log-after-summon.png` and `saved-file-0-requests.png` (the pictures; the gate reads the names from `public/media/`)

Also waiting for the push, not covered by `npm run links`: the Pages workflow (`.github/workflows/pages.yml`) has never run, so the deploy itself is unchecked.

## 4. The pictures (`public/media/`)

| File | Size | What it shows |
|---|---|---|
| `ghost-log-after-summon.png` | 1280 x 1011, 187,797 bytes | The headline "This page sent 6 requests to 2 hosts; your keys were in none of them." and its 6 rows: the page, script, style sheet and icon from the site (all 200), the list request to the first indexer at 1.95 s (`/transactions/recent?limit=40`, status 200, "No transaction id."), and a second icon row at 2.25 s. The Summon was real, against the live indexer; only the log is in the crop, never the transaction Summon showed (the script keeps the crop to the log). |
| `ask-for-it-anyway.png` | 1280 x 239, 47,067 bytes | The page's live line ("Asking the Esmeralda indexer. The requests this page made are listed below.") and, for an id the list did not hold, "This id is not among the indexer's latest 40 transactions. Asking the indexer for it by id would show it this id, together with your IP address and the time.", with the buttons "Ask for it anyway" and "Open a saved transaction file". The id typed in (made up by the script) is not in the crop. |
| `saved-file-0-requests.png` | 1280 x 836, 155,417 bytes | After opening our own demo file (`examples/saved-transaction.json`): "This page sent 4 requests to 1 host; ..." and the green "Since you opened your file: 0 requests." with the 4 page-file rows. |

**How.** `scripts/shoot-forum.mjs` (new): the production build served under the Pages host name (a throwaway self-signed HTTPS front and a Chromium host mapping, no request interception, so the log behaves as in a normal load), a fresh browser context per picture, and a crop from one element to another across the whole width. It refuses a picture whose text holds a transaction id, that is not 1280 px wide or that is over 300 KB, and it checks the log's rows (the headline counts them, each is the site or the indexer, the site's files answered 200, and for the first two pictures the one indexer request is the list) before it keeps one. For the third picture the browser cannot resolve any host but the site, and the script checks that no request went elsewhere and that the log reads "Since you opened your file: 0 requests." **I looked at each picture**: legible, only the host names `kylne700.github.io` and `esme-indexer-a.ootle.tari.com`, no stranger's data, no id.

**Re-shoot after the push**: `FORUM_URL=https://kylne700.github.io/seance-v2/ node scripts/shoot-forum.mjs` (README says so).

**One oddity, left as it was.** The first picture has a second icon row at 2.25 s, 0.3 s after the list request (the cause is not established; it may come from the address change after a Summon; a plain-HTTP probe on 127.0.0.1 showed one icon row). The picture shows the log as it really was. SV2-1 section 5 already lists "the log's rows for the browser's own refresh and for the icon" as checked in headless Chromium 154 only. Whether a visitor's browser shows the extra row: NOT VERIFIED.

## 5. The forum text (`ROOT/scratch/why-us/seance/forum-v2.md`, not in the repo)

- **Block A** (top of the post): 3 lines, 63 words: dated update, links to `https://kylne700.github.io/seance-v2/` and `https://github.com/Kylne700/seance-v2`, one-line why (in v1 a lookup sent the id you typed to the indexer; v2 looks in the latest 40 first and asks for the id only if you say so, our demos excepted).
- **Block B** (end of the post): 198 words by `wc -w` (limit 200; `wc -w` also counts the heading mark and the picture markup, 189 without them), Discourse markdown, two pictures by their Pages URL. It says what v2 changes, what the indexer and the site host still see, the dead link dated, and that v1 is unchanged at `https://kylne700.github.io/seance/`. A comment at the top offers the third picture with its sentence, outside the word count.
- **Posting condition** (in a comment at the top of the file): only after the push and a first load of the Pages URL.
- **Truth check.** Sentence by sentence against the v2 code (`src/data.ts` `lookup` and `recent`, `src/main.ts` for a shared `#tx=` link, which also goes through the list first, and the log's own hint text) and SV2-1 section 4. Corrections made while writing: the log "lists the page's requests so far" (never "every request": the log may miss what the browser or an extension does by itself); the id is asked for "only if you press Ask for it anyway, or for one of our demos"; the sentence about links names the explorer and receipt links, not the `ledger.json` link (its address holds no id); what the indexers and GitHub keep is "not checked". A late correction: "Summon picks one of them" is false when the list holds no private transfer (as at 20:19 and 20:25 UTC), so it now says "Summon picks a private transfer from them, or a recorded sample if none".
- **One place where I did not follow the brief's words.** The brief (and research/76 alternate L2) describe the log as showing "every request the page made". The text does not say that: the page's own hint says the log may miss what the browser or an extension does by itself, so the text says "the page's requests so far" with that caveat.
- **Judge model.** `drex_decide` read the first draft against the 17 claims of research/76 section 4 (12 yes/no questions, the topic-only claims 9, 10, 11, 12, 13, 15 and 17 as one): the probability that the text makes the claim was 0.007 or lower for every question. Three edits followed (the Summon sentence, "when asked", "so v2's link to it opens its receipt"), so I ran it again on the final text of blocks A and B, pasted verbatim, with the same 12 questions (its brief now also says that Summon shows a recorded sample when the list holds no private transfer): 0.006 or lower for every question (claim 14 0.006; claims 4 and 16 0.003; the other nine 0.001 or 0.0). That is under the bar of the first run. A hint from a model, not a proof; I also re-read the three edits against claims 1, 2, 4 and 8 myself: none is made (Summon's list request is still named). The final text and the strings inside the three picture files hold 0 matches against the privacy denylist (a cleaned copy of it, never printed) and no home-directory path or email address (checked again after the last edit); the picture pixels I looked at, not scanned; `shoot-forum.mjs` is in the tree that `npm run scan` checked with the denylist.

## 6. Gates (2026-10-29, real numbers; the code has not changed since 81b8af7, only evidence and this report after it)

| Gate | Result |
|---|---|
| `npm ci` | exit 0, added 72 packages in 0.9 s, 0 vulnerabilities |
| `npm run typecheck` | exit 0 |
| `npm test` | 13 files, 259 tests passed (SV2-1 ended at 11 files, 236) |
| `npm run build` | exit 0; JS 1,892.00 kB (717.84 kB gzip), CSS 12.64 kB (3.65 kB), index.html 14.00 kB (4.20 kB); `dist/media/` holds the 3 pictures |
| `npm run smoke` | PASS: 927 ok, 0 FAIL, exit 0, 231 s (20:35 to 20:39 UTC), headless Chromium 154; `evidence/smoke.txt`. The live list held one private transfer, so the live walks took the stranger path: "Summon shows a stranger's transaction", "an id found in the list" with the live explorer link, and "pasting that id ... no request at all, none for the id" all ok. An earlier run at 20:19 UTC (list without a private transfer, so the live walks took the recorded-sample path) was PASS, 915 ok, 0 FAIL, 229 s. SV2-1 had 917; compared with it, 10 quiet-chain checks (mocked empty list) are new and the rest is checks renamed with the new link labels (compared by check name) |
| `npm run links` | FAIL (7), exit 1, 36 s, 30 ok; all 7 wait for the push (section 3); `evidence/links.txt` |
| `npm run scan` | PASS, 31 checks, plain (the denylist checks print SKIPPED: no file given) |
| `npm run scan` with `DENYLIST=<tools/privacy-denylist.txt>` | PASS, 31 checks, 0 denylist matches in history, tree, dist and dist wasm. The "throwaway secrets" check prints SKIPPED in both runs: it needs the secret folders and my rules forbid opening them |
| privacy grep (an absolute home-directory prefix, a gmail address, the user directory name) | `git log -p --all` (26 commits including the last, one author and committer identity): 0 matching lines; tracked and untracked files: 0; `dist/`: 0. Run before the last commit and again after it, same result |

## 7. NOT VERIFIED

- **The Pages deploy and the picture addresses.** The workflow has never run; `https://kylne700.github.io/seance-v2/` and its `media/` pictures have never loaded.
- **The live path depends on what the chain holds.** The stranger path ran once, on the one private transfer the list held at 20:35 UTC; at 20:19 UTC the list held none and the quiet-chain path ran instead. Both passed, but any other state of the list (several private transfers, only our own) was not run.
- **The pictures came from the local build** under the Pages host name, in headless Chromium 154, not from the deployed site; the second icon row in the first picture is unexplained.
- Browsers other than headless Chromium; speed on Pages.
- What the indexers, Cloudflare, GitHub Pages and the explorer keep or log.
- That v1 stays unchanged at its address (the brief says so; I did not load or touch it).
- The throwaway-secret scan (SKIPPED, see section 6).

## 8. Open problems and the lead's next steps

- Creating the repository and pushing are the lead's: after the push and the first Pages run, `npm run links` should show 0 FAIL; if a picture URL does not load, upload the PNGs from `public/media/` to the forum instead.
- The text of block B names the pictures by their Pages address, so it must not be posted before they load.
- `evidence/smoke.txt` names one stranger's public testnet transaction (its id, in the explorer link of the live Summon checks), as SV2-1's evidence did (5 distinct ids there, 4 here, of which 3 are our demos). Of the 13 screenshots that changed in d628bff I looked at the four taken on the live page (`seance-1280-live-bob.png`, `seance-1280-live-bob-full.png`, `seance-1280-live-silence.png`, `seance-375-live-silence.png`): they show our own demo (`e99ccae2...`) or no transaction, not a stranger's. I did not look at the other nine (recorded, saved file, mocked list, log only), nor at the older screenshots except one live ghosts picture from SV2-1, which also shows our own demo. Decide before the push whether `evidence/` stays as it is.
- The 2 recorded-sample transactions in `ledger.json` and `test/fixtures/receipts.json` are other people's public testnet transactions (from SV2-1; unchanged).
