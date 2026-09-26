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
| `web/` | RTL customer experience and management UI |
| `worker/` | API, access checks and Worker entry point |
| `db/`, `drizzle/` | Schema and D1 migrations |
| `scripts/` | Asset embedding and build validation |

## Build

Requires Node.js 22.13 or newer (Node 24 recommended).

```bash
npm run build
npm run validate
```

The build emits `dist/server/index.js` and embeds the web assets. For hosting with Sites, create your own Site and replace `YOUR_SITE_PROJECT_ID` in `.openai/hosting.json`. The logical D1 binding is `DB`. Runtime credentials must be set as host secrets, never committed.

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

### Regression tests

Use Node.js 22.13+ (Node 24 recommended):

```bash
npm test
npm run validate
```

The 25 API regression cases run the **built Worker** and all migrations against an isolated SQLite database with a transactional D1-shaped adapter. They cover two-café authorization, bound OTPs, concurrent reservations, arbitrary overlapping starts, buffer boundaries, map spaces, closed/inactive tables, status permissions, and payment/cancel/refund races. They do not substitute for browser/mobile visual testing or a staging test on hosted D1/Kavenegar/a real gateway.
