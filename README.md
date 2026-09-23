# Mizo — Café Table Reservation

A Persian, right-to-left table reservation experience for cafés, built as a Cloudflare Worker with D1 persistence. The project combines a customer booking flow, a branch-specific floor map editor, and a café operations dashboard.

## Highlights

- Customer flow: Jalali dates, available time slots, table selection, tracking and cancellation.
- Café operations: reservations, walk-in table locks, waitlist, branch settings and opening hours.
- Floor editor: indoor and outdoor areas, draggable tables, image-based manual tracing, and a reviewable draft before publication.
- Team roles: owner, branch manager, reception and barista with branch-scoped access.
- Optional integrations: Kavenegar SMS and OpenAI image analysis. Without credentials, the app uses its demo SMS mode and manual map tracing.
- Demo payment and optional subscription UI. These do not process real money.

## Structure

| Path | Purpose |
| --- | --- |
| `web/` | RTL customer experience and management UI |
| `worker/` | API, access checks and Worker entry point |
| `db/`, `drizzle/` | Schema and D1 migrations |
| `scripts/` | Asset embedding and build validation |

## Build

Requires Node.js 20 or newer.

```bash
npm run build
npm run validate
```

The build emits `dist/server/index.js` and embeds the web assets. For hosting with Sites, create your own Site and replace `YOUR_SITE_PROJECT_ID` in `.openai/hosting.json`. The logical D1 binding is `DB`. Runtime credentials must be set as host secrets, never committed.

Optional runtime secrets: `KAVENEGAR_API_KEY`, `KAVENEGAR_TEMPLATE`, `KAVENEGAR_CONFIRMATION_TEMPLATE`, `KAVENEGAR_REMINDER_TEMPLATE`, and `OPENAI_API_KEY`. The image model may be overridden with `MAP_VISION_MODEL`.

## Demo scope

The OTP flow displays a code when Kavenegar is not configured, and payment actions are simulated. Do not expose management routes as a public production service with demo OTP enabled. The automatic image analysis button appears only when an OpenAI key is configured.

## Notes

The café owner reviews the map before publication. Existing reservation history prevents deletion of referenced tables. Dates in the UI use the Persian calendar; stored dates remain ISO formatted.
