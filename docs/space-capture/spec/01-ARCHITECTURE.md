# معماری فنی Mizo AI Space Capture

## 1. دامنه و مرزبندی

این قابلیت یک bounded context مستقل به نام `space-capture` است. مسئولیت آن دریافت ویدئو، پردازش سه‌بعدی، نگهداری نسخه‌های صحنه و تحویل asset به Viewer است.

مسئولیت‌های سیستم اصلی Mizo باقی می‌مانند:
- حساب کاربری و احراز هویت
- مالکیت کافه و شعبه
- تعریف میز و ظرفیت
- قوانین ساعات کاری و بازه‌های رزرو
- کنترل هم‌زمانی و ثبت نهایی رزرو
- اشتراک و دسترسی مشتری

سرویس سه‌بعدی فقط شناسه میز و مختصات نمایشی را می‌شناسد؛ حق تصمیم‌گیری درباره آزاد/رزروشده بودن میز را ندارد.

## 2. نمای سطح بالا

```text
Mizo Web
  |-- Admin Capture UI
  |-- Customer 3D Experience
  |
Main Mizo API
  |-- Auth / Tenant authorization
  |-- Capture API
  |-- Scene metadata API
  |-- Existing Booking API (source of truth)
  |
PostgreSQL ---------------- Object Storage
  |                            |-- original videos (private)
  |                            |-- extracted frames (temporary)
  |                            |-- raw reconstruction
  |                            |-- optimized scene packages
  |
Queue (Redis or existing queue)
  |
GPU Worker Service
  |-- FFmpeg / OpenCV
  |-- COLMAP / SfM
  |-- Nerfstudio / Splatfacto
  |-- quality checks / conversion
  |
Scene Delivery / CDN
  |
Web Viewer (PlayCanvas or validated alternative)
```

## 3. سرویس‌ها

### Main API
- احراز مجوز کاربر نسبت به `cafe_id` و `branch_id`.
- ایجاد capture و URL آپلود موقت.
- ثبت وضعیت job و انتشار صحنه.
- ارائه metadata و آدرس assetهای منتشرشده.
- proxy یا دسترسی کنترل‌شده به رزرو اصلی.

### Object Storage
Bucket/prefix پیشنهادی:
- `captures/{tenant_id}/{cafe_id}/{capture_id}/source/`
- `processing/{tenant_id}/{cafe_id}/{job_id}/`
- `scenes/{tenant_id}/{cafe_id}/{scene_id}/{version}/`
فایل ویدئو خصوصی بماند. دسترسی دانلود/آپلود از طریق signed URL کوتاه‌عمر باشد. asset منتشرشده می‌تواند از CDN ارائه شود، اما metadata و عملیات حساس همچنان از API عبور کنند.

### Queue و GPU Worker
- API فقط job را enqueue می‌کند و سریع پاسخ می‌دهد.
- Worker وضعیت را در دیتابیس ثبت می‌کند.
- jobها idempotent باشند؛ retry نباید asset تکراری یا scene اشتباه بسازد.
- هر job دارای timeout، retry محدود، heartbeat و error code باشد.
- پردازش GPU از API و workerهای رزرو جدا باشد.

## 4. مدل داده پیشنهادی

نام‌ها نمونه‌اند؛ قبل از migration با schema فعلی تطبیق داده شوند.

### `cafe_scenes`
- `id`
- `tenant_id`
- `cafe_id`
- `branch_id` nullable فقط اگر معماری فعلی اجازه می‌دهد
- `name`
- `status`: draft | processing | review | published | archived | failed
- `active_version_id`
- `created_by`
- timestamps

### `scene_captures`
- `id`, `tenant_id`, `cafe_id`, `branch_id`
- `scene_id`
- `storage_key`
- `original_filename`
- `mime_type`, `size_bytes`, `duration_ms`
- `width`, `height`, `fps`
- `validation_status`
- `validation_report` JSON
- timestamps

### `scene_processing_jobs`
- `id`, `tenant_id`, `cafe_id`, `capture_id`, `scene_id`
- `pipeline_version`
- `status`: queued | validating | extracting | solving_camera | training | optimizing | completed | failed | cancelled
- `progress_percent`
- `stage`
- `error_code`, `safe_error_message`
- `worker_id`, `started_at`, `finished_at`
- `retry_count`
- timestamps

