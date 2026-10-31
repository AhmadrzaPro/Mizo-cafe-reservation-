# Mizo — Café Table Reservation

A Persian, right-to-left table reservation experience for cafés, built as a Cloudflare Worker with D1 persistence. The project combines a customer booking flow, a branch-specific floor map editor, and a café operations dashboard.

## Highlights

- Customer flow: Jalali dates, available time slots, table selection, tracking and cancellation.
- Café operations: reservations, walk-in table locks, waitlist, branch settings and opening hours.
- Floor editor: indoor and outdoor areas, draggable tables, image-based manual tracing, and a reviewable draft before publication.
- Team roles: owner, branch manager, reception and barista with branch-scoped access.
- Optional integrations: Kavenegar SMS and OpenAI image analysis. Manual map tracing remains available without OpenAI. Demo SMS requires explicit `DEMO_MODE=true`.
- Deposits through ZarinPal (or simulated in demo mode), and an optional café subscription paid to the platform card to card.

## Structure

| Path | Purpose |
| --- | --- |
| `web/index.html`, `web/assets/` | Page markup and images |
| `web/css/main/`, `web/css/editor/`, `web/css/saas/` | Stylesheets by feature. Each folder is served as one file (`/styles.css`, `/editor.css`, `/saas-admin.css`), its files joined in name order, so later files override earlier ones |
| `web/src/` | Frontend ES modules; `main.js` wires the page and calls `initializeApp()` |
| `web/src/state.js` | Shared frontend state: the booking `state` and the mutable `store` |
| `web/src/floor/` | Floor studio: furniture, undo/redo history, geometry, zoom and gestures |
| `web/saas-admin.*` | SaaS admin page (served as-is) |
| `worker/src/` | Worker modules grouped by domain (auth, setup, branches, map, availability, reservations, operations, payments, loyalty, subscription, SMS, notifications, SaaS admin, static assets) |
| `worker/src/index.js` | Worker entry: Hono API router with auth/permission middleware, `fetch` and `scheduled` |
| `worker/src/schemas.js` | Zod (`zod/mini`) request-body schemas for the public endpoints |
| `worker/src/types.d.ts` | `Env`, `Staff` and `Branch` types for JSDoc annotations |
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

1. `scripts/embed-assets.mjs` bundles `web/src/main.js` with esbuild into a single IIFE script (served as `/app.js`, the only script on the page). It writes that bundle, the HTML, the CSS, the hero image and the Vazirmatn font into `dist/server/site-content.js`, with a content hash per asset. The pages reference every asset as `path?v=<hash>`.
2. `scripts/bundle.mjs` bundles `worker/src/index.js` with esbuild into a single ESM file at `dist/server/index.js`. `./site-content.js` stays an external import.
3. `scripts/build.sh` copies the hosting manifest and migrations into `dist/.openai/`.

`npm run typecheck` type-checks the JavaScript with TypeScript (`tsc`, no build step): all of `worker/src` with `strictNullChecks` (`tsconfig.json`) and all of `web/src` (`web/tsconfig.json`). Look up page elements with `byId("id")` from `web/src/dom.js`: its type comes from `web/src/element-ids.d.ts`, generated from `web/index.html` by `node scripts/element-types.mjs`, so a misspelt or removed id fails the type check. After adding or renaming an id in the page, run that script; `typecheck` fails while the file is out of date. `npm run lint` runs ESLint, `npm run format` formats the sources with Prettier and `npm run format:check` verifies formatting. GitHub Actions (`.github/workflows/ci.yml`) runs lint, type check, format check, tests and build validation on every pull request and on `main`.

### Static assets, caching and CSP

