# Space Capture: integration plan

The [Space Capture document pack](spec/00-README-ROADMAP.md) asks for a café to be filmed on a phone, rebuilt as a 3D Gaussian Splat scene, and shown in the browser with the café's real tables bookable inside it. Its instructions to a coding agent start with: survey the repository, find the existing contracts, propose how the feature fits, and change nothing that does not need changing. This document is that step. No code has been changed.

The pack was written for a generic stack (PostgreSQL, Redis, a separate API server). Mizo is not that stack, and it already has a large part of what the pack asks for. Each section below says what the pack asks, what Mizo has, and what that means.

## 1. What Mizo already is

| Pack assumes | Mizo actually has | Source |
| --- | --- | --- |
| Main API server | One Cloudflare Worker serving the API (Hono) and the pages | `worker/src/index.js`, `worker/src/api.js` |
| PostgreSQL with Row-Level Security | Cloudflare D1 (SQLite). No RLS; tenancy is enforced in the API and by triggers | `db/schema.ts`, `drizzle/0012_tenant_booking_integrity.sql` |
| `tenant_id` + `cafe_id` + `branch_id` | A café **is** the tenant. Ids carry their scope: `cafe:<slug>`, `branch:<cafe>:<branch>`, `branch:<cafe>:<branch>:<table>` | `docs/virtual-cafe/current-architecture.md` |
| Redis or an existing queue | None. Background work is a 5-minute cron plus throttled work on requests | `wrangler.toml`, `worker/src/maintenance.js` |
| Object storage + CDN | None. All assets are embedded in the Worker bundle | `scripts/embed-assets.mjs` |
| A web viewer (PlayCanvas proposed) | A three.js 0.186 engine, lazy-loaded as `/virtual-cafe.js`, with walking controls, collision, table markers and a 2D fallback | `web/src/virtual-cafe/` |
| A `cafe_tables` table | Exists; tables are positioned on a 2D floor map at **40 px = 1 m** | `cafe_tables`, `web/src/virtual-cafe/config.js` |
| Concurrency-safe booking | Exists: `409 slot_taken`, overlap triggers, and 5-minute server-side **table holds** | `worker/src/reservations.js`, `worker/src/holds.js`, migration `0019` |
| Roles that may manage the space | `owner` and `branch_manager` have `map.write`; reception and barista do not | `worker/src/auth/session.js` |
| Content Security Policy | `script-src 'self'`, `connect-src 'self'`, `img-src 'self' data: blob:` | `worker/src/static.js` |

**The key fact:** the Virtual Cafe (Phases 0–2 in `docs/virtual-cafe/`) already delivers the pack's Phase 4 and most of its Phase 3 — except that its scene is generated from the floor map instead of filmed. Space Capture should therefore be built as **a new visual layer for the existing Virtual Cafe**, not as a second 3D system.

## 2. Decisions that change from the pack

These keep every rule the pack calls "final" (§ "تصمیم‌های معماری قطعی"), but express them in Mizo's stack.

### 2.1 Database: stay on D1

The pack itself forbids moving the database in the MVP. All new tables go into D1 through a new `drizzle/` migration.

