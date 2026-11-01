# Virtual Cafe: current architecture

An audit of Mizo as it stands before the Virtual Cafe module, taken from the code (Phase 0, step 1). Everything the module relies on is listed with the file that defines it.

## Platform and build

| Concern | Implementation |
| --- | --- |
| Runtime | One Cloudflare Worker (`worker/src/index.js`) serves both the API and the pages |
| Database | Cloudflare D1 (SQLite). Schema in `db/schema.ts`, migrations in `drizzle/` applied in order |
| Frontend framework | **None.** Vanilla ES modules in `web/src/`, no React, no virtual DOM. Markup is built with the escaping `html` tag and written with `setHtml()` (`web/src/dom.js`) |
| Frontend build | `scripts/embed-assets.mjs` bundles `web/src/main.js` with esbuild 0.28 into **one IIFE script** (`/app.js`). The SaaS console has its own IIFE bundle. IIFE output has no code splitting, so a lazy chunk must be a separate bundle loaded on demand |
| Assets | Embedded in the Worker (`dist/server/site-content.js`), served with a content hash (`?v=<hash>`) and cached as immutable |
| Content Security Policy | `script-src 'self'`; no inline scripts. A same-origin script added at runtime is allowed |
| Type checking | TypeScript over JSDoc (`checkJs`), `strictNullChecks` on |
| Deploy | `wrangler.toml` (Workers) or Sites (`.openai/hosting.json`); see `docs/deployment.md` |

## Routing

- **Pages:** `/` is the booking page for `/?cafe=<slug>` (single HTML page with `<dialog>` steps); `/saas-admin` is the platform console. There is no client router; each step is a dialog.
- **API:** a Hono router in `worker/src/api.js`, documented in `docs/openapi.yaml`. Branch resources live under `/api/cafes/{cafe}/branches/{branch}/…`.

## State management

Two plain module-level objects in `web/src/state.js`:

- `state`: the booking in progress: `guests`, `date`, `time`, `table` (label), `tableId` (full table id), `availableTableIds` (`Set` of full ids free at the chosen time), `availability` (last availability answer).
- `store`: everything else: `cafeMap` (the published floor map), `currentCafeSlug`, `currentBranch`, `cafeSettings`, `customerArea`, …

Modules read and write these objects directly; there is no store library or event bus.

## Data model (the parts the module touches)

| Entity | Table | Identity and fields |
| --- | --- | --- |
| Café | `cafes` | `id` = `cafe:<slug>`, `slug`, `name` |
| Branch | `branches` | `id` = `branch:<cafeSlug>:<branchSlug>`, `cafe_id`, `slug`, `name`, `city`, `address`, `active`, `space_mode` |
| Area | `areas` | `id` = `<branchId>:<areaId>`, `branch_id`, `name`, `kind` (`indoor`/`outdoor`), `width`, `height` (pixels, **40 px = 1 m**), `sort_order` |
| Table | `cafe_tables` | `id` = `<branchId>:<tableId>`, `area_id`, `name`, `shape` (`round`/`square`/`rect`), `capacity`, `position_x`, `position_y` (pixels, top-left of the table box), `reservable`, `operational_status` (`available`/`dirty`/`inactive`) |
| Reservation | `reservations` + `reservation_tables` | `reserved_at` (Tehran wall clock `YYYY-MM-DDTHH:MM`), `duration_minutes`, `buffer_minutes`, `status`, `party_size`; tables through `reservation_tables` |

A table's **full id** already carries its café and branch (`branch:<cafe>:<branch>:<table>`). That full id is what availability returns and what booking accepts, so it is the id a virtual table must use.

Table footprint on the map (`web/src/editor.js`, `tableSize`): `rect` is 118 × 70 px, `round` and `square` 76 × 76 px.

## The published floor map

`GET /api/cafes/{cafe}/branches/{branch}/map` (`worker/src/map.js`, `readMap`) is public and returns:

```text
{ branch, spaceMode, areas: [{ id, name, kind, width, height }],
  tables: [{ id, area, name, shape, capacity, x, y, reservable, operationalStatus }] }
```

Ids here are local (`t1`); the page builds the full id as `branch:<cafeSlug>:<branchSlug>:<id>`. The booking page keeps it in `store.cafeMap`. Only areas allowed by `spaceMode` are shown (`visibleAreas()` in `web/src/map-model.js`).

## Availability

`GET /api/cafes/{cafe}/branches/{branch}/availability?date=&party_size=` (`worker/src/availability.js`) returns the day's slots:

```text
{ date, closed, reason, openTime, closeTime,
  slots: [{ time, available, tableIds: [<full id>], remaining }] }
```

A table is free at a time when it is reservable, operationally available, large enough for the party, and no active reservation's interval (duration plus buffer) overlaps. The page calls it from `fetchAvailability()` (`web/src/booking.js`) and keeps the chosen slot's ids in `state.availableTableIds`.

## Booking flow (customer)

1. **Date, party size, time** on the booking card. Each change calls `fetchAvailability()`.
2. **"Continue"** (`#continueBtn`) opens `#tableDialog` and draws the 2D map (`renderCustomerMap()`). Free tables are buttons; others are disabled.
3. **Choosing a table** sets `state.table` and `state.tableId`. **"Confirm"** (`#confirmBtn`) opens `#customerDialog`.
4. **Submit** (`web/src/reservation-form.js`) posts `POST /api/cafes/{cafe}/branches/{branch}/reservations` with `{ customerName, mobile, notes, date, time, partySize, tableIds: [state.tableId] }`.
5. The answer opens `#successDialog`; deposits go on to the gateway (`docs/payments.md`).

## Concurrency protection (already on the server)

- `createReservation` (`worker/src/reservations.js`) re-checks the table against the same interval rules inside the request and answers `409 slot_taken` when it is taken.
- Database triggers from `0012_tenant_booking_integrity.sql` reject an overlapping reservation for the same table even if two requests pass the check at once, and reject a table from another branch (`reservation_table_scope`).
- Deposit bookings hold the table from booking until `payment.dueAt`.

So the backend is already authoritative and atomic for confirmation. **At the time of this audit there was no "held while choosing" state:** a table was only held once the booking was submitted. Phase 2 added server-side holds; see [phase-2-report.md](phase-2-report.md).

## Authentication and sessions

Customers book without signing in; tracking needs the tracking code and mobile. Staff sign in with an SMS code; the session is an `HttpOnly` cookie (`worker/src/auth/`). The Virtual Cafe is a customer feature and needs no session.

## Realtime

None. The booking page and the operations dashboard poll; there are no WebSockets, Durable Objects or server-sent events.

## Settings and feature switches

Branch booking settings are columns of `branch_settings`, served by `GET …/settings` with two values computed from the environment (`paymentMode`, `onlineBookingPaused`). Platform switches are environment variables (`docs/configuration.md`); there is no feature-flag service.

## Tests and checks

`npm test` (node:test, built Worker on in-memory SQLite), `npm run test:e2e` (Playwright, desktop and phone), lint, type check and format, all run in CI (`docs/testing.md`).
