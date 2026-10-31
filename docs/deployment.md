# Deployment

The build is one Worker that serves both the API and the page. `npm run build` writes it to `dist/server/index.js`, with every web asset embedded, and copies the migrations to `dist/.openai/drizzle/`.

## Cloudflare Workers

`wrangler.toml` deploys the build with a D1 database and a five-minute cron for the `scheduled` handler.

```bash
npx wrangler d1 create mizo
```

Put the printed id in `database_id` in `wrangler.toml`, then apply the migrations and deploy:

```bash
npx wrangler d1 migrations apply mizo --remote
```

```bash
npx wrangler deploy
```

Set secrets one by one, for example:

```bash
npx wrangler secret put KAVENEGAR_API_KEY
```

See [configuration.md](configuration.md) for every variable. Leave `SAAS_ADMIN_AUTH` unset on plain Workers.

Wrangler records applied migrations in the `d1_migrations` table. For a database whose migrations were applied by another tool, record those files there first, or `migrations apply` will run them again.

## Sites

Create your own Site and replace `YOUR_SITE_PROJECT_ID` in `.openai/hosting.json`. The D1 binding is `DB`. Set runtime credentials as host secrets, and set `SAAS_ADMIN_AUTH=oai-header` to open the SaaS console.

Sites has no cron. The Worker instead runs the scheduled work in the background of café API requests (see [architecture.md](architecture.md#background-work)).

## Before going live

- Configure Kavenegar, and leave `DEMO_MODE` unset.
- Make one ZarinPal sandbox payment end to end (see [payments.md](payments.md#before-going-live)).
- Give customers and staff the café's own URL, `/?cafe=<slug>`. There is no global default café unless `DEFAULT_CAFE_SLUG` is set.

## Upgrading an existing database

Back up the database first. Apply every migration in `drizzle/` in order, before serving the new Worker, and never run an older Worker against a newer database. [CHANGELOG.md](../CHANGELOG.md) lists what each release's migrations do.

Migrations with effects beyond adding tables:

| Migration | Effect |
| --- | --- |
| `0012_tenant_booking_integrity.sql` | Adds triggers that reject overlapping reservations. Review overlapping active reservations first; they are not cancelled or rewritten. Invalidates pending sign-in codes. |
| `0017_required_subscription.sql` | Cafés without a subscription, or with it off, get a 14-day trial from that moment. Running trials and paid periods are unchanged. |
| `0018_iso_instants.sql` | Rebuilds `otp_challenges` and `staff_sessions` with ISO-8601 text times and converts SMS reminder times to UTC. Staff stay signed in. |

A café created before owners were recorded (before `0012`) has no staff. Provision its verified owner's mobile in `staff_members` through a trusted administrative migration; public sign-in deliberately cannot claim it.

## Caching and Content Security Policy

- Each asset URL carries a content hash (`/app.js?v=<hash>`) and is cached for a year as `immutable`. A changed file gets a new hash, so a deploy never serves stale CSS or JS. The page itself, and asset URLs without the current hash, revalidate with an `ETag` (`304 Not Modified` when unchanged).
- The Vazirmatn font (OFL) comes from the pinned `vazirmatn` package and is served from `/fonts/vazirmatn.woff2`. The page loads nothing from another origin.
- Pages send a `Content-Security-Policy` that allows scripts, fonts and API calls only from the same origin, plus `nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS. `style-src` keeps `'unsafe-inline'` because the floor map positions elements with `style` attributes. Do not add inline `<script>` blocks or `on…=` attributes; the policy blocks them.
