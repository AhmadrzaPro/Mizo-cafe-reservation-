# Changelog

Notable changes, newest first. Each entry lists what a deploy needs under **Upgrade**.

## Unreleased

### Upgrade

- Apply migrations `0015` to `0018` together with the new Worker, and do not run the old Worker against the migrated database: it would misread session and sign-in code expiry. See [docs/deployment.md](docs/deployment.md#upgrading-an-existing-database).
  - `0015_payment_attempts.sql` and `0016_subscription_payments.sql` add tables.
  - `0017_required_subscription.sql` gives cafés without a subscription, or with it off, a 14-day trial.
  - `0018_iso_instants.sql` stores sign-in codes, sessions and reminder times as ISO UTC text.
- Sites deployments must set `SAAS_ADMIN_AUTH=oai-header` to keep the SaaS console.
- Set `SUBSCRIPTION_CARD_NUMBER` for subscription payments, and `PAYMENT_GATEWAY` and `ZARINPAL_MERCHANT_ID` for online deposits. Make one ZarinPal sandbox payment first.
- Cafés whose trial or paid period has already ended become past due on deploy, and their online booking pauses three days after the end date. Check the SaaS console first.
- API clients: tracking lookup moved from `GET /api/reservations/<code>?mobile=…` to `POST /api/reservations/<code>` with `{mobile}`, and SMS `scheduledAt` is now a UTC instant.

### Added

- Deposits through ZarinPal, verified on the server with the stored amount; refunds recorded from the payments dialog.
- Café subscriptions paid card to card to the platform and approved in the SaaS console. The subscription is required; an unpaid period gets 3 days of grace, then online booking pauses until payment.
- Staff sessions: last use, a device list, and signing out of every device. Deactivating a member ends their sessions.
- Per-IP limits on code verification and tracking.
- Browser tests with Playwright at desktop and phone size, run in CI.
- `docs/` with configuration, deployment, payments, architecture and testing guides, and `docs/openapi.yaml`, an OpenAPI 3.1 reference of every API route. A test fails when the routes and the reference disagree.
- `wrangler.toml` and `.env.example`.

### Changed

- The API runs on Hono with auth middleware; public endpoints validate their body with `zod/mini`. Unsupported methods answer `405`, a malformed body `400 invalid_json`, and unexpected failures `500 internal_error`.
- Every stored instant is ISO-8601 UTC text, and the panel shows times on Tehran's clock.
- Frontend markup is built only with the escaping `html` tag; ESLint forbids `innerHTML` and its relatives.
- The SaaS console is an ES module (`web/src/saas-console.js`) bundled like the main page, with the same escaping, linting and type checks. Its per-branch price comes from the server instead of being written into the page, and transfer times are shown in the Persian calendar on Tehran's clock.
- Stylesheets are split by feature; `!important` is gone outside `prefers-reduced-motion`, and lint rejects it.
- Assets carry content hashes and are cached as immutable; the Vazirmatn font is self-hosted; pages send a CSP, `Permissions-Policy` and HSTS.
- The whole Worker and frontend are type-checked with `strictNullChecks`; API answers kept by the page are typed in `web/src/types.d.ts`, and element lookups are typed from `web/index.html`.
- A café's page shows only its own data; without a café the page introduces Mizo.
- Background work also runs on café API requests, for hosts without a cron.

### Fixed

- The SaaS console trusted an identity header that any client could send.
- Handler failures that escaped error handling.
- The SMS panel showed send times in UTC, and instants were dated by the UTC day.
- Dialogs whose late-loading data overwrote edits.
- The map editor had a second, always-hidden "back" button for phones; it is removed, and a browser test checks the visible one at every size, including the question about unpublished changes.

### Security

- The tracking lookup no longer puts the customer's mobile in the URL.

## Stage 1 foundations

### Upgrade

- Apply `0014_rate_limits.sql`. It only adds the `rate_limits` table.

### Added

- Abuse protection: per-IP limits on sign-in codes, café setup and public booking; a cap on active bookings per mobile; a daily SMS budget per café. See [docs/configuration.md](docs/configuration.md#abuse-protection).

### Changed

- The Worker is split into domain modules under `worker/src` and the frontend into ES modules under `web/src`, both bundled with esbuild.
- Sources are formatted with Prettier.

## Large floors

### Upgrade

- Apply `0013_area_dimensions.sql`. It adds a width and height to each area, defaulting to the old fixed size.

### Added

- Each area has its own dimensions, and large floors pan and zoom in the editor, the booking page and the live floor.

## Tenant and booking integrity

### Upgrade

- Back up, review overlapping active reservations, then apply migrations through `0012_tenant_booking_integrity.sql`. Pending sign-in codes are invalidated; cafés, reservations and sessions are kept.
- A café without staff needs its verified owner's mobile added to `staff_members` by an administrative migration.
- Give customers and staff each café's own URL, `/?cafe=<slug>`.

### Changed

- Every booking page uses `/?cafe=<slug>`; `/` no longer picks the last-created café. `DEFAULT_CAFE_SLUG` can choose one café for `/`.
- `/?new=1` creates a café, and setup records the owner's mobile with the café, its branch and map. Only invited mobiles sign in afterwards; the first visitor can no longer claim a café.
- Sign-in codes are bound to their café and used once. Staff APIs check both café and branch.
- Database triggers reject overlapping reservations, buffer time included, at any start time.
- Dates, opening hours, table status and indoor/outdoor visibility are checked on the server. Moving a reservation onto a taken interval keeps it where it was.
- Payment, cancellation and refund are conditional writes: a cancelled reservation cannot be paid, and repeated requests record nothing twice.
- Demo mode is explicit (`DEMO_MODE=true`). Without it, missing SMS configuration is an error instead of showing the code.
