# Mizo — Café Table Reservation

A Persian, right-to-left table reservation experience for cafés, built as a Cloudflare Worker with D1 persistence. The project combines a customer booking flow, a branch-specific floor map editor, and a café operations dashboard.

## Highlights

- Customer flow: Jalali dates, available time slots, table selection, tracking and cancellation.
- Café operations: reservations, walk-in table locks, waitlist, branch settings and opening hours.
- Floor editor: indoor and outdoor areas, draggable tables, image-based manual tracing, and a reviewable draft before publication.
- Team roles: owner, branch manager, reception and barista with branch-scoped access.
- Optional integrations: Kavenegar SMS and OpenAI image analysis. Manual map tracing remains available without OpenAI. Demo SMS requires explicit `DEMO_MODE=true`.
- Demo payment and optional subscription UI. These do not process real money.

## Structure

| Path | Purpose |
| --- | --- |
| `web/index.html`, `web/*.css`, `web/assets/` | Page markup, styles and images |
| `web/src/` | Frontend ES modules; `main.js` wires the page and calls `initializeApp()` |
| `web/src/state.js` | Shared frontend state: the booking `state` and the mutable `store` |
| `web/src/floor/` | Floor studio: furniture, undo/redo history, geometry, zoom and gestures |
| `web/saas-admin.*` | SaaS admin page (served as-is) |
| `worker/src/` | Worker modules grouped by domain (auth, setup, branches, map, availability, reservations, operations, payments, loyalty, subscription, SMS, notifications, SaaS admin, static assets) |
| `worker/src/index.js` | Worker entry: `fetch` (API router) and `scheduled` |
| `worker/src/util/` | Dates, mobile normalization, IDs/hashing, runtime-mode helpers |
| `db/`, `drizzle/` | Schema and D1 migrations |
| `scripts/` | Bundling, asset embedding and build validation |
| `tests/` | API regression tests (built Worker) and floor-studio unit tests |

## Build

Requires Node.js 22.13 or newer (Node 24 recommended). Run `npm install` once to get the dev dependencies (esbuild, Prettier).

```bash
npm run build
npm run validate
```

The build emits `dist/server/index.js` and embeds the web assets:

1. `scripts/embed-assets.mjs` bundles `web/src/main.js` with esbuild into a single IIFE script (served as `/app.js`, the only script on the page). It writes that bundle, the HTML, the CSS and the hero image into `dist/server/site-content.js`.
2. `scripts/bundle.mjs` bundles `worker/src/index.js` with esbuild into a single ESM file at `dist/server/index.js`. `./site-content.js` stays an external import.
3. `scripts/build.sh` copies the hosting manifest and migrations into `dist/.openai/`.

`npm run format` formats the sources with Prettier. For hosting with Sites, create your own Site and replace `YOUR_SITE_PROJECT_ID` in `.openai/hosting.json`. The logical D1 binding is `DB`. Runtime credentials must be set as host secrets, never committed.

Optional runtime secrets: `KAVENEGAR_API_KEY`, `KAVENEGAR_TEMPLATE`, `KAVENEGAR_CONFIRMATION_TEMPLATE`, `KAVENEGAR_REMINDER_TEMPLATE`, and `OPENAI_API_KEY`. The image model may be overridden with `MAP_VISION_MODEL`.

## Demo scope

The OTP flow displays a code only with explicit `DEMO_MODE=true`, and payment actions in that mode are simulated. Do not expose management routes as a public production service with demo OTP enabled. The automatic image analysis button appears only when an OpenAI key is configured.

## Notes

The café owner reviews the map before publication. Existing reservation history prevents deletion of referenced tables. Dates in the UI use the Persian calendar; stored dates remain ISO formatted.

## Tenant and booking integrity update

- Every public booking page uses `/?cafe=<cafe-slug>`. Copy this URL for customers and staff. The root no longer chooses the last-created café. `DEFAULT_CAFE_SLUG` can select a single café explicitly; authenticated managers otherwise default to their own café.
- `/?new=1` starts a new café. Setup records the owner's mobile atomically with the café, branch and initial map. Subsequent access requires that invited mobile's OTP; the first visitor can no longer claim an existing café.
- OTP challenges are café-bound and single use. Manager APIs check both café ownership and branch permissions.
- Database triggers in `0012_tenant_booking_integrity.sql` reject overlapping reservation intervals, including buffer time and arbitrary walk-in start times. Availability uses the same interval rules, independent of slot settings and legacy lock spacing.
- Public tracking supports lookup, cancellation and payment; staff status changes are only accepted by the authenticated operations API.
- Date, operating hours, table operational state and indoor/outdoor visibility are validated on the server. Moving a reservation preserves the old reservation if the new interval conflicts.
- Demo payment/refund transitions use conditional transactional writes. Cancellation cannot be reversed by payment; duplicate payment/refund requests cannot record a second transaction. Payment respects manual confirmation.

