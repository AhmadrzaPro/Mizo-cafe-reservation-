import { bookingTimeError, lockTimes } from "./availability.js";
import { reply } from "./http.js";
import { queueReservationMessages } from "./notifications.js";
import { dayRules, defaultSettings } from "./settings.js";
import { minutes, validDate, validTime } from "./util/dates.js";
import { isDemo } from "./util/env.js";
import { randomId, trackingCode } from "./util/ids.js";
import { normalizeMobile } from "./util/mobile.js";
export function depositFor(settings, time, partySize) {
  if (!settings.depositEnabled) return 0;
  if (
    settings.depositPeakOnly &&
    (minutes(time) < minutes(settings.depositPeakStart) ||
      minutes(time) >= minutes(settings.depositPeakEnd))
  )
    return 0;
  return settings.depositMode === "per_person"
    ? settings.depositAmountRials * partySize
    : settings.depositAmountRials;
}
export async function expireUnpaidReservations(db, branchId = null) {
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        "UPDATE reservations SET status='cancelled',payment_status='failed',updated_at=? WHERE payment_status='pending' AND status='pending' AND payment_due_at<=? AND (? IS NULL OR branch_id=?)",
      )
      .bind(now, now, branchId, branchId),
    db
      .prepare(
        "DELETE FROM reservation_locks WHERE reservation_id IN (SELECT id FROM reservations WHERE status='cancelled' AND payment_status='failed' AND (? IS NULL OR branch_id=?))",
      )
      .bind(branchId, branchId),
    db
      .prepare(
        "UPDATE sms_messages SET status='cancelled' WHERE status='queued' AND reservation_id IN (SELECT id FROM reservations WHERE status='cancelled' AND payment_status='failed' AND (? IS NULL OR branch_id=?))",
      )
      .bind(branchId, branchId),
  ]);
  return { expired: result[0].meta?.changes || 0 };
}
export async function createReservation(env, branch, body, settings, operational = false) {
  const db = env.DB;
  const rawMobile = normalizeMobile(body.mobile),
    mobile = rawMobile || "",
    name = String(body.customerName || "")
      .trim()
      .slice(0, 70),
    date = body.date,
    time = body.time,
    partySize = Number(body.partySize),
    ids = [...new Set(Array.isArray(body.tableIds) ? body.tableIds.map(String) : [])],
    source = ["phone", "walk_in"].includes(body.source) ? body.source : "web";
  if (!operational && settings.depositEnabled && !isDemo(env))
    return reply(
      {
        error: "payment_not_configured",
        message: "درگاه پرداخت واقعی هنوز فعال نیست؛ رزرو بیعانه‌دار موقتاً در دسترس نیست.",
      },
      503,
    );
  if (!operational && !settings.reservationsEnabled)
    return reply({ error: "reservations_disabled", message: "رزرو آنلاین موقتاً متوقف است." }, 409);
  if (!name) return reply({ error: "name_required", message: "نام مشتری را وارد کنید." }, 400);
  if (!operational && !rawMobile)
    return reply({ error: "invalid_mobile", message: "شماره موبایل معتبر وارد کنید." }, 400);
  if (body.mobile && !rawMobile)
    return reply({ error: "invalid_mobile", message: "شماره موبایل معتبر وارد کنید." }, 400);
  if (!validDate(date) || !validTime(time))
    return reply({ error: "invalid_datetime", message: "تاریخ یا ساعت معتبر نیست." }, 400);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > settings.maxPartySize)
    return reply({ error: "invalid_party_size", message: "تعداد مهمان‌ها معتبر نیست." }, 400);
  if (!ids.length || ids.length > 4)
    return reply({ error: "table_required", message: "یک میز انتخاب کنید." }, 400);
  const rules = await dayRules(db, branch, date),
    start = minutes(time);
  if (bookingTimeError(date, time, settings.reservationDuration, rules, operational))
    return reply(
      {
        error: "outside_hours",
        message: rules.reason || "زمان گذشته یا خارج از ساعت کاری قابل رزرو نیست.",
      },
      409,
    );
  const placeholders = ids.map(() => "?").join(","),
    tableResult = await db
      .prepare(
        `SELECT t.id,t.name,t.capacity FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=? AND t.reservable=1 AND t.operational_status='available' AND a.kind IN (SELECT kind FROM areas WHERE branch_id=? AND (?='both' OR kind=?)) AND t.id IN (${placeholders})`,
      )
      .bind(
        branch.id,
        branch.id,
        branch.space_mode || "indoor",
        branch.space_mode || "indoor",
        ...ids,
      )
      .all(),
    tables = tableResult.results || [];
  if (tables.length !== ids.length)
    return reply({ error: "invalid_table", message: "میز انتخاب‌شده معتبر نیست." }, 400);
  if (tables.reduce((sum, t) => sum + t.capacity, 0) < partySize)
    return reply(
      { error: "insufficient_capacity", message: "ظرفیت میز برای تعداد مهمان‌ها کافی نیست." },
      400,
    );
  const now = new Date().toISOString(),
    reservationId = randomId("reservation"),
    customerId = mobile ? `customer:${branch.cafe_id}:${mobile}` : null,
    code = trackingCode(),
    depositAmount = operational ? 0 : depositFor(settings, time, partySize),
    paymentStatus = depositAmount > 0 ? "pending" : "not_required",
    paymentDueAt =
      depositAmount > 0
        ? new Date(Date.now() + settings.paymentDeadlineMinutes * 60000).toISOString()
        : null,
    status =
      depositAmount > 0
        ? "pending"
        : operational
          ? body.status === "pending"
            ? "pending"
            : "confirmed"
          : settings.autoConfirm
            ? "confirmed"
            : "pending",
    reservedAt = `${date}T${time}`,
    locks = lockTimes(
      date,
      time,
      settings.reservationDuration,
      settings.bufferMinutes,
      settings.slotInterval,
    ),
    statements = [];
  if (customerId)
    statements.push(
      db
        .prepare(
          "INSERT INTO customers (id,cafe_id,mobile,name,last_seen_at,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(cafe_id,mobile) DO UPDATE SET name=excluded.name,last_seen_at=excluded.last_seen_at",
        )
        .bind(customerId, branch.cafe_id, mobile, name, now, now),
    );
  statements.push(
    db
      .prepare(
        "INSERT INTO reservations (id,branch_id,customer_id,tracking_code,customer_name,mobile,party_size,reserved_at,duration_minutes,buffer_minutes,status,source,notes,internal_notes,deposit_amount_rials,payment_status,payment_due_at,paid_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        reservationId,
        branch.id,
        customerId,
        code,
        name,
        mobile,
        partySize,
        reservedAt,
        settings.reservationDuration,
        settings.bufferMinutes,
        status,
        source,
        String(body.notes || "")
          .trim()
          .slice(0, 240),
        String(body.internalNotes || "")
          .trim()
          .slice(0, 500),
        depositAmount,
        paymentStatus,
        paymentDueAt,
        null,
        now,
        now,
      ),
  );
  for (const t of tables)
    statements.push(
      db
        .prepare("INSERT INTO reservation_tables (reservation_id,table_id) VALUES (?,?)")
        .bind(reservationId, t.id),
    );
  for (const t of tables)
    for (const lock of locks)
      statements.push(
        db
          .prepare(
            "INSERT INTO reservation_locks (id,reservation_id,table_id,lock_start) VALUES (?,?,?,?)",
          )
          .bind(`${t.id}:${lock}`, reservationId, t.id, lock),
      );
  try {
    await db.batch(statements);
  } catch (error) {
    console.error("reservation_conflict", error);
    return reply(
      {
        error: "slot_taken",
        message: "این میز همین الان رزرو شد؛ لطفاً زمان یا میز دیگری انتخاب کنید.",
      },
      409,
    );
  }
  const reservation = {
    id: reservationId,
    trackingCode: code,
    customerName: name,
    mobile,
    partySize,
    date,
    time,
    durationMinutes: settings.reservationDuration,
    tables: tables.map((t) => t.name),
    source,
  };
  let notifications = { confirmation: "skipped", reminder: "skipped" };
  if (!depositAmount)
    try {
      notifications = await queueReservationMessages(env, branch, reservation, settings);
    } catch (error) {
      console.error("reservation_notification_queue_failed", error);
      notifications = { confirmation: "failed", reminder: "failed" };
    }
  return reply(
    {
      trackingCode: code,
      status,
      reservation,
      notifications,
      payment: {
        required: depositAmount > 0,
        amountRials: depositAmount,
        status: paymentStatus,
        dueAt: paymentDueAt,
        refundPolicy: settings.refundPolicy,
        provider: "demo",
      },
    },
    201,
  );
}
export async function lookupReservation(db, code, mobile) {
  const normalized = normalizeMobile(mobile);
  if (!normalized) return null;
  return db
    .prepare(
      "SELECT r.id,r.branch_id,r.tracking_code,r.customer_name,r.mobile,r.party_size,r.reserved_at,r.duration_minutes,r.status,r.notes,r.deposit_amount_rials,r.payment_status,r.payment_due_at,r.paid_at,b.name AS branch_name,s.refund_policy,GROUP_CONCAT(t.name,'، ') AS table_names FROM reservations r JOIN branches b ON b.id=r.branch_id LEFT JOIN branch_settings s ON s.branch_id=b.id LEFT JOIN reservation_tables rt ON rt.reservation_id=r.id LEFT JOIN cafe_tables t ON t.id=rt.table_id WHERE r.tracking_code=? AND r.mobile=? GROUP BY r.id LIMIT 1",
    )
    .bind(code, normalized)
    .first();
}
export function publicReservation(row) {
  return {
    trackingCode: row.tracking_code,
    customerName: row.customer_name,
    mobile: row.mobile,
    partySize: row.party_size,
    date: row.reserved_at.slice(0, 10),
    time: row.reserved_at.slice(11, 16),
    durationMinutes: row.duration_minutes,
    status: row.status,
    branchName: row.branch_name,
    tables: row.table_names ? row.table_names.split("، ") : [],
    notes: row.notes,
    payment: {
      required: Number(row.deposit_amount_rials) > 0,
      amountRials: Number(row.deposit_amount_rials || 0),
      status: row.payment_status || "not_required",
      dueAt: row.payment_due_at,
      paidAt: row.paid_at,
      refundPolicy: row.refund_policy || defaultSettings.refundPolicy,
      provider: "demo",
    },
  };
}
