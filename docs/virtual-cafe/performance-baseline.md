# Virtual Cafe: performance baseline

> **Phase 2:** `app.js` is now minified: 141,018 bytes (gzip 35,657), smaller than before the Virtual Cafe (gzip 38,203). The figures below are the Phase 1 measurements.

Measured on 1 November 2026 from `npm run build`, and in the Chromium that ships with Playwright 1.63, against the e2e server (`e2e/server.mjs`). The browser has no GPU here: WebGL runs on SwiftShader, a CPU renderer, so frame rates below are a worst case, not a phone's real figure (see "Frame rate").

## Bundle sizes

Sizes in bytes, raw and gzip level 9 (the Worker serves them compressed through Cloudflare).

| Asset | Before | After | Change |
| --- | --- | --- | --- |
| `/app.js` | 185,164 (gzip 38,203) | 206,170 (gzip 43,205) | +21,006 (gzip +5,002) |
| `/styles.css` | 42,971 (gzip 9,327) | 49,851 (gzip 10,552) | +6,880 (gzip +1,225) |
| `index.html` | 52,859 (gzip 12,722) | 55,195 (gzip 13,383) | +2,336 (gzip +661) |
| `/virtual-cafe.js` (new, on demand) | — | 560,657 (gzip ≈ 142,000) | not in the initial load |
| Everything else | unchanged | unchanged | 0 |

**The normal booking page's initial download grew by about 6.9 KB gzipped**, roughly 2.3% of the ~303 KB it was before (gzipped: font, hero image, CSS, script, page). The growth is the module's glue that has to be ready before the customer asks for it: the entry button, the dialog markup and styles, the loader, the adapter, the fallback and the table card. **three.js is not in it:** `tests/virtual-cafe.test.mjs` fails if `/app.js` ever contains it.

`app.js` is not minified (an existing build choice); minifying it would cut the initial script by roughly 40% and more than pay for this growth. That is recommended separately, not done here.

## Normal booking, Virtual Cafe never opened

| Measure | Before | After |
| --- | --- | --- |
| Requests to load the booking page | 10 | 10 |
| Bytes on the first load (uncompressed, local server) | ≈ 492 KB | 522 KB |
| `virtual-cafe.js` requested | — | **never** |
| `<canvas>` / WebGL context created | none | **none** |
| Frame loop or 3D input listeners | none | **none** |

The browser tests check the last three on every run, at desktop and phone size (`e2e/virtual-cafe.spec.mjs`, "with the Virtual Cafe off…"). With the feature switched on but not opened, the only difference is a visible entry button; the engine is still not requested.

## Opening the Virtual Cafe

Default café map (5 tables, one indoor room), from the "Virtual Cafe" button to an interactive scene, local server:

| Device profile | Open to interactive | Engine download | JS heap after load |
| --- | --- | --- | --- |
| Desktop 1280 × 800 | 630 ms | 561 KB (≈142 KB gzip) | ≈ 10 MB |
| Phone 390 × 844 @2×, CPU slowed 4× | 1,586 ms | same | ≈ 10 MB |

Over a mobile network the download dominates: about 142 KB gzipped, cached as immutable after the first visit.

## Frame rate and scene cost

| Measure | Value |
| --- | --- |
| Draw calls while walking | 18–19 |
| Triangles in view | ≈ 1,070 (≈ 70 when facing a wall) |
| Textures | 2 kinds, drawn on canvases at runtime (one 256 px floor pattern, one 256 × 128 px label per table); no image downloads |
| Lights | 2 (hemisphere + one directional), no shadows, no post-processing |
| Frame rate, SwiftShader (CPU), desktop | 8–9 FPS |
| Frame rate, SwiftShader (CPU), phone @2× with CPU slowed 4× | 12–14 FPS, **23 FPS** after adaptive resolution stepped down to 1× |

The scene is far below any GPU's limits (a mid-range phone GPU draws hundreds of thousands of triangles and hundreds of draw calls at 60 FPS). Under SwiftShader the cost is filling pixels on the CPU, which is why lowering the pixel ratio helped and the triangle count did not matter. **Real-device numbers still have to be taken** on a mid-range Android phone and an iPhone before release; this environment has neither.

When nothing moves, the engine does not render at all (it draws on demand), so an idle Virtual Cafe costs almost nothing in battery or heat.

## How to repeat these measurements

```bash
npm run build
```

Sizes: read `dist/server/site-content.js` (each asset's body) and gzip them. Runtime: open a café with the Virtual Cafe enabled and `?vcdebug=1`; the debug panel shows FPS, draw calls, triangles, the scene's branch and the selected table. With `?vcdebug=1` the engine renders every frame, so the FPS reflects capacity rather than idleness.
