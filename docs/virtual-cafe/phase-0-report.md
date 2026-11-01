# Virtual Cafe: Phase 0 report (architecture guard)

Phase 0 sets the boundary the 3D module lives behind, without changing how booking behaves. Every item of the Phase 0 definition of done is listed with where it is and how it is checked.

## Adapting the specification to Mizo

The specification assumed a React project with `src/features/…`, dynamic `import()` and code splitting. Mizo differs (see [current-architecture.md](current-architecture.md)), so the same goals are reached the Mizo way:

| Specification | Mizo |
| --- | --- |
| React, React Three Fiber | No React in Mizo. **Three.js alone**, behind a small engine API. Adding React only for this module would make the bundle heavier and split the codebase |
| `src/features/virtual-cafe/` | `web/src/virtual-cafe/`, next to the other frontend modules; nothing else was moved |
| `import()` and a lazy chunk | The frontend is one esbuild IIFE, which cannot split. The engine is a **second bundle**, `/virtual-cafe.js`, added as a `<script>` only when a customer opens the Virtual Cafe. Its versioned URL is in `<meta name="virtual-cafe-src">`, so it stays cache-safe and allowed by the CSP (`script-src 'self'`) |
| `virtualCafeEnabled` flag, per café later | The env variable `VIRTUAL_CAFE` (`all`, or café slugs separated by commas) is exposed as `virtualCafeEnabled` in the branch settings answer. **Per-café control works now without a database change.** Unset means off everywhere |
| A demo cafe with 8–10 tables | The scene is **generated from the branch's published floor map**, so every table in it is a real table with its real id, area, size and capacity. A separate demo scene would need fake ids, which the specification forbids. The default map of a new café has 5 indoor tables; a café's own map can have any number |

## Definition of done

| Requirement | Done | Where |
| --- | --- | --- |
| Current architecture documented | ✓ | [current-architecture.md](current-architecture.md) |
| Feature boundary exists | ✓ | `web/src/virtual-cafe/`: `index.js` (UI), `adapter.js` (the only link to booking), `loader.js`, `scene-model.js`, `telemetry.js`, `config.js`, `types.d.ts`; `engine/` is the separate three.js bundle |
| Feature flag works and the feature can be disabled safely | ✓ | `VIRTUAL_CAFE`; `virtualCafeEnabled()` in `worker/src/util/env.js`. Unit test: off by default, `all`, and a slug list. Browser test: with it off, the page is the same, the entry button is hidden, and nothing 3D is requested |
| Booking adapter contract exists | ✓ | `adapter.js`: `virtualScene()`, `tableStates()`, `refreshAvailability()`, `getTableAvailability(tableId)`, `startBooking(table)`. Types in `types.d.ts` (`VirtualTable`, `VirtualTableState`, `EngineOptions`, `EngineController`) |
| Real table ids map to virtual tables | ✓ | `buildVirtualScene()` uses the full id `branch:<cafe>:<branch>:<table>`, the id availability and booking already use. `belongsToBranch()` rejects any id of another branch or café. Unit tests cover both |
| 3D dependencies are lazy-loaded | ✓ | three.js is only in `/virtual-cafe.js`. A unit test fails if `/app.js` contains it, or if the page loads the engine by itself |
| Normal booking does not initialize WebGL | ✓ | Browser test: no `<canvas>`, no engine request through a whole booking |
| A fallback path exists | ✓ | Any failure (no WebGL, script error, timeout after 20 s, lost GPU context, crash in the frame loop) frees the engine and shows "continue with the normal map". Browser tests cover a broken engine, no WebGL and a slow download |
| Existing tests and build pass | ✓ | 119 unit/API tests, 40 browser runs (20 tests × desktop and phone), lint, type check, format |
| Performance baseline documented | ✓ | [performance-baseline.md](performance-baseline.md) |

## Dependency direction

```text
booking page (main.js)
   └── virtual-cafe/index.js ──► adapter.js ──► booking.js, state.js   (existing services)
            │
            └── loader.js ──(script, on demand)──► engine/ (three.js)
                                                     ▲
                       the engine sees only EngineOptions: scene, states, callbacks
```

No existing module imports the engine. The engine imports nothing from the booking page; it receives the scene and table states and reports focus, selection, stats and errors through callbacks.

## Changes to existing code

All small, and made so that the 2D map and the Virtual Cafe share one path:

- `web/src/booking.js`: choosing a table and going on to the details form are now the functions `chooseTable()` and `continueWithTable()`. The 2D map uses them exactly as before; the adapter calls the same ones.
- `web/src/reservation-form.js`: when the backend refuses a booking with `409` (the table or slot was taken first), availability and the map are refreshed and the stale choice is cleared, so going back shows the truth. This also improves the 2D flow, which used to keep the taken table selected.
- `web/src/profile.js`: shows the entry button when the settings allow it.
- `worker/src/api.js`: the settings answer gains `virtualCafeEnabled`.
- `scripts/embed-assets.mjs`: builds the engine bundle (minified) and versions its URL.

No database change; no change to how reservations are validated or stored.
