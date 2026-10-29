# SV2-1 report: Seance v2, private by design

Built and measured on 2026-10-29 (UTC). This folder is a new git repository: no remote, nothing pushed, nothing published. It starts from the frozen v1 tree `Kylne700/seance@0642c4a` (commit 1f016c0); v1 itself was not touched.

## Read first

1. **The lead's redirect was applied, so step 2 is not the decoys of the brief.** A lookup is crowd-first: it starts with the request Summon makes (the indexer's latest 40 transactions), looks for the id in that list in the browser, and asks for the id only when the visitor presses "Ask for it anyway". The decoy version (4e4345c) was built first and is superseded by 303c65b; it stays in the history.
2. **The CSP is exactly v1's**, word for word, nothing added (no `'self'` in `connect-src`, no new host). The brief's step 4 text (`default-src 'self'`) was not used, because v1's policy is stricter. The smoke test compares the page's policy with v1's and counts 0 CSP violations over each browser walk.
3. **`npm run links` fails (20).** Not because of this work: on 2026-10-29 Tari's second public indexer answers 404 for all 18 demo transactions and the 2 of the recorded sample. Details in section 2. The check and the links were not touched.
4. **Repo links still point at v1** (`Kylne700/seance`), so that the links gate can reach them today. The find-and-replace list for after the v2 repository exists is in section 6.
5. The README's live address (`kylne700.github.io/seance-v2`) is true only once the repository is published and Pages has run.

## 1. What was built

| Step | Commits | What | Test |
|---|---|---|---|
| start | 1f016c0 | v1 tree at 0642c4a, no old history | |
| 1 map | 3ec80f0 | `notes/network-map.md`: every request the v1 page can make, who sees what, third-party assets (none) | measured with DevTools in headless Chromium, plus a scan of the hosts in the build |
| 2 crowd-first lookup | 303c65b (4e4345c superseded) | `src/data.ts`: list first, by-id only on "Ask for it anyway" or for a demo id; list kept 60 s and shared with Summon; not listed gives one line with that button and "Open a saved transaction file"; a failed list falls back to recorded mode with the id unsent | `test/data.test.ts` (53), smoke |
| 3 ghost log | ca173db, 2d510fa | `src/netlog.ts` (one wrapper around `fetch` plus Resource Timing) and the panel "What this page asked of the network": one row per request (host, path with the id shortened, bytes sent and read, status, what that host learns) under the headline "This page sent N requests to M hosts; your keys were in none of them." | `test/netlog.test.ts` (25): lookups of every kind, Summon and a saved file with the demo keys in use put no key in any request; a key in an address, header or body is caught; smoke compares the rows with the browser's own protocol |
| 4 CSP | none, unchanged | v1's policy, injected by the `cspMeta` plugin | smoke: the page's policy equals v1's, 0 violations per walk |
| 5 saved file | 2d510fa, 2cbf41a | "Open a saved transaction file" (1 MB cap, refuses non-transactions), `examples/saved-transaction.json` (demo 2), README "Saving a transaction file" | smoke cuts the network when the file is opened; the log reads "Since you opened your file: 0 requests" |
| base path | 0d4ed90 | `/seance-v2/` for vite, preview and the scripts | smoke runs under it |
| 6 speed | 53da369, 1378123 | `scripts/perf.mjs`, `notes/perf.md` | section 3 |
| docs | 2f8fac7, 77ec180, d7b62e3 | README "Private by design" near the top, `design.md`, `docs/checks.md`, `.github/workflows/pages.yml`; dated note about the second indexer | `test/readme.test.ts` |
| evidence | 5da6f24, 73f97f9, and the last commit (this report) | `evidence/` (smoke.txt, links.txt, screenshots) | |

Tests went from 187 (10 files) in v1 to 236 (11 files).

Choices to know:
- Demo ids (picked or pasted) keep v1's by-id request: they are public transactions of our throwaway account, so the id is not private.
- The latest 40 cover only about 4 minutes of traffic, so most older ids reach the "Ask for it anyway" line. The list is kept 60 s in the page, and the indexer's copy may be 30 s old, so a very fresh id can miss too.
- A file answer gets the explorer proof link, clears the `#tx=` hash, and says the page cannot tell whether the file is a genuine answer.
- The log lists "the requests this page has made so far", never "every request". Chromium also reports the browser's own refresh of the saved list, and the log shows it as an extra row without sizes; other browsers: NOT VERIFIED.
- Late copy fixes (d7b62e3), from my own review: the list row said "Only your IP address and the time", which left out the headers the browser adds, so it now says "Your IP address, the time and the headers your browser adds. No transaction id."; the hint under the id box now says a demo you pick or paste is asked for by id.

