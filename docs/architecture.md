# Architecture

## Code layout

| Path | Purpose |
| --- | --- |
| `worker/src/index.js` | Worker entry: `fetch` sends `/api/*` to the API and everything else to the static pages; `scheduled` runs the background work |
| `worker/src/api.js` | The Hono router: every API route, its auth and permission middleware, and error handling. Documented in [openapi.yaml](openapi.yaml) |
| `worker/src/schemas.js` | `zod/mini` request-body schemas for the public endpoints |
| `worker/src/auth/` | Sign-in codes, sessions, roles and permissions |
| `worker/src/*.js` | One module per domain: setup, branches, map, availability, reservations, operations, payments and gateways, loyalty, reports, staff, settings, SMS and notifications, subscription, SaaS admin, rate limits, maintenance, static assets |
| `worker/src/util/` | Dates and times, mobile numbers, ids and hashing, runtime mode |
| `worker/src/types.d.ts` | `Env`, `Staff` and `Branch` types for the JSDoc annotations |
| `web/src/main.js` | Wires the page; `initializeApp()` starts it |
| `web/src/saas-console.js` | The SaaS console (`/saas-admin`), bundled on its own as `/saas-admin.js` |
| `web/src/state.js` | Shared frontend state: the booking `state` and the mutable `store` |
| `web/src/dom.js` | `byId()`, typed from `web/index.html`; and the `html` tag and `setHtml()`, the only way markup reaches the page |
| `web/src/floor3d/` | The café's booking page and floor editor in 3D: `view.js` (booking, holds, payments, editing), `model.js` (table types, zones, overlaps; pure), `engine.js` (the three.js scene), bundled on its own as `/floor3d.js` and loaded by `loader.js` only on a café's page |
| `web/css/main/`, `editor/`, `saas/` | Stylesheets by feature. Each folder is served as one file (`/styles.css`, `/editor.css`, `/saas-admin.css`), its files joined in name order |
| `db/schema.ts`, `drizzle/` | The schema and D1 migrations, applied in order |

The build (`scripts/build.sh`):

1. `scripts/embed-assets.mjs` bundles `web/src/main.js` (`/app.js`) `web/src/saas-console.js` (`/saas-admin.js`) and `web/src/floor3d/engine-entry.js` (`/floor3d.js`, three.js) with esbuild, each into one minified IIFE script, then writes them, the HTML, CSS, images and font into `dist/server/site-content.js` with a content hash per asset.
2. `scripts/bundle.mjs` bundles `worker/src/index.js` into one ESM file, `dist/server/index.js`.
3. The hosting manifest and migrations are copied into `dist/.openai/`.

## Tenancy and booking rules

- Every branch has its own booking link, `/<café>/<branch>`. Each part is the owner's link name (`cafes.link_slug`, `branches.link_slug`) or, without one, the internal slug, which always keeps working. `worker/src/links.js` holds the rules: 3 to 40 lowercase Latin letters, digits or single hyphens; a café's name may not be a path of the app (`api`, `assets`, …) or look like an internal slug (`cafe-…`), nor a branch's (`main`, `branch-…`). The Worker serves the page at any such path, with `404` for an unknown café. The page reads the café and branch from the path, shows a branch picker when the café has more than one open branch, and keeps the address bar on the readable link of the branch on screen.
- Old `/?cafe=<slug>` links still open the café and are rewritten to the readable link. `/?new=1` creates a café. Nothing falls back to "the last café". `DEFAULT_CAFE_SLUG` can choose one café for `/`, and signed-in staff default to their own.
- Setup records the owner's mobile together with the café, its first branch and map. From then on, only invited mobiles sign in, with a code bound to the café and used once.
- Staff APIs check both the café and the branch: only the owner reaches every branch.
- Database triggers (`0012_tenant_booking_integrity.sql`) reject overlapping reservations, buffer time included, whatever the start time. Availability applies the same interval rules.
- Dates, opening hours, closures, table status are checked on the server. Moving a reservation onto a taken interval keeps it where it was.
- Payment, cancellation and refund are conditional writes: a cancelled reservation cannot be paid, and a repeated payment or refund request records nothing twice.
- The owner reviews a floor map before it is published. A table with reservations cannot be deleted.
- While a customer fills in the booking form, their table is **held** for 5 minutes (`worker/src/holds.js`). A hold is created by one conditional insert that checks overlapping holds and reservations, the trigger `reservation_table_held` refuses anyone else's booking on it, and availability leaves it out. The holder's booking, sent with `holdToken`, deletes the hold in the same transaction; going back releases it; expiry needs nothing.
- A branch's floor is one room in metres with an optional terrace in front (`worker/src/map.js`): tables in `cafe_tables` (type, position, turn, features), the room and decor as JSON in the branch's one area row. A table's zone (hall, VIP, terrace) follows from where it stands. Floors saved before the 3D editor are read as one room, with the same table ids, until the owner saves.

## Times

Two kinds of time are stored, and only two (see `worker/src/util/dates.js`):

- **Instants** (`created_at`, `expires_at`, `sent_at`, `scheduled_at`, …) are ISO-8601 UTC text with milliseconds, as `Date.prototype.toISOString()` writes them: `2026-10-31T20:15:00.000Z`. Equal-length UTC strings compare correctly as text.
- **A café's schedule** (`reserved_at`, closure dates, opening hours) is Tehran wall-clock time without a zone: `YYYY-MM-DDTHH:MM`, `YYYY-MM-DD` or `HH:MM`. Iran has had no daylight saving time since 2022, so Tehran is always UTC+03:30.

The page shows instants on Tehran's clock and calendar whatever the device's zone, and shows schedule values as they are, in the Persian calendar.

## Staff sessions

A sign-in lasts 7 days in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie; the server stores only a hash of the token.

- **Last use** is recorded at most every five minutes.
- **Devices:** `GET /api/auth/sessions` lists the member's devices, and `POST /api/auth/logout-all` signs them out everywhere. The admin panel offers it next to "Sign out" and shows the device count when there is more than one.
- **Deactivating** a staff member deletes their sessions.

## Background work

The `scheduled` handler sends due SMS reminders, expires unpaid deposit holds and ended subscriptions, and deletes old rate-limit windows, expired sessions and sign-in codes. Hosts without a cron never call it, so `GET /api/cafes/…` requests also start this work in the background, throttled per isolate (`worker/src/maintenance.js`):

- due reminders at most once a minute;
- cleanup and subscription expiry at most every ten minutes.

A failure is logged and never affects the request that started it.

## Frontend safety

Markup is built only with the `html` tagged template and written only with `setHtml()` (`web/src/dom.js`). Every interpolated value is escaped unless it was itself built with `html`, so text from customers or staff never becomes markup. ESLint rejects `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `createContextualFragment` and `document.write` anywhere else in `web/src`.

The frontend is type-checked with `strictNullChecks`. API answers kept in `store` are typed in `web/src/types.d.ts`; a render function reads its data into a local and returns when it has not loaded yet. An element the markup must contain is found with `required(selector, root)`, which throws a clear error naming the selector instead of a later "cannot read properties of null".

Page elements are looked up with `byId("id")`, whose type comes from `web/src/element-ids.d.ts`. `node scripts/element-types.mjs` generates that file from `web/index.html`; run it after adding or renaming an id. `npm run typecheck` fails while it is out of date, and on a misspelt id.

## Stylesheets

Specificity decides; `!important` is allowed only inside a `prefers-reduced-motion` block, and `npm run lint` rejects it anywhere else (`scripts/check-css.mjs`). Within a folder, later files override earlier ones.
