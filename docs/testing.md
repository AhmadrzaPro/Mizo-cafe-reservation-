# Testing

Use Node.js 22.13 or newer (Node 24 recommended).

## Unit and API tests

```bash
npm test
```

`npm test` builds, then runs `tests/*.test.mjs` with `node:test`. The API tests drive the **built Worker** with every migration applied to an in-memory SQLite database behind a D1-shaped adapter, so each test starts from an empty, isolated database.

New API tests should use the shared fixture in `tests/helpers/worker.mjs`: `setupCafe`, `login`, `staffSession`, `book` and `setStatus`.

| File | Covers |
| --- | --- |
| `booking-integrity.test.mjs` | Two-café authorization, bound sign-in codes, concurrent and overlapping bookings, buffers, map spaces, closed and inactive tables, status permissions, payment, cancel and refund races |
| `abuse-protection.test.mjs` | Every rate limit, concurrency at each limit's edge, and migration `0014` on an existing database |
| `modules.test.mjs` | Staff, branches, loyalty, payments, reports, SMS, subscription and the SaaS console, each with the roles that may and may not use it |
| `payment-gateway.test.mjs` | ZarinPal deposits end to end against a fake ZarinPal: cancelled, rejected, unreachable, expired and repeated callbacks |
| `subscription-card.test.mjs` | Card-to-card subscription payments, from report to approval, rejection and period extension |
| `subscription-expiry.test.mjs` | Ended trials and periods, the grace period, paused booking and reopening on payment |
| `subscription-required.test.mjs` | Migration `0017`: a trial for cafés without a subscription |
| `sessions.test.mjs` | Last use, devices, signing out everywhere, deactivation and cleanup |
| `maintenance.test.mjs` | Background work on requests, and its throttling |
| `time-formats.test.mjs` | Every stored instant is ISO UTC, reminder times, migration `0018`, and Tehran-clock display |
| `openapi.test.mjs` | `docs/openapi.yaml` documents exactly the routes the API serves, and its references resolve |
| `configuration-docs.test.mjs` | Every environment variable the Worker reads is in `docs/configuration.md` and `.env.example` |
| `html.test.mjs` | Escaping in the `html` tag |
| `floor-studio.test.mjs` | Floor-studio furniture, undo and redo, zoom and gestures, without a browser |
| `static-assets.test.mjs` | Hashed asset URLs, caching headers and the CSP |

## Browser tests

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

`npm run test:e2e` builds, then drives the Worker in Chromium with Playwright at desktop and phone size. `e2e/server.mjs` serves the build on Node with an in-memory database, demo sign-in codes and a fake ZarinPal; it is never deployed. The tests cover:

- **Customers:** booking and tracking; the mobile never appears in a URL.
- **Page modes:** a café's booking page and the Mizo introduction.
- **Staff:** signing in with a code through the dialog, every admin panel and its controls, slow loads that must not overwrite edits, and signing out everywhere.
- **Payments:** a ZarinPal deposit through to the return page.
- **Subscriptions:** a card-to-card payment approved in the SaaS console, and booking paused after the grace period.

Any script error, console error or CSP violation fails a test.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on `main`:

- **`check`:** lint (ESLint and the stylesheet check), type check, format check, unit and API tests, and build validation.
- **`e2e`:** the browser tests, keeping the Playwright report when they fail.

None of this replaces a staging test against hosted D1, Kavenegar and a real payment gateway.