## 2. Gates (2026-10-29, real numbers)

| Gate | Result |
|---|---|
| `npm ci` | exit 0, added 72 packages in 986 ms, 0 vulnerabilities |
| `npm run typecheck` | exit 0 |
| `npm test` | 11 files, 236 tests passed |
| `npm run build` | exit 0; JS 1,891.92 kB (717.80 kB gzip), CSS 12.64 kB (3.65 kB), index.html 14.00 kB (4.20 kB) |
| `npm run smoke` | PASS: 905 checks ok, 0 FAIL, 232 s, headless Chromium 154 (full run, 19:10 to 19:14 UTC, `evidence/smoke.txt`); a second run of the live scenarios alone also passed (291 ok, 0 FAIL) |
| `npm run links` | **FAIL (20)**, exit 1, 21 s; see below |
| `npm run scan` | PASS, 31 checks, plain run (the denylist check prints SKIPPED: no file given) |
| `npm run scan` with `DENYLIST=<tools/privacy-denylist.txt>` | PASS, 31 checks, 0 denylist matches in history, tree, dist and dist wasm |
| the brief's privacy grep over `git log -p --all` (an absolute home-directory prefix, a gmail address) | 0 matches; the same grep over the tree, tracked and untracked files, finds 0 as well |

**Links gate.** 20 of 20 transaction checks fail with the same cause: the first indexer answers 404 (as the README has said since 2026-10-24, and the gate does not judge that) and the second indexer now answers 404 as well, so there is no live answer to compare the saved copies with. Everything else in the gate passes: the negative control, the demo token's template and token records on both indexers (view key equals the audit key), the explorer's page for the token, and the four repository and footer links. A direct probe the same day: both indexers answer 200 at `/transaction-receipts/<id>` for all 20 ids, and the second indexer's newest transaction is now from 2026-10-28 02:19 UTC (it was 2026-10-21 on 2026-10-24). `scripts/links.mjs` is byte-for-byte the v1 script, so the same 404s would fail it on the v1 tree (not run there: v1 is frozen). Left alone on purpose, because turning it green means choosing what replaces the dead mirror link. The page still offers "Raw answer from a second public indexer" beside a saved copy, and it now opens a 404. Decision for the owner: repoint that link (for example at the first indexer's receipt, which answers) and the gate's comparison, or wait for the mirror. The README carries a dated note about this.

