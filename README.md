# Mizo — Café Table Reservation

A Persian, right-to-left table reservation platform for cafés, built as a Cloudflare Worker with D1 persistence. Each café gets a customer booking page, a floor-map editor, a live operations dashboard and a staff panel; the platform owner runs a console for subscriptions.

## Highlights

- **Customers:** Jalali dates, free time slots, table choice on the floor map, tracking and cancellation, and deposits through ZarinPal.
- **Operations:** reservations, walk-ins, waitlist, table status, opening hours and closures.
- **Floor editor:** indoor and outdoor areas, draggable tables, tracing from a photo, and a draft reviewed before publication.
- **Team:** owner, branch manager, reception and barista, each limited to their branch and permissions.
- **Integrations:** Kavenegar SMS for sign-in codes, confirmations and reminders; optional OpenAI floor-plan analysis.
- **Platform:** a required monthly subscription per café, paid card to card and approved in the SaaS console.

## Quick start

Requires Node.js 22.13 or newer (Node 24 recommended).

```bash
npm install
```

```bash
cp .env.example .dev.vars
```

Set `DEMO_MODE=true` in `.dev.vars`, so sign-in codes are shown on screen and payments are simulated. Then create the local database and start the Worker:

```bash
npx wrangler d1 migrations apply mizo --local
```

```bash
npx wrangler dev
```

Wrangler runs `npm run build` first (`wrangler.toml`).

Open `/?new=1` to create a café. Its booking page is `/?cafe=<slug>`.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/configuration.md](docs/configuration.md) | Every environment variable, runtime modes and abuse-protection limits |
| [docs/deployment.md](docs/deployment.md) | Deploying to Cloudflare Workers or Sites, migrations, upgrading an existing database, caching and CSP |
| [docs/payments.md](docs/payments.md) | Customer deposits through ZarinPal, and café subscriptions paid card to card |
| [docs/architecture.md](docs/architecture.md) | How the code is organised, tenancy and booking rules, sessions, times, background work |
| [docs/testing.md](docs/testing.md) | Unit, API and browser tests, and the checks CI runs |
| [docs/openapi.yaml](docs/openapi.yaml) | The HTTP API (OpenAPI 3.1): every route, its access, body and error codes |
| [CHANGELOG.md](CHANGELOG.md) | What changed, and what each release needs on deploy |

To browse the API reference, run `npx @redocly/cli preview-docs docs/openapi.yaml`.

## Scripts

| Command | Does |
| --- | --- |
| `npm run build` | Bundles the Worker and the page into `dist/` |
| `npm test` | Builds, then runs the unit and API tests |
| `npm run test:e2e` | Builds, then runs the browser tests in Chromium |
| `npm run lint` | ESLint, and a check that stylesheets use no `!important` |
| `npm run typecheck` | TypeScript over the JavaScript, no build step |
| `npm run format` / `format:check` | Prettier |
| `npm run validate` | Checks the build output |

## Structure

| Path | Purpose |
| --- | --- |
| `web/index.html`, `web/assets/` | Page markup and images |
| `web/src/` | Frontend ES modules, bundled into one script |
| `web/css/main/`, `web/css/editor/`, `web/css/saas/` | Stylesheets by feature; each folder is served as one file |
| `web/saas-admin.*` | The SaaS console page |
| `worker/src/` | The Worker: `index.js` (entry), `api.js` (routes), and one module per domain |
| `db/schema.ts`, `drizzle/` | Database schema and D1 migrations |
| `scripts/` | Build, bundling and checks |
| `tests/`, `e2e/` | Unit and API tests; browser tests |
| `docs/` | Documentation and the OpenAPI document |
