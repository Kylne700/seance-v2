# Speed: v1 against v2

Made on 2026-10-29 with `scripts/perf.mjs`. The same machine, headless Chromium, one browser context per run (so every run starts with an empty cache and cold connections), the real indexer, the two builds run one after the other in each round and the order swapped every round. A first round is thrown away; the median of the next 5 is reported, with the range in brackets.

- before = the v1 build (the first commit of this repository, Kylne700/seance@0642c4a)
- after = the build of this repository
- Both pages were served by a small static server on this machine, without compression. So "first load" leaves out the network time to GitHub Pages and is only good for comparing the two builds with each other.
- The lookup is timed from pressing "Look at it" (the id was pasted a moment before: one input event, as a paste) until the answer is on the page.

## After step 2 (the crowd, before the ghost log and the other changes)

| What (median of 5, with the range) | before | after | after minus before |
|---|---|---|---|
| first load, until the page works | 269 ms (250 to 287) | 265 ms (254 to 287) | -4 ms |
| lookup: press to shown | 266 ms (234 to 286) | 407 ms (355 to 412) | +141 ms |
| lookup through a #tx= link: open to shown | 330 ms (312 to 341) | 471 ms (423 to 493) | +142 ms |
| indexer requests in one lookup | 1 | 9 | |
| of which the list of latest transactions took | | 249 ms (241 to 275) | |

The limit set for this work: the crowd may add at most 400 ms to a lookup at the median. It adds 141 ms. No prefetch was needed, so none was built (the page asks nobody until you press a button).

Where the time goes: the lookup now waits for the list of latest transactions (about 250 ms the first time, because it also sets up the connection) before it can ask for the id. The 8 requests that follow go out together over that open connection and the last one is back about 130 ms later; v1's single request had to set the connection up itself. Eight requests at once cost nothing measurable over one. The page shows the answer when the id's own answer is in; the decoys are not waited for, which is why a run can end while some of them are still on their way (the first "after" run listed 4 of 9 requests as finished when it read the clock).

A link that carries the id (`#tx=`) pays the same extra round trip, and cannot be helped by fetching the list early: the page knows the id only when it opens.

## Not measured

- A slow connection (a phone on mobile data): the extra cost is one more round trip plus the 10.6 KB the list takes on the wire, so it grows with the round-trip time. Not measured.
- GitHub Pages as the site host. Not measured.