**Smoke.** The full run walks the page at 1280 px and 375 px, live and recorded, offline for the file, and checks the ghost log row by row against the browser's own protocol. In both runs the live chain was quiet, so Summon fell back to the recorded sample and the checks that need a stranger's live transaction (Summon makes one list request and none by id; an id from the list is read from the list) were skipped by design. They ran and passed earlier the same day, in a full run (916 ok, 1 FAIL, a counting error in the test about the browser's own refresh of the list, fixed in the test: it now compares the rows with the protocol exactly) and in a live-only run (302 ok, 0 FAIL), both before the two late wording fixes.

**Scan.** The "throwaway secrets" check prints SKIPPED: it needs secret folders next to the checkout, and my rules forbid opening them. The generic checks (private key blocks, JWT-style tokens, spend or private secrets assigned a 64-hex value, mnemonic fields, home paths, the account name) pass in history, tree, dist and the wasm. Only the project identity authored the commits.

## 3. Speed, before and after

`scripts/perf.mjs`, 2026-10-29 about 18:50 UTC. Same machine, headless Chromium, a fresh browser context per run (cold cache, cold connections), v1 and v2 run alternately, one discarded warm-up, median of 5 (range). Both served by a local static server, so "first load" leaves out the network time to the site host.

| What | v1 | v2 | v2 minus v1 |
|---|---|---|---|
| first load, until the page works | 259 ms (255 to 368) | 274 ms (251 to 325) | +15 ms |
| lookup of a recent id, press to shown | 253 ms (236 to 332) | 312 ms (239 to 342) | +59 ms |
| lookup through a `#tx=` link, open to shown | 355 ms (330 to 394) | 355 ms (341 to 399) | -1 ms |
| id outside the latest 40, press to shown, with the click on "Ask for it anyway" made as soon as the prompt shows | 282 ms (255 to 298) | 390 ms (367 to 516) | +107 ms |
| indexer requests in one lookup of a recent id | 1 (by id) | 1 (the list; 281 ms, range 211 to 299) | |

The limit (more than 400 ms slower at the median: report it, keep the step) is not reached. The download grows: script 710,279 B to 713,227 B gzip, style sheet 3,420 B to 3,648 B, index.html 3,535 B to 4,204 B. The list is 91 KB to 432 KB decoded depending on traffic, and a lookup waits for all of it: on a slow link or a phone plan it costs more. Not measured: slow or mobile links, GitHub Pages, browsers other than Chromium, a warm cache.

## 4. What the indexer and GitHub Pages still see

**The indexer** (`esme-indexer-a.ootle.tari.com`, behind Cloudflare, so Cloudflare sees these too):
- For a Summon, or a lookup of an id that is not a demo (the page keeps the list for a minute, so usually no more than one such request a minute; a failed list is not kept): your IP address, the time, and the headers your browser adds (its name and language, for example), in the request `GET /transactions/recent?limit=40`. That request is the same for everyone and names no id; the page looks for your id inside the answer, in your browser.
- Your id, in its own request: when you press "Ask for it anyway" (for an id you typed, pasted or opened by a `#tx=` link that the list did not hold), and for a demo you pick, paste or open by link. A VPN or Tor changes the IP address the indexer sees, not the id.
- The page does not claim that an id is never sent, that the IP address or the time is hidden, or that a lookup is anonymous.
- Opening a saved file asks nobody (checked in Chromium by cutting the network).
- What the indexer or Cloudflare keep or log: NOT VERIFIED.

**GitHub Pages** (the site host): your IP address, the time, and the browser's headers for each file the page loads (the document, the script, the style sheet and the icon). The page's requests to the site host are for its files; a lookup goes to the indexer, and the tests check that no key is in any request the log lists. A `#tx=` fragment is not part of the page request (the v1 capture in `notes/network-map.md` agrees). What github.io logs or keeps: NOT VERIFIED.

**A click on a link** opens another site and tells it the id in the link: the explorer for a live answer; the second indexer, `ledger.json` on GitHub and the first indexer's receipt for a saved copy. The page does not call them. What they keep: NOT VERIFIED.

## 5. NOT VERIFIED

- What GitHub Pages, the explorer, the second indexer, `raw.githubusercontent.com`, Cloudflare and the first indexer keep or log.
- The deploy: `.github/workflows/pages.yml` has never run, and `https://kylne700.github.io/seance-v2/` was never loaded. Every browser check ran against a local static server under `/seance-v2/`.
- Any browser other than Chromium 154 (headless): the log's rows for the browser's own refresh and for the icon, the file input, Resource Timing reports.
- Speed on a slow or mobile link, on GitHub Pages, with a warm cache, in other browsers.
- Traffic the log cannot see and does not claim to: headers, DNS and TLS, extension traffic, CORS preflights, and failure reports a browser may send to Cloudflare's collector (none seen).
- Row sizes are decoded bodies, not wire bytes, and a row answered from the browser's cache looks like a fresh one.
- The throwaway-secret scan (SKIPPED, section 2).
- Comparing the saved copies with a live raw answer: impossible today (section 2). `npm run links` on the v1 tree was not run (v1 is frozen); that it fails the same way is inferred from the identical script.
- The checks that need a stranger's live transaction did not run in the final runs (quiet chain, section 2); they last ran before the two late wording fixes (d7b62e3).
- The CSP in browsers other than Chromium; the effect of the policy on a click (it has none) is documented, not tested.

## 6. After the v2 repository exists

Replace `Kylne700/seance` with the v2 repository in: `src/config.ts` (`LEDGER_URL`), `index.html` (the template link), `scripts/links.mjs` (the repository links), `scripts/smoke.mjs` (`TEMPLATE_URL`), `test/page.test.ts` (the template link check). Add the workflow badge to the README (it was removed, because a badge for a repository that does not exist is a broken image). Mentions of `Kylne700/seance@0642c4a` in `notes/` are history; leave them. Then run `npm run links` and `npm run smoke` once more: `evidence/` carries the old addresses in its text files. `public/media/seance-demo.mp4` (5.2 MB, in the build) still shows v1 as it was on 2026-10-25.