### `scene_versions`
- `id`, `tenant_id`, `cafe_id`, `scene_id`
- `version_number`
- `status`: draft | review | published | superseded
- `coordinate_system`
- `origin_metadata`
- `quality_report`
- `published_at`
- timestamps

### `scene_assets`
- `id`, `tenant_id`, `cafe_id`, `scene_version_id`
- `asset_type`: splat | sog | collision_mesh | preview | thumbnail | metadata
- `storage_key`, `content_type`, `size_bytes`, `checksum`
- `lod_level`, `device_profile`
- timestamps

### `scene_zones`
- `id`, `tenant_id`, `cafe_id`, `scene_id`
- `name`, `zone_type`: indoor | outdoor | terrace | private_room | other
- `transform`, `bounds`, `sort_order`

### `scene_anchors`
- `id`, `tenant_id`, `cafe_id`, `scene_id`
- `anchor_type`: entrance | spawn | camera_view | landmark
- `position`, `rotation`, `metadata`

### `table_scene_positions`
- `id`, `tenant_id`, `cafe_id`, `branch_id`
- `table_id` (FK به جدول میز فعلی)
- `scene_version_id`
- `position`, `rotation`, `scale`
- `zone_id`
- `anchor_confidence`
- `verified_by`, `verified_at`

نکته: اگر جدول `cafe_tables` فعلی Mizo وجود دارد، جدول جدید موازی برای میز نسازید. فقط رابطه مختصات صحنه به شناسه میز موجود اضافه شود.

## 5. امنیت و جداسازی tenant

- همه queryها باید tenant/cafe scope داشته باشند.
- کنترل دسترسی فقط به مخفی‌کردن UI متکی نباشد؛ در API و در صورت امکان Row-Level Security دیتابیس اعمال شود.
- `cafe_id` از ورودی کاربر به‌تنهایی قابل اعتماد نیست؛ از مجوز کاربر استخراج/اعتبارسنجی شود.
- signed URLها کوتاه‌عمر و محدود به object key مشخص باشند.
- نام فایل، MIME و اندازه واقعی فایل سمت سرور بررسی شوند.
- فایل ویدئو و metadata دارای سیاست retention و حذف مشخص باشند.
- لاگ‌ها نباید URL امضاشده، token یا اطلاعات خصوصی را ثبت کنند.

## 6. قرارداد API پیشنهادی

مسیرها نمونه‌اند و باید با conventions فعلی Mizo تطبیق داده شوند.

- `POST /api/cafes/{cafeId}/scenes` ایجاد scene draft
- `POST /api/scenes/{sceneId}/captures` ایجاد capture و دریافت upload URL
- `POST /api/captures/{captureId}/complete` اعلام پایان آپلود
- `GET /api/captures/{captureId}/validation` گزارش اعتبارسنجی
- `POST /api/captures/{captureId}/process` شروع job
- `GET /api/processing-jobs/{jobId}` وضعیت job
- `GET /api/scenes/{sceneId}` metadata صحنه
- `POST /api/scenes/{sceneId}/versions/{versionId}/approve` تأیید مدیر
- `POST /api/scenes/{sceneId}/publish` انتشار نسخه تأییدشده
- `PUT /api/scenes/{sceneId}/tables/{tableId}/position` ثبت موقعیت میز

رزرو از API موجود Mizo استفاده می‌کند؛ endpoint رزرو جدید صرفاً برای Viewer نسازید مگر API فعلی واقعاً چنین قابلیتی نداشته باشد.

## 7. وضعیت‌ها و رویدادها

رویدادهای داخلی پیشنهادی:
- `capture.upload.completed`
- `capture.validation.passed`
- `capture.validation.failed`
- `scene.processing.started`
- `scene.processing.stage.completed`
- `scene.processing.failed`
- `scene.version.ready_for_review`
- `scene.version.approved`
- `scene.version.published`

رویدادها باید idempotent و قابل ردیابی با `correlation_id` باشند.

## 8. تصمیم‌های باز که باید در فاز صفر اثبات شوند

- خروجی واقعی Nerfstudio و فرمت قابل پخش در Viewer انتخابی
- روش ساخت collision mesh قابل قبول
- هزینه GPU برای هر دقیقه ویدئو
- زمان پردازش برای صحنه نمونه
- عملکرد در iPhone و Android واقعی
- محدودیت مجوز و استفاده تجاری ابزارها
