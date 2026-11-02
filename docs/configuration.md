# Configuration

Every setting is an environment variable. `.env.example` lists them all; copy it to `.dev.vars` for `wrangler dev`, and set each as a host variable or secret in production. Never commit real values.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB` | — | The D1 binding. Required. |
| `DEMO_MODE` | off | `true` shows sign-in codes on screen and simulates payments. See [Runtime modes](#runtime-modes). |
| `DEFAULT_CAFE_SLUG` | — | The café shown at `/` when the URL has no `?cafe=`. |
| `KAVENEGAR_API_KEY` | — | Kavenegar SMS account (secret). |
| `KAVENEGAR_TEMPLATE` | — | Kavenegar template for sign-in codes. |
| `KAVENEGAR_CONFIRMATION_TEMPLATE` | — | Template for booking confirmations. |
| `KAVENEGAR_REMINDER_TEMPLATE` | — | Template for booking reminders. |
| `PAYMENT_GATEWAY` | — | `zarinpal` to take deposits online. See [payments.md](payments.md). |
| `ZARINPAL_MERCHANT_ID` | — | The merchant ID from the ZarinPal panel (secret). |
| `ZARINPAL_SANDBOX` | off | `true` uses `sandbox.zarinpal.com`. |
| `SUBSCRIPTION_CARD_NUMBER` | — | The platform's 16-digit card, shown to café owners paying their subscription. |
| `SUBSCRIPTION_CARD_HOLDER` | — | The card holder's name shown beside it. |
| `SAAS_ADMIN_AUTH` | — | `oai-header` opens the SaaS console. See [SaaS console](#saas-console). |
| `OPENAI_API_KEY` | — | Enables floor-plan photo analysis in the map editor (secret). Manual tracing works without it. |
| `MAP_VISION_MODEL` | `gpt-4.1-mini` | The model used for that analysis. |
| `VIRTUAL_CAFE` | off | `all`, or café slugs separated by commas, to offer the Virtual Cafe (3D table selection) to those cafés. Each branch's owner can still switch it off in the control centre. See [virtual-cafe/phase-2-report.md](virtual-cafe/phase-2-report.md). |
| `CLIENT_IP_HEADER` | `CF-Connecting-IP` | The request header holding the client IP. See [Client IP](#client-ip). |
| `RATE_LIMIT_…`, `MAX_…`, `SMS_DAILY_CAP_PER_CAFE` | see below | [Abuse protection](#abuse-protection) limits. |

## Runtime modes

**Production** (`DEMO_MODE` unset):

- Sign-in needs Kavenegar. Without it, requesting a code returns `503 sms_not_configured` instead of revealing a code.
- Booking messages whose template is missing are logged as failed.
- A branch that takes deposits needs a payment gateway. Without one, its public booking returns `503 payment_not_configured`. Bookings without a deposit work regardless.

**Demo** (`DEMO_MODE=true`): for an isolated demonstration only, never with real customers.

- The sign-in code is returned to the page.
- Deposits, refunds and subscription renewal are simulated, unless a gateway is configured, which is then used.
- SMS are logged as `demo_sent` instead of sent.

## SaaS console

`/saas-admin` and `/api/saas/…` identify the platform owner by the `oai-authenticated-user-id` header; the first such user becomes the owner. That header is trusted only with `SAAS_ADMIN_AUTH=oai-header`. Set it only on a host that authenticates users and sets the header itself (Sites). Anywhere else, such as plain Cloudflare Workers, leave it unset: the console answers `403`, because any client could send the header.

## Abuse protection

Each limit is counted in the `rate_limits` table with one atomic upsert per check, so concurrent requests cannot both take the last slot. A blocked request returns `429` with `error: "rate_limited"`. A missing or invalid value uses the default.

| Variable | Default | Limits |
| --- | --- | --- |
| `RATE_LIMIT_OTP_PER_IP_HOUR` | `10` | Sign-in code requests per client IP per hour, on top of one a minute and twenty an hour per mobile |
| `RATE_LIMIT_OTP_VERIFY_PER_IP_HOUR` | `30` | Code checks per client IP per hour, on top of five attempts per code |
| `RATE_LIMIT_TRACKING_PER_IP_HOUR` | `30` | Tracking lookups, cancellations and payments per client IP per hour, counting misses |
| `RATE_LIMIT_SETUP_PER_IP_DAY` | `5` | New cafés per client IP per day (and three an hour per owner mobile) |
| `RATE_LIMIT_RESERVATIONS_PER_IP_HOUR` | `10` | Public bookings per client IP per café per hour |
| `RATE_LIMIT_HOLDS_PER_IP_HOUR` | `30` | Table holds per client IP per hour; a client also holds at most two tables of a branch at once (`429 too_many_holds`) |
| `MAX_ACTIVE_RESERVATIONS_PER_MOBILE` | `3` | Active future public bookings per mobile per branch (`429 active_reservation_limit`). Staff bookings are not capped |
| `SMS_DAILY_CAP_PER_CAFE` | `300` | Booking SMS per café per day. Past it the booking still succeeds and the message is logged as `skipped` with error `daily_cap` |

Days start at midnight Tehran time (UTC+03:30).

## Client IP

`CLIENT_IP_HEADER` must name a header that the proxy in front of the app sets and overwrites; otherwise clients choose their own IP and escape the limits. For a comma-separated list such as `X-Forwarded-For`, the right-most entry is used. Requests with a missing or malformed IP share one `unknown` client, so they are limited together rather than skipped.