- The Vazirmatn variable font (OFL) comes from the pinned `vazirmatn` npm package and is served from `/fonts/vazirmatn.woff2`. The pages load nothing from Google Fonts or any other origin.
- A URL carrying the current `?v=<hash>` is cached as `public, max-age=31536000, immutable`. A changed file gets a new hash, so a deploy never serves stale CSS or JS. The page itself and unversioned asset URLs revalidate with an `ETag` (`304 Not Modified` when unchanged).
- Pages send a `Content-Security-Policy` that allows scripts, fonts and API calls only from the same origin, plus `nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS. `style-src` keeps `'unsafe-inline'` because rendered markup positions elements with `style` attributes. Do not add inline `<script>` blocks or `on…=` handler attributes; the CSP blocks them.

### Cloudflare Workers

`wrangler.toml` deploys the same build to Cloudflare Workers with a D1 database and a five-minute cron for the `scheduled` handler. `.env.example` lists every runtime variable.

```bash
npx wrangler d1 create mizo
```

Put the printed id in `database_id`, then apply migrations and run locally (copy `.env.example` to `.dev.vars` and set `DEMO_MODE=true` for local OTP codes):

```bash
npx wrangler d1 migrations apply mizo --local
```

```bash
npx wrangler dev
```

Deploy with `npx wrangler d1 migrations apply mizo --remote` and `npx wrangler deploy`, and set secrets with `npx wrangler secret put KAVENEGAR_API_KEY`. For a database whose migrations were applied by another tool, Wrangler has no record of them: do not run `migrations apply` against it without first recording the applied files in its `d1_migrations` table.

 For hosting with Sites, create your own Site and replace `YOUR_SITE_PROJECT_ID` in `.openai/hosting.json`. The logical D1 binding is `DB`. Runtime credentials must be set as host secrets, never committed.

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
- Public tracking supports lookup, cancellation and payment; staff status changes are only accepted by the authenticated operations API. Lookup is `POST /api/reservations/<code>` with `{mobile}` in the body, so the mobile never appears in URLs, access logs or browser history.
- Date, operating hours, table operational state and indoor/outdoor visibility are validated on the server. Moving a reservation preserves the old reservation if the new interval conflicts.
- Demo payment/refund transitions use conditional transactional writes. Cancellation cannot be reversed by payment; duplicate payment/refund requests cannot record a second transaction. Payment respects manual confirmation.

### SaaS console

`/saas-admin` and `/api/saas/overview` identify the platform owner by the `oai-authenticated-user-id` header, and the first such user becomes the SaaS admin. That header is trusted only with `SAAS_ADMIN_AUTH=oai-header`, which must be set only on a host that authenticates users and sets the header itself (Sites). **Existing Sites deployments must add `SAAS_ADMIN_AUTH=oai-header` to keep the console.** Without it, for example on plain Cloudflare Workers, the console is closed (403), because any client could send that header.

### Runtime modes

Demo behavior is now **explicit**: set `DEMO_MODE=true` only in an isolated demonstration deployment. This exposes test OTPs and simulates deposits/refunds/subscription renewal. Never use this mode with real customer data.

With `DEMO_MODE` absent, missing Kavenegar configuration returns a clear error instead of exposing an OTP. Reservation messages report failed delivery if their SMS templates are missing. Deposits need a payment gateway (see *Online deposits* below): without one, and outside demo mode, deposit-enabled public booking returns `payment_not_configured`. Ordinary bookings work without payments.

### Online deposits (ZarinPal)

| Env variable | Value |
| --- | --- |
| `PAYMENT_GATEWAY` | `zarinpal` |
| `ZARINPAL_MERCHANT_ID` | The merchant ID from the ZarinPal panel (secret) |
| `ZARINPAL_SANDBOX` | `true` to use `sandbox.zarinpal.com` for testing; leave unset in production |

When a gateway is configured it is used even with `DEMO_MODE=true`.

1. **Start.** "Pay deposit" calls `POST /api/reservations/<code>/pay`. The Worker requests a payment for the reservation's stored deposit (rials, `IRR`), records it in `payment_attempts` and returns `redirectUrl`. The page sends the customer to ZarinPal. The table stays held for at least 10 more minutes so they can finish at the bank.
2. **Return.** ZarinPal returns the customer to `GET /api/payments/zarinpal/callback?Authority=…&Status=OK|NOK`. The Worker claims the attempt once, then verifies the payment with the amount stored on the server, never one from the URL.
3. **Outcome.** A verified payment marks the deposit paid and confirms the reservation (or leaves it for manual confirmation), records the ZarinPal reference and sends the confirmation SMS. The customer is redirected to `/?cafe=…&code=…&payment=success|late|pending|failed`, where the tracking dialog shows the result.
4. **Failure cases:**
   - **Cancelled at the bank, rejected by ZarinPal, or the hold already expired:** the payment is not verified, so ZarinPal returns the money to the customer by itself.
   - **ZarinPal unreachable during verification:** the result is `pending`, and opening the same callback again retries.
   - **Hold released while the money was being verified (`late`):** the payment is recorded on the cancelled reservation so staff can refund it.
5. **Refunds.** ZarinPal refunds are made from the ZarinPal panel. "Refund" in the payments dialog then records it (provider `manual`) and cancels the reservation.

### Subscription payments (card to card)

Cafés pay their monthly subscription to the platform owner by card transfer. Set `SUBSCRIPTION_CARD_NUMBER` (16 digits, Luhn-checked) and optionally `SUBSCRIPTION_CARD_HOLDER`. `wrangler.toml` sets the platform card.

1. **Paying.** With the subscription on, the owner's subscription dialog shows the card and one month's fee (active branches × the per-branch price). The owner transfers it and submits the bank reference (and optionally the last 4 card digits) through `POST /api/subscription/card-transfer`. Only one transfer per café can wait for review at a time.
2. **Reviewing.** The SaaS console lists transfers awaiting review, flagging a bank reference used more than once. Approve or reject each one through `POST /api/saas/payments/<id>/approve|reject`:
   - **Approve:** sets the subscription active and extends the paid period by 30 days, from today or from the current period's end if that is later.
   - **Reject:** records the rejection in the café's subscription history.

**When a period ends unpaid.** A trial (14 days) or paid period (30 days) that ends without payment makes the subscription `past_due` at once. The scheduled job records the change and adds an "expired" entry to the café's history.

- **Grace (3 days):** the owner's panel shows a warning with the grace end date and a "Pay subscription" button. Booking stays open.
- **After the grace:** public online booking pauses. The booking page reads "booking temporarily paused" and `POST …/reservations` returns `409 online_booking_paused`. The staff panel, existing reservations, tracking and phone/walk-in bookings keep working.
- **Reopening:** approving a payment in the SaaS console reopens booking at once.

An owner cannot switch the subscription off while it is past due. Cafés without a subscription, and cafés the SaaS admin set active without an end date, never pause. The SaaS console shows past-due and paused cafés.

Customer deposits do not use card to card: with many cafés, transfers to each café's card cannot be matched to who paid, so deposits go through the gateway.

Before going live, make one sandbox payment end to end: set `ZARINPAL_SANDBOX=true`, enable deposits for a branch, book and pay. Then remove `ZARINPAL_SANDBOX` and set the production merchant ID.

### Upgrade an existing database

1. Back up the database. Review any pre-existing overlapping active reservations; this migration does not silently cancel or rewrite them.
2. Apply migrations in order through `0012_tenant_booking_integrity.sql` before serving the new Worker. Existing OTP challenges are invalidated; existing cafés, reservations and sessions are preserved.
3. Cafés that already have owners keep them. For a legacy café without staff, provision its verified owner's mobile in `staff_members` through a trusted administrative migration; public login deliberately cannot claim it.
4. Distribute the explicit café URL, and configure Kavenegar or isolated demo mode as appropriate. No implicit global-café fallback remains.
5. Do not mix an older Worker with the new triggers. The English-edition branch is separate and must receive the same backend/contract changes before its deployment is upgraded.
6. Apply `0014_rate_limits.sql` before serving a Worker with abuse protection. It only adds the `rate_limits` table and does not change existing data.
7. Apply `0015_payment_attempts.sql` before serving a Worker with gateway payments. It only adds the `payment_attempts` table.
8. Apply `0016_subscription_payments.sql` before serving a Worker with card-to-card subscription payments. It only adds the `subscription_payments` table.

### Abuse protection

Limits are counted in the `rate_limits` table with one atomic upsert per check, so concurrent requests cannot both take the last slot. Blocked requests return `429` with `{error:"rate_limited", message:"…"}`. The active-reservation cap returns `429` with `error:"active_reservation_limit"`. Every value below can be overridden with the env variable; a missing or invalid value uses the default.

| Env variable | Default | Applies to |
| --- | --- | --- |
| `RATE_LIMIT_OTP_PER_IP_HOUR` | `10` | `POST /api/auth/request` per client IP per hour, in addition to the per-mobile OTP limits |
| `RATE_LIMIT_OTP_VERIFY_PER_IP_HOUR` | `30` | `POST /api/auth/verify` per client IP per hour, in addition to the five attempts per OTP challenge |
| `RATE_LIMIT_TRACKING_PER_IP_HOUR` | `30` | Public tracking lookup, cancellation and payment (`/api/reservations/<code>…`) per client IP per hour, counting misses |
| `RATE_LIMIT_SETUP_PER_IP_DAY` | `5` | `POST /api/setup` (new café) per client IP per day |
| `RATE_LIMIT_RESERVATIONS_PER_IP_HOUR` | `10` | Public reservation create per client IP per café per hour |
| `MAX_ACTIVE_RESERVATIONS_PER_MOBILE` | `3` | Active (pending or confirmed) future public reservations per mobile per branch. Staff-created reservations are not capped |
| `SMS_DAILY_CAP_PER_CAFE` | `300` | Reservation SMS (confirmation and reminder) per café per day. Past the cap the booking still succeeds, and the message is logged with status `skipped` and error `daily_cap` |
| `CLIENT_IP_HEADER` | `CF-Connecting-IP` | Request header holding the client IP |

Days start at midnight Tehran time (UTC+03:30). Expired windows are deleted by the `scheduled` handler and, at most every ten minutes per isolate, on requests to `/api/cafes/…`.

### Staff sessions

A staff sign-in lasts 7 days, in an HttpOnly, Secure, SameSite=Strict cookie that stores only a hash of the token server-side.

- **Last use** is recorded at most every five minutes.
- **Devices:** `GET /api/auth/sessions` lists the signed-in member's devices. `POST /api/auth/logout-all` signs them out everywhere; the admin panel offers it next to "Sign out" and shows the device count when there is more than one.
- **Deactivation:** deactivating a staff member deletes their sessions.
- **Cleanup:** expired sessions and OTP challenges are removed by the background work below.

### Background work without a cron

The `scheduled` handler sends due SMS reminders, expires unpaid deposit holds and ended subscriptions, and cleans up rate-limit windows. Hosts without a cron trigger never call it, so `GET /api/cafes/…` requests also run this work in the background, throttled per isolate (`worker/src/maintenance.js`):

- due reminders at most once a minute
- rate-limit, session and OTP cleanup, and subscription expiry, at most every ten minutes

A failure is logged and never affects the request that triggered it.

`CLIENT_IP_HEADER` must name a header that the proxy in front of the app sets and overwrites. Otherwise clients can choose their own IP. For a comma-separated list such as `X-Forwarded-For`, the right-most entry is used. Requests with a missing or malformed IP share one `unknown` client, so they are limited together rather than skipped.

### API errors

Errors are JSON `{error, message?}`. A body that is not a JSON object returns `400` with `error:"invalid_json"`. On the public endpoints (OTP request and verify, café setup, public booking, tracking cancel/pay) a field with the wrong type or size returns `400` with `error:"invalid_request"` and `fields`; business rules keep their own error codes. An unsupported method on an existing route returns `405`. An unexpected failure is logged and returns `500` with `error:"internal_error"`; `503` is reserved for an unavailable dependency (database binding, SMS, payment gateway).

### Browser tests (end to end)

`npm run test:e2e` builds the Worker and drives it in Chromium with Playwright, at desktop and phone size. `e2e/server.mjs` serves the build on Node with an in-memory SQLite D1, demo OTP and a fake ZarinPal; it is never deployed. The tests cover:

- **Customer:** booking and tracking. The mobile never appears in a URL.
- **Page modes:** a café's booking page versus the Mizo introduction.
- **Staff:** owner OTP sign-in through the dialog and every admin panel, then signing out everywhere.
- **Payments:** a ZarinPal deposit through to the return page.
- **Subscriptions:** a card-to-card payment approved in the SaaS console, and booking paused after the grace period.

A test fails on any script error, console error or CSP violation. CI runs it as a separate `e2e` job and keeps the report when it fails. Locally the browser comes from Playwright: run `npx playwright install chromium` once.

### Regression tests

Use Node.js 22.13+ (Node 24 recommended):

```bash
npm test
npm run validate
```

The API regression cases run the **built Worker** and all migrations against an isolated SQLite database with a transactional D1-shaped adapter. `tests/floor-studio.test.mjs` imports the floor-studio modules directly and runs without a browser. The API cases cover two-café authorization, bound OTPs, concurrent reservations, arbitrary overlapping starts, buffer boundaries, map spaces, closed/inactive tables, status permissions, and payment/cancel/refund races. `tests/abuse-protection.test.mjs` covers the limits above, concurrency at each limit's edge, and applying `0014` to an existing database. `tests/subscription-expiry.test.mjs` covers ended trials and periods, the grace period, paused booking and reopening on payment. `tests/subscription-card.test.mjs` covers card-to-card subscription payments from submission to approval, rejection and period extension. `tests/payment-gateway.test.mjs` runs ZarinPal deposits end to end against a fake ZarinPal, including cancelled, rejected, unreachable, expired and duplicate callbacks. `tests/modules.test.mjs` covers staff, branches, loyalty, payments, reports, SMS, subscription and the SaaS console, each with the roles that may and may not use it. New API tests should use the shared fixture in `tests/helpers/worker.mjs` (`setupCafe`, `login`, `staffSession`, `book`, `setStatus`). They do not substitute for browser/mobile visual testing or a staging test on hosted D1/Kavenegar/a real gateway.