### Runtime modes

Demo behavior is now **explicit**: set `DEMO_MODE=true` only in an isolated demonstration deployment. This exposes test OTPs and simulates deposits/refunds/subscription renewal. Never use this mode with real customer data.

With `DEMO_MODE` absent, missing Kavenegar configuration returns a clear error instead of exposing an OTP. Reservation messages report failed delivery if their SMS templates are missing. Real payment processing is **not implemented**: deposit-enabled public booking returns `payment_not_configured` until a verified gateway integration exists; keep deposits disabled for real reservations in the meantime. Ordinary bookings work without payments.

### Upgrade an existing database

1. Back up the database. Review any pre-existing overlapping active reservations; this migration does not silently cancel or rewrite them.
2. Apply migrations in order through `0012_tenant_booking_integrity.sql` before serving the new Worker. Existing OTP challenges are invalidated; existing cafés, reservations and sessions are preserved.
3. Cafés that already have owners keep them. For a legacy café without staff, provision its verified owner's mobile in `staff_members` through a trusted administrative migration; public login deliberately cannot claim it.
4. Distribute the explicit café URL, and configure Kavenegar or isolated demo mode as appropriate. No implicit global-café fallback remains.
5. Do not mix an older Worker with the new triggers. The English-edition branch is separate and must receive the same backend/contract changes before its deployment is upgraded.
6. Apply `0014_rate_limits.sql` before serving a Worker with abuse protection. It only adds the `rate_limits` table and does not change existing data.

### Abuse protection

Limits are counted in the `rate_limits` table with one atomic upsert per check, so concurrent requests cannot both take the last slot. Blocked requests return `429` with `{error:"rate_limited", message:"…"}`. The active-reservation cap returns `429` with `error:"active_reservation_limit"`. Every value below can be overridden with the env variable; a missing or invalid value uses the default.

| Env variable | Default | Applies to |
| --- | --- | --- |
| `RATE_LIMIT_OTP_PER_IP_HOUR` | `10` | `POST /api/auth/request` per client IP per hour, in addition to the per-mobile OTP limits |
| `RATE_LIMIT_SETUP_PER_IP_DAY` | `5` | `POST /api/setup` (new café) per client IP per day |
| `RATE_LIMIT_RESERVATIONS_PER_IP_HOUR` | `10` | Public reservation create per client IP per café per hour |
| `MAX_ACTIVE_RESERVATIONS_PER_MOBILE` | `3` | Active (pending or confirmed) future public reservations per mobile per branch. Staff-created reservations are not capped |
| `SMS_DAILY_CAP_PER_CAFE` | `300` | Reservation SMS (confirmation and reminder) per café per day. Past the cap the booking still succeeds, and the message is logged with status `skipped` and error `daily_cap` |
| `CLIENT_IP_HEADER` | `CF-Connecting-IP` | Request header holding the client IP |

Days start at midnight Tehran time (UTC+03:30). Expired windows are deleted by the `scheduled` handler and, at most every ten minutes per isolate, on requests to `/api/cafes/…`.

`CLIENT_IP_HEADER` must name a header that the proxy in front of the app sets and overwrites. Otherwise clients can choose their own IP. For a comma-separated list such as `X-Forwarded-For`, the right-most entry is used. Requests with a missing or malformed IP share one `unknown` client, so they are limited together rather than skipped.

### Regression tests

Use Node.js 22.13+ (Node 24 recommended):

```bash
npm test
npm run validate
```

The API regression cases run the **built Worker** and all migrations against an isolated SQLite database with a transactional D1-shaped adapter. `tests/floor-studio.test.mjs` imports the floor-studio modules directly and runs without a browser. The API cases cover two-café authorization, bound OTPs, concurrent reservations, arbitrary overlapping starts, buffer boundaries, map spaces, closed/inactive tables, status permissions, and payment/cancel/refund races. `tests/abuse-protection.test.mjs` covers the limits above, concurrency at each limit's edge, and applying `0014` to an existing database. They do not substitute for browser/mobile visual testing or a staging test on hosted D1/Kavenegar/a real gateway.
