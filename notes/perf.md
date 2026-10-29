# Speed: v1 against v2

Made on 2026-10-29 (about 18:50 UTC) with `scripts/perf.mjs`: `nice -n 19 node scripts/perf.mjs <v1 build> /seance/ dist /seance-v2/ 5`.

- before = the v1 build (the first commit of this repository, Kylne700/seance@0642c4a). A lookup of a recent id asks the indexer for that id: one request.
- after = the build of this repository. A lookup of a recent id downloads the indexer's list of the latest 40 transactions, finds the id in it in the browser, and asks for nothing by id: one request, the list.
- Same machine, headless Chromium, a fresh browser context for every run (so every run starts with an empty cache and cold connections), the real indexer, the two builds run one after the other in alternating order, one discarded warm-up round, then 5 rounds. The median is shown, with the range.
- Both pages were served by a small static server on this machine, without compression. So "first load" leaves out the network time to the site host and is only good for comparing the two builds with each other.
- The lookup is timed from pressing "Look at it" (a recent id was pasted a moment before: one input event, as a paste) until the answer is on the page.

| What (median of 5, with the range) | before | after | after minus before |
|---|---|---|---|
| first load, until the page works | 259 ms (255 to 368) | 274 ms (251 to 325) | +15 ms |
| lookup of a recent id: press to shown | 253 ms (236 to 332) | 312 ms (239 to 342) | +59 ms |
| lookup through a #tx= link: open to shown | 355 ms (330 to 394) | 355 ms (341 to 399) | -1 ms |
| indexer requests in one lookup | 1 (by id) | 1 (the list) | |
| of which the list of latest transactions took | | 281 ms (211 to 299) | |
| an id no longer among the latest 40: press to shown, with the click on "Ask for it anyway" made the moment the prompt shows | 282 ms (255 to 298) | 390 ms (367 to 516) | +107 ms |
| of which press to the prompt, where version 2 waits for the visitor | | 276 ms (257 to 349) | |

The limit set for this work: report it if the privacy step makes a lookup more than 400 ms slower at the median, and keep the step anyway. It does not come near: +59 ms for a recent id, -1 ms through a link, and +107 ms for an id outside the list (one list request, then, once the visitor says so, one request by id). The last row leaves out the time a person takes to read the prompt and click.

What the ghost log, the file button and the lookup rules add to what the browser downloads (the production build, gzip -9 of each file):

| File | v1 | v2 |
|---|---|---|
| script | 710,279 B | 713,227 B (+2,948) |
| style sheet | 3,420 B | 3,648 B (+228) |
| index.html | 3,535 B | 4,204 B (+669) |

The size of the list changes with the traffic of the last four minutes: between 91 KB and 432 KB decoded while this was built (154 KB in the run above). A lookup waits for all of it, so on a slow link it takes longer, and it also takes data from a phone plan.

## Not measured

- A slow connection or a phone on mobile data: the cost is the whole list, not one transaction, so it grows with both the round-trip time and the size of the list. Not measured.
- GitHub Pages as the site host. Not measured.
- A browser other than Chromium.
- A warm cache (the visitor looked a moment ago): the browser may then answer the list from its own copy, so the repeat lookup can be faster. Not measured.
