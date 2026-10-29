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
