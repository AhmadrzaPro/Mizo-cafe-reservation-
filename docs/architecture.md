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
| `web/src/state.js` | Shared frontend state: the booking `state` and the mutable `store` |
| `web/src/dom.js` | `byId()`, typed from `web/index.html`; and the `html` tag and `setHtml()`, the only way markup reaches the page |
| `web/src/floor/` | The floor studio: furniture, undo and redo, geometry, zoom and gestures |
| `web/css/main/`, `editor/`, `saas/` | Stylesheets by feature. Each folder is served as one file (`/styles.css`, `/editor.css`, `/saas-admin.css`), its files joined in name order |
| `db/schema.ts`, `drizzle/` | The schema and D1 migrations, applied in order |

The build (`scripts/build.sh`):

1. `scripts/embed-assets.mjs` bundles `web/src/main.js` with esbuild into one IIFE script (`/app.js`), then writes it, the HTML, CSS, images and font into `dist/server/site-content.js` with a content hash per asset.
2. `scripts/bundle.mjs` bundles `worker/src/index.js` into one ESM file, `dist/server/index.js`.
3. The hosting manifest and migrations are copied into `dist/.openai/`.

## Tenancy and booking rules

- Every café has its own URL, `/?cafe=<slug>`; `/?new=1` creates a café. Nothing falls back to "the last café". `DEFAULT_CAFE_SLUG` can choose one café for `/`, and signed-in staff default to their own.
- Setup records the owner's mobile together with the café, its first branch and map. From then on, only invited mobiles sign in, with a code bound to the café and used once.
- Staff APIs check both the café and the branch: only the owner reaches every branch.
- Database triggers (`0012_tenant_booking_integrity.sql`) reject overlapping reservations, buffer time included, whatever the start time. Availability applies the same interval rules.
- Dates, opening hours, closures, table status and indoor/outdoor visibility are checked on the server. Moving a reservation onto a taken interval keeps it where it was.
- Payment, cancellation and refund are conditional writes: a cancelled reservation cannot be paid, and a repeated payment or refund request records nothing twice.
- The owner reviews a floor map before it is published. A table with reservations cannot be deleted.

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
