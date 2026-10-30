import { defaultHours } from "./setup.js";
import { validDate, validTime } from "./util/dates.js";
import { randomId } from "./util/ids.js";
export const defaultSettings = {
  reservationsEnabled: true,
  autoConfirm: true,
  reservationDuration: 90,
  maxPartySize: 8,
  customerNotice: "",
  bufferMinutes: 15,
  slotInterval: 30,
  smsConfirmationEnabled: true,
  smsReminderEnabled: true,
  smsReminderMinutes: 120,
  depositEnabled: false,
  depositMode: "fixed",
  depositAmountRials: 2000000,
  depositPeakOnly: false,
  depositPeakStart: "18:00",
  depositPeakEnd: "22:00",
  paymentDeadlineMinutes: 15,
  refundPolicy: "تا ۲ ساعت قبل از زمان رزرو، بیعانه کامل بازگردانده می‌شود.",
};
export function normalizeSettings(input) {
  return {
    reservationsEnabled: input?.reservationsEnabled !== false,
    autoConfirm: input?.autoConfirm !== false,
    reservationDuration: [60, 90, 120].includes(Number(input?.reservationDuration))
      ? Number(input.reservationDuration)
      : 90,
    maxPartySize: Math.max(1, Math.min(20, Number(input?.maxPartySize) || 8)),
    customerNotice: String(input?.customerNotice || "")
      .trim()
      .slice(0, 140),
    bufferMinutes: [0, 15, 30, 45].includes(Number(input?.bufferMinutes))
      ? Number(input.bufferMinutes)
      : 15,
    slotInterval: [15, 30, 60].includes(Number(input?.slotInterval))
      ? Number(input.slotInterval)
      : 30,
    smsConfirmationEnabled: input?.smsConfirmationEnabled !== false,
    smsReminderEnabled: input?.smsReminderEnabled !== false,
    smsReminderMinutes: [60, 120, 180, 360, 1440].includes(Number(input?.smsReminderMinutes))
      ? Number(input.smsReminderMinutes)
      : 120,
    depositEnabled: Boolean(input?.depositEnabled),
    depositMode: input?.depositMode === "per_person" ? "per_person" : "fixed",
    depositAmountRials: Math.max(
      100000,
      Math.min(100000000, Number(input?.depositAmountRials) || 2000000),
    ),
    depositPeakOnly: Boolean(input?.depositPeakOnly),
    depositPeakStart: validTime(input?.depositPeakStart) ? input.depositPeakStart : "18:00",
    depositPeakEnd: validTime(input?.depositPeakEnd) ? input.depositPeakEnd : "22:00",
    paymentDeadlineMinutes: [10, 15, 30].includes(Number(input?.paymentDeadlineMinutes))
      ? Number(input.paymentDeadlineMinutes)
      : 15,
    refundPolicy: String(input?.refundPolicy || defaultSettings.refundPolicy)
      .trim()
      .slice(0, 240),
  };
}
export async function readSettings(db, cafeSlug, branchSlug) {
  const row = await db
    .prepare(
      "SELECT s.* FROM branch_settings s JOIN branches b ON b.id=s.branch_id JOIN cafes c ON c.id=b.cafe_id WHERE c.slug=? AND b.slug=? LIMIT 1",
    )
    .bind(cafeSlug, branchSlug)
    .first();
  return row
    ? {
        reservationsEnabled: Boolean(row.reservations_enabled),
        autoConfirm: Boolean(row.auto_confirm),
        reservationDuration: row.reservation_duration,
        maxPartySize: row.max_party_size,
        customerNotice: row.customer_notice,
        bufferMinutes: row.buffer_minutes,
        slotInterval: row.slot_interval,
        smsConfirmationEnabled: Boolean(row.sms_confirmation_enabled),
        smsReminderEnabled: Boolean(row.sms_reminder_enabled),
        smsReminderMinutes: row.sms_reminder_minutes,
        depositEnabled: Boolean(row.deposit_enabled),
        depositMode: row.deposit_mode,
        depositAmountRials: Number(row.deposit_amount_rials),
        depositPeakOnly: Boolean(row.deposit_peak_only),
        depositPeakStart: row.deposit_peak_start,
        paymentDeadlineMinutes: Number(row.payment_deadline_minutes),
        depositPeakEnd: row.deposit_peak_end,
        refundPolicy: row.refund_policy,
      }
    : defaultSettings;
}
export async function writeSettings(db, cafeSlug, branchSlug, body) {
  const s = normalizeSettings(body),
    now = new Date().toISOString(),
    cafeId = `cafe:${cafeSlug}`,
    branchId = `branch:${cafeSlug}:${branchSlug}`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO cafes (id,slug,name,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,name=excluded.name",
      )
      .bind(cafeId, cafeSlug, String(body.cafeName || cafeSlug).slice(0, 80), now),
    db
      .prepare(
        "INSERT INTO branches (id,cafe_id,slug,name,city,address,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,city=excluded.city,address=excluded.address,updated_at=excluded.updated_at",
      )
      .bind(
        branchId,
        cafeId,
        branchSlug,
        String(body.branchName || branchSlug).slice(0, 80),
        String(body.city || "تهران").slice(0, 60),
        String(body.address || "").slice(0, 180),
        now,
      ),
    db
      .prepare(
        "INSERT INTO branch_settings (branch_id,reservations_enabled,auto_confirm,reservation_duration,max_party_size,customer_notice,buffer_minutes,slot_interval,sms_confirmation_enabled,sms_reminder_enabled,sms_reminder_minutes,deposit_enabled,deposit_mode,deposit_amount_rials,deposit_peak_only,deposit_peak_start,deposit_peak_end,payment_deadline_minutes,refund_policy,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(branch_id) DO UPDATE SET reservations_enabled=excluded.reservations_enabled,auto_confirm=excluded.auto_confirm,reservation_duration=excluded.reservation_duration,max_party_size=excluded.max_party_size,customer_notice=excluded.customer_notice,buffer_minutes=excluded.buffer_minutes,slot_interval=excluded.slot_interval,sms_confirmation_enabled=excluded.sms_confirmation_enabled,sms_reminder_enabled=excluded.sms_reminder_enabled,sms_reminder_minutes=excluded.sms_reminder_minutes,deposit_enabled=excluded.deposit_enabled,deposit_mode=excluded.deposit_mode,deposit_amount_rials=excluded.deposit_amount_rials,deposit_peak_only=excluded.deposit_peak_only,deposit_peak_start=excluded.deposit_peak_start,deposit_peak_end=excluded.deposit_peak_end,payment_deadline_minutes=excluded.payment_deadline_minutes,refund_policy=excluded.refund_policy,updated_at=excluded.updated_at",
      )
      .bind(
        branchId,
        s.reservationsEnabled ? 1 : 0,
        s.autoConfirm ? 1 : 0,
        s.reservationDuration,
        s.maxPartySize,
        s.customerNotice,
        s.bufferMinutes,
        s.slotInterval,
        s.smsConfirmationEnabled ? 1 : 0,
        s.smsReminderEnabled ? 1 : 0,
        s.smsReminderMinutes,
        s.depositEnabled ? 1 : 0,
        s.depositMode,
        s.depositAmountRials,
        s.depositPeakOnly ? 1 : 0,
        s.depositPeakStart,
        s.depositPeakEnd,
        s.paymentDeadlineMinutes,
        s.refundPolicy,
        now,
      ),
  ]);
  return s;
}
export async function readSchedule(db, branch) {
  const [hoursResult, closuresResult] = await db.batch([
      db
        .prepare(
          "SELECT weekday,open_time,close_time,closed FROM operating_hours WHERE branch_id=? ORDER BY weekday",
        )
        .bind(branch.id),
      db
        .prepare(
          "SELECT id,start_date,end_date,reason FROM closures WHERE branch_id=? ORDER BY start_date DESC LIMIT 50",
        )
        .bind(branch.id),
    ]),
    rows = hoursResult.results || [],
    byDay = new Map(
      rows.map((r) => [
        r.weekday,
        {
          weekday: r.weekday,
          openTime: r.open_time,
          closeTime: r.close_time,
          closed: Boolean(r.closed),
        },
      ]),
    );
  return {
    hours: defaultHours().map((h) => byDay.get(h.weekday) || h),
    closures: (closuresResult.results || []).map((r) => ({
      id: r.id,
      startDate: r.start_date,
      endDate: r.end_date,
      reason: r.reason,
    })),
  };
}
export async function writeSchedule(db, branch, body) {
  const hours = Array.isArray(body.hours) ? body.hours : [],
    closures = Array.isArray(body.closures) ? body.closures : [],
    now = new Date().toISOString(),
    statements = [
      db.prepare("DELETE FROM operating_hours WHERE branch_id=?").bind(branch.id),
      db.prepare("DELETE FROM closures WHERE branch_id=?").bind(branch.id),
    ];
  for (let weekday = 0; weekday < 7; weekday++) {
    const item = hours.find((x) => Number(x.weekday) === weekday) || defaultHours()[weekday],
      open = validTime(item.openTime) ? item.openTime : "10:00",
      close = validTime(item.closeTime) ? item.closeTime : "23:00";
    statements.push(
      db
        .prepare(
          "INSERT INTO operating_hours (branch_id,weekday,open_time,close_time,closed) VALUES (?,?,?,?,?)",
        )
        .bind(branch.id, weekday, open, close, item.closed ? 1 : 0),
    );
  }
  for (const item of closures.slice(0, 50)) {
    if (!validDate(item.startDate) || !validDate(item.endDate) || item.endDate < item.startDate)
      continue;
    statements.push(
      db
        .prepare(
          "INSERT INTO closures (id,branch_id,start_date,end_date,reason,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          item.id || randomId("closure"),
          branch.id,
          item.startDate,
          item.endDate,
          String(item.reason || "").slice(0, 100),
          now,
        ),
    );
  }
  await db.batch(statements);
  return readSchedule(db, branch);
}
export async function dayRules(db, branch, date) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(),
    [hours, closure] = await db.batch([
      db
        .prepare(
          "SELECT open_time,close_time,closed FROM operating_hours WHERE branch_id=? AND weekday=? LIMIT 1",
        )
        .bind(branch.id, weekday),
      db
        .prepare(
          "SELECT reason FROM closures WHERE branch_id=? AND start_date<=? AND end_date>=? ORDER BY start_date DESC LIMIT 1",
        )
        .bind(branch.id, date, date),
    ]),
    h = hours.results?.[0] || defaultHours()[weekday],
    c = closure.results?.[0];
  return {
    openTime: h.open_time || h.openTime,
    closeTime: h.close_time || h.closeTime,
    closed: Boolean(h.closed) || Boolean(c),
    reason: c?.reason || (h.closed ? "کافه در این روز تعطیل است" : ""),
  };
}
