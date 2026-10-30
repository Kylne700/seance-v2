# Network map of Seance v1 (the "before" picture)

What the frozen v1 page (commit 1f016c0 = Kylne700/seance@0642c4a) sends over the network, before any v2 change.
Made on 2026-10-29 from the built `dist/`, so it covers everything the page and the browser fetch, not only what the code shows.

How it was measured
- Chromium (headless) loaded the v1 build from a local static server under `/seance/`. The local host stands in for GitHub Pages.
- Every request was recorded with the DevTools Network domain, which also shows the browser's own requests (the tab icon).
- Scenarios: first load, Summon, paste an id and Look at it, Hold the seance, recorded mode, and a link that carries `#tx=<id>`.
- Static check: every host named in the built files (the same scan `npm run smoke` makes).
- Indexer hostnames: `esme-indexer-a.ootle.tari.com` is what the page and the explorer use. `ootle-indexer-a.tari.com` is an alias of it, and `ootle-indexer-b.tari.com` of `esme-indexer-b.ootle.tari.com`, the second public indexer, which is a different backend (on 2026-10-29 each alias returned the same newest transaction as its twin; the two backends returned different ones). The page contacts only the first one.

## 1. Requests the page makes by itself

| When | Request | Host | Carries | Bytes in |
|---|---|---|---|---|
| Opening the page | GET `/seance/` (document) | site host (GitHub Pages) | IP, time, the browser's headers | 11.8 KB (3.5 KB gzip) |
| | GET `assets/index-*.js` | site host | same | 1.88 MB (715 KB gzip); the SDK's wasm is inlined in it |
| | GET `assets/index-*.css` | site host | same | 11.9 KB (3.4 KB gzip) |
| | GET `favicon.svg` | site host | same; made by the browser, not by page code | 0.5 KB |
| Opening the page, nothing else | none to the indexer | | | The first screen is demo 1, read from the bundled recording |
| Summon a recent transaction | GET `/transactions/recent?limit=40` | indexer A | IP, time. No id | 10.6 KB on the wire (brotli), about 91 KB decoded |
| Paste an id, Look at it | GET `/transactions/<id>` | indexer A | IP, time, **the exact id** | 1.3 to 1.6 KB (200), 0.6 KB (404) |
| Hold the seance (one of the 15 demos) | GET `/transactions/<id>` | indexer A | IP, time, **the exact id** | same |
| Opening a link that ends `#tx=<id>` | the 4 page files above, then GET `/transactions/<id>` | site host, then indexer A | the fragment never leaves the browser; the id goes out in the lookup | same |
| Recorded mode (the switch, or after an outage) | none | | | |

Nothing else was requested in 3 s of idle time after load. The source has no polling, beacon, WebSocket, EventSource, XMLHttpRequest, worker or service worker (`rg 'setInterval|WebSocket|sendBeacon|EventSource|XMLHttpRequest|new Worker|serviceWorker' src` finds none).