- `tenant_id` is dropped: `cafe_id` is the tenant. Every new table has `cafe_id` and `branch_id` (a scene belongs to one branch, as the floor map does).
- RLS does not exist in SQLite. Isolation is enforced the way it already is: every query is scoped by the café and branch taken from the **route and the session**, never from the body; plus triggers where a cross-scope reference would be dangerous (for example, a `table_scene_positions.table_id` must belong to the scene's branch — the same shape as the existing `reservation_table_scope` trigger).

### 2.2 Tables and positions: reuse `cafe_tables`, derive positions from the map

The pack already says not to create a parallel table list. Mizo goes further: every table already has a position on the floor map. A reconstructed scene has an arbitrary origin, scale and rotation (COLMAP output), so rather than asking the owner to place every marker by hand:

1. Each `scene_version` stores **one alignment transform** (scale, rotation about the vertical axis, translation, floor height) from floor-map metres to scene coordinates.
2. The owner sets it by matching two or three points (for example the door and two table centres) between the 2D map and the 3D scene.
3. Every table's marker is then computed from its map position. `table_scene_positions` holds only **overrides** for tables that need nudging, plus the verification record.

A new table added in the map editor appears in 3D without anyone touching the scene. If a new scene version changes the coordinate system, only the transform is re-confirmed.

### 2.3 Collision: reuse the floor map first

The pack says a splat gives no collision, and accepts a simple floor-and-wall collision for the MVP. Mizo already has one: `engine/collision.js` keeps the visitor inside the room and out of tables and the counter, from the floor map. Through the alignment transform the same geometry works inside a filmed scene. A generated collision mesh becomes an improvement, not a blocker.

### 2.4 Storage: Cloudflare R2 (needs approval)

Videos and scene files cannot be embedded in the Worker. R2 is the natural store on this platform (no egress fees, a Worker binding). Key layout, following the pack without `tenant_id`:

```text
captures/{cafeSlug}/{branchSlug}/{captureId}/source.<ext>      private
processing/{cafeSlug}/{branchSlug}/{jobId}/...                 private, deleted after the job
scenes/{cafeSlug}/{branchSlug}/{sceneId}/{versionId}/...       immutable once written
```

**Upload.** Two options; this needs a decision before Phase 1:

- **(a) Presigned S3 URLs to R2** — the pack's preferred route: video bytes never pass through the Worker. Needs an R2 API token stored as Worker secrets.
- **(b) R2 multipart upload through the Worker binding** — no extra credentials; each part (e.g. 10 MB) goes through the Worker, and the multipart session makes the upload resumable. The pack allows this "if the infrastructure requires it".

Recommendation: **(b) for the MVP** — fewer secrets, resumable by design, and Workers' request size limit is not reached with 10 MB parts. Revisit if bandwidth through the Worker becomes a cost.

**Serving scenes.** Published scene files should be served **through the Worker** at a same-origin path (`/scenes/...`, `cache-control: immutable`) so the CSP stays `connect-src 'self'`. Each version's files are never overwritten (pack Phase 5).

### 2.5 Queue: a job table in D1, pulled by the GPU worker

The GPU worker runs outside Cloudflare (Workers have no GPUs). Instead of adding Redis, the job queue is the `scene_processing_jobs` table itself, and the GPU worker calls a small authenticated API:

- `POST /api/space-capture/worker/claim` — one conditional `UPDATE … WHERE status = 'queued' … RETURNING`, atomic in D1 (the same technique `holds.js` uses), giving the job a lease.
- `POST …/jobs/{id}/heartbeat`, `…/stage`, `…/complete`, `…/fail`.
- A job whose lease expires without a heartbeat is re-queued by the existing cron (`maintenance.js`), up to a retry limit.
- The worker gets short-lived R2 access only for that job's keys.

This gives the pack's idempotency, heartbeat, timeout and limited-retry rules with no new infrastructure. Cloudflare Queues can replace it later without changing the API contract. The worker's credential is a single secret (`SPACE_CAPTURE_WORKER_TOKEN`), never logged.

### 2.6 Viewer: evaluate inside the existing engine first

The pack proposes PlayCanvas / SuperSplat Viewer for the POC, but says the choice must be tested and that markers, camera limits and mobile behaviour matter. Mizo's engine already has the controls, collision, markers, table card, booking hand-off, adaptive resolution and 2D fallback, all tested (46 browser runs). Adding PlayCanvas would mean a second 3D engine and redoing all of that.

So Phase 0 should compare **two** candidates on the same scene file:

1. A Gaussian Splat renderer that plugs into three.js (for example Spark or GaussianSplats3D — licence, formats and mobile support to be checked at Phase 0, as the pack requires), drawn inside the existing engine.
2. PlayCanvas / SuperSplat Viewer, as the pack proposes.

Prefer (1) if it reaches the pack's mobile acceptance criteria; fall back to (2) only if it does not.

### 2.7 Feature switch

Space Capture sits behind its own platform variable (proposed `SPACE_CAPTURE`, same format as `VIRTUAL_CAFE`). A branch with a published scene shows the filmed scene inside the Virtual Cafe; every other branch keeps the generated scene. The generated scene stays as the fallback for weak devices and for failed loads.

## 3. Gaps the pack exposes in the current code

| Pack requirement | Status | Proposed fix (phase) |
| --- | --- | --- |
| Idempotency key for repeated booking submits (Phase 4) | **Missing.** A second booking of the same table is already refused by the overlap trigger, so nothing is booked twice. But if the first answer is lost to a network error and the customer retries, the retry gets `409 slot_taken` — the customer is told their own table is taken | Accept an `Idempotency-Key` header on public booking; store its hash with the reservation; a repeat returns the first answer. Small, independent of 3D, worth doing early |
| "Status unknown after a network error, ask the server" | Partly: the form shows an error; tracking needs the code | Return to availability on a network error and tell the customer to check their SMS / tracking before retrying |
| Retention and deletion of raw video (Phase 5) | Not applicable yet | Part of Phase 1 |
| Platform-operator panel separate from café panel (Phase 5) | Exists: the SaaS console (`/saas-admin`) | Add a Space Capture jobs tab there |

## 4. Proposed data model (D1)

Names follow the pack; types follow Mizo's conventions (text ids, ISO-8601 UTC instants, JSON as text).

| Table | Main columns | Notes |
| --- | --- | --- |
| `cafe_scenes` | `id`, `cafe_id`, `branch_id`, `name`, `status`, `active_version_id`, `created_by`, `created_at`, `updated_at` | One active scene per branch (unique partial index) |
| `scene_captures` | `id`, `cafe_id`, `branch_id`, `scene_id`, `storage_key`, `upload_id`, `original_filename`, `mime_type`, `size_bytes`, `sha256`, `duration_ms`, `width`, `height`, `fps`, `validation_status`, `validation_report`, timestamps | `validation_report` is JSON text |
| `scene_processing_jobs` | pack's columns + `lease_expires_at`, `heartbeat_at`, `max_retries` | Unique: one live job per capture |
| `scene_versions` | `id`, `cafe_id`, `branch_id`, `scene_id`, `version_number`, `status`, `alignment` (JSON transform), `quality_report`, `pipeline_version`, `published_at`, timestamps | Immutable after publish |
| `scene_assets` | pack's columns, `cafe_id`, `branch_id` | |
| `scene_anchors` | `id`, `scene_version_id`, `anchor_type`, `position`, `rotation`, `metadata` | Spawn point, camera views |
| `table_scene_positions` | `table_id` → `cafe_tables.id`, `scene_version_id`, `offset`, `rotation`, `verified_by`, `verified_at` | Overrides only (§2.2); trigger checks the table's branch |

`scene_zones` from the pack is **not** needed: Mizo's `areas` (indoor/outdoor rooms) already are the zones, and each table already belongs to one.

## 5. Phase-by-phase plan for this repository

Each phase is its own branch and pull request, and starts only after the previous one passes its acceptance criteria, as the pack requires.

### Phase 0 — Proof of concept (outside this repo's production code)

Cannot be done from this cloud environment: it needs a GPU, a real phone and a real video. What can be prepared here:

- A `space-capture/poc/` runbook and scripts: `ffprobe` report, frame extraction with a blur filter, COLMAP → Nerfstudio `splatfacto` → export, with every tool version recorded.
- A standalone viewer page (not shipped in the Worker) that loads one splat file in both candidates from §2.6, with an FPS / memory readout like `?vcdebug=1`.
- A results template matching the pack's required outputs (timings, GPU cost, phone results, Go/No-Go).

The current sample video (512×910, 30 fps, 53 s) is enough to test the pipeline end to end, not to judge quality, as the pack notes.

### Phase 1 — Capture and upload

- Migration: `cafe_scenes`, `scene_captures`. R2 binding `SPACE_CAPTURE_BUCKET`.
- Routes under `/api/cafes/{cafe}/branches/{branch}/scenes/…`, requiring `map.write`.
- Multipart upload (§2.4), `complete` that is safe to call twice, SHA-256 recorded.
- Server-side validation: real container/codec, size and duration limits from env vars (no hard-coded numbers). FFprobe cannot run inside a Worker, so the Worker checks the container signature and size, and the full FFprobe validation is the GPU worker's first stage, reported back before reconstruction starts.
- Admin UI in the map editor: capture guide, upload with progress and resume, validation result, replace capture.
- Tests: café A cannot see café B's captures; spoofed extension; oversized file; repeated `complete`; interrupted upload resumed.

### Phase 2 — Reconstruction

- Migration: `scene_processing_jobs`, `scene_versions`, `scene_assets`.
- Worker-facing API (§2.5), lease expiry in the cron.
- The GPU worker itself as a separate container image (own directory, own CI), versioned pipeline settings.
- Status shown in the admin UI; operator view in the SaaS console.

### Phase 3 — Viewer

- The renderer chosen in Phase 0 added to the engine bundle as its own lazy chunk, so the booking page's `app.js` does not grow.
- Scene files served from `/scenes/…` through the Worker (§2.4).
- Device profile → asset LOD; context-loss handling; fallback to the generated scene, then to 2D.

### Phase 4 — Tables and booking

- Alignment tool (§2.2) and per-table overrides in the admin UI; customer preview.
- Booking uses the existing hand-off unchanged (holds, `holdToken`, `409 slot_taken`).
- The idempotency key from §3, if not done earlier.

### Phase 5 — Release and operations

- Approve → publish switches `active_version_id` in one statement; rollback is the same switch backwards.
- Metrics per job (GPU seconds, sizes, retries) recorded on the job row, summed per café in the SaaS console.
- Retention: raw video deleted after a configurable period once a version is published.

## 6. What needs a decision before Phase 1

1. **Hosting:** R2 is a new paid Cloudflare product on the account. Enable it?
2. **Upload route:** multipart through the Worker (recommended) or presigned URLs (needs an R2 API token)?
3. **GPU provider** for Phase 0 and Phase 2 (an on-demand cloud GPU, as the pack says). Which one, and who holds the account?
4. **Phase 0 inputs:** a higher-resolution test video (the pack asks for 1080p minimum, 4K preferred) and the phones to test on.

Until these are answered, nothing is installed or enabled, as the pack instructs.