Headers the indexer receives on each call (browser-made; the page cannot remove them):
`Origin` (the page's origin), `Referer` (origin only, the default `strict-origin-when-cross-origin`), `User-Agent`, `sec-ch-ua*`, `Accept-Language`, `sec-fetch-*`.
Response headers: by-id answers `cache-control: no-store`; the listing `public, max-age=30`. Both `access-control-allow-origin: *`. Both hosts are served by Cloudflare.

## 2. Other paths the code can take

| Situation | What happens |
|---|---|
| A demo id the indexer no longer holds (404) | the saved copy is shown; the page stays live; the next call asks again (1 request each) |
| Network error, timeout (8 s), 5xx or 429 | the page switches to recorded mode and says so; no further request until the user switches back to Live |
| Any other 4xx, or an answer in an unknown shape | an error message; no switch |
| A pasted id the indexer does not know (404) | "not found"; no other request |

## 3. Network use that is not a request by the page

- Links a visitor can click (all `target=_blank rel="noopener noreferrer"`, so no Referer): `explorer.tari.mw/tx/<id>` (Live mode), the second indexer `/transactions/<id>`, `raw.githubusercontent.com/Kylne700/seance/main/ledger.json`, the first indexer's `/transaction-receipts/<id>` (recorded mode), `github.com/Kylne700/seance/blob/main/template/src/lib.rs`, `explorer.tari.mw/substate/<token>`, `explorer.tari.mw`, `ootle.tari.com`. Following one tells that site the id in the link.
- Link-preview crawlers (chat apps, social sites) fetch the page's `og:` and `twitter:` tags and `og.png` when someone shares the address. That is their request, not the visitor's page.
- The browser may send its own failure reports: the indexer's responses carry a Cloudflare `report-to` / `nel` policy, so a browser can report failed requests to Cloudflare's collector. Not seen in the capture (no request failed), so NOT VERIFIED.

## 4. Third-party assets

None are loaded. No web fonts, scripts, styles, images, frames, analytics or CDN files; the page's `font-family` is a system stack.
Hosts named in the built files: the two indexers' names, `explorer.tari.mw`, `ootle.tari.com`, `github.com`, `raw.githubusercontent.com` (all links or recorded data), `www.w3.org` (the SVG namespace in the favicon), the site's own address (preview tags).
`media/seance-demo.mp4` (5.2 MB) is shipped in `dist/` but `index.html` does not reference it, so the page never requests it; only the README links to it.

## 5. Who sees what, in v1

| Party | Sees |
|---|---|
| Site host (GitHub Pages) | your IP, the time, the four page files, your browser's headers. Not your lookups, not your keys |
| Indexer and Cloudflare in front of it | your IP, the time, the browser's headers, and for a lookup **the exact transaction id** you asked about |
| Anyone on the path | that you talk to the site host and to the indexer, and the sizes and timing; the content is TLS-encrypted |
| Nobody | your view key and the audit key: they are used only inside the page (wasm) and are in no request. The `connect-src` of the page's CSP lists only the indexer |

The weak point v2 addresses: the by-id request names the one transaction you care about.

## 6. Send the Seance a secret (v2, with a wallet extension)

Added on 2026-10-30. Sections 1 to 5 are the v1 page and are unchanged. This section is what v2's "Send the Seance a secret" adds when a visitor with the Sapient wallet extension sends a private payment of 0.031415 tTARI (testnet TARI) to Bob, the demo recipient.

Sources. The wallet's requests are from the Chromium net log of a real send with Sapient 0.6.14 on Esmeralda on 2026-10-30 (about an hour of wallet use), made through this page (build 468323d). In that send the page made 4 requests for its own files and 1 for the list, none naming an id and none a POST ([evidence/real-send-2026-10-30.md](../evidence/real-send-2026-10-30.md)). The page's code is also tested with a stand-in wallet. Verified once with a real wallet: a send through this page, the Private fee shown and enforced on the wallet's approval screen, and the refusal message. NOT VERIFIED: the wallet's `submitted` answer, a lost connection, too little funds, the 9-look limit message and "Look again", the 300 s wait, and memos of 36 to 40 characters.

| Who | Request | Host learns |
|---|---|---|
| The page | its files, as in section 1 | the site host (GitHub Pages): IP, time |
| The page | `GET /transactions/recent?limit=40`, the list Summon reads, after a send: up to 9 times, starting 20 s after the send, each next one 20 s after the one before has ended, without the page's kept copy and without the browser's cache (`cache: 'no-store'`), so each look is a real download. "Look again" makes one more | `esme-indexer-a.ootle.tari.com` (Cloudflare in front): IP and time of each; no id |
| The page, to the wallet | `window.tari` calls: messages between the page and the extension in the browser | nothing leaves the browser for these |
| The wallet extension (its background worker) | all to `https://ootle-indexer-a.tari.com`. The send itself (19 requests, from the opening of the approval window to 4 s after the approval): `GET /substates/...` for its own account; `GET /epoch-manager/stats`; `POST /substates/fetch`; `POST /transactions/dry-run`; `POST /transactions` (the send); **`GET /transactions/<id>/result?include_proof=false` twice, a lookup of its own send by id**. A wallet session, when you open the wallet's own screen or press Rescan, and not the send: `GET /identity`; `GET /transactions/recent?limit=50` with `last_id` pages (its scan for payments to you) | that host: your IP, your account id, and the id and time of the payment you sent |
| The browser itself | network error reports to `a.nel.cloudflare.com` for the indexer's origin, and its own update and autofill checks | not part of this feature |

- No new host for the page, no change to the page's policy, and no `*.tari.mw` host on this path in that run.
- The lookup by id is the wallet's. The page never calls the wallet method for it (`tari_getTransactionResult`), nor the one that asks for a view key (`tari_requestViewAccess`). It finds the payment in the list by the commitment of the note the wallet returns.
- What sections 1 to 5 say about the page (it contacts the indexer, and asks by id for a demo or after "Ask for it anyway") holds for the page. It does not cover the visitor's wallet, which talks to its own host and looks up its own payment there by id. On 2026-10-29 the two host names answered with the same newest transaction (see the host line at the top); whether one operator runs both, and what it keeps: NOT VERIFIED.
- The links beside an answer carry the transaction id once the payment is found. The page does not call them, and a click on one sends the id to that site (section 3).

Who sees what, with a wallet send: the page's indexer host sees your IP address and the time of each list request, and no id. The wallet's host sees the wallet's requests above, including the id of your payment. Anyone can read the payment's amount and memo with Bob's published view key: that is the point of the section, and the warning beside its field.
