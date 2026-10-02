import { branchRow } from "./branches.js";
import { reply } from "./http.js";
import { readSettings } from "./settings.js";
import { deliverSmsMessage, smsText } from "./sms.js";
import { subtractLocalMinutes, tehranNow } from "./util/dates.js";
import { randomId } from "./util/ids.js";
import { maskMobile } from "./util/mobile.js";
export async function queueReservationMessages(env, branch, reservation, settings) {
  if (!reservation.mobile) return { confirmation: "skipped", reminder: "skipped" };
  const createdAt = new Date().toISOString(),
    results = { confirmation: "disabled", reminder: "disabled" };
  if (settings.smsConfirmationEnabled) {
    const id = randomId("sms"),
      message = smsText("confirmation", reservation, branch);
    await env.DB.prepare(
      "INSERT INTO sms_messages (id,branch_id,reservation_id,kind,mobile,customer_name,message,status,scheduled_at,sent_at,provider,provider_message_id,error,created_at) VALUES (?,?,?,?,?,?,?,'queued',?,NULL,'demo',NULL,'',?)",
    )
      .bind(
        id,
        branch.id,
        reservation.id,
        "confirmation",
        reservation.mobile,
        reservation.customerName,
        message,
        createdAt,
        createdAt,
      )
      .run();
    results.confirmation = (
      await deliverSmsMessage(env, {
        id,
        kind: "confirmation",
        mobile: reservation.mobile,
        tracking_code: reservation.trackingCode,
        reserved_at: `${reservation.date}T${reservation.time}`,
        branch_name: branch.name,
      })
    ).status;
  }
  if (settings.smsReminderEnabled) {
    const scheduledAt = subtractLocalMinutes(
        `${reservation.date}T${reservation.time}`,
        settings.smsReminderMinutes,
      ),
      id = randomId("sms"),
      message = smsText("reminder", reservation, branch);
    await env.DB.prepare(
      "INSERT INTO sms_messages (id,branch_id,reservation_id,kind,mobile,customer_name,message,status,scheduled_at,sent_at,provider,provider_message_id,error,created_at) VALUES (?,?,?,?,?,?,?,'queued',?,NULL,'demo',NULL,'',?)",
    )
      .bind(
        id,
        branch.id,
        reservation.id,
        "reminder",
        reservation.mobile,
        reservation.customerName,
        message,
        scheduledAt,
        createdAt,
      )
      .run();
    results.reminder = "queued";
  }
  return results;
}
export async function processDueReminders(env, branchId = null) {
  const now = tehranNow().key,
    condition = branchId ? "AND m.branch_id=?" : "",
    query = `SELECT m.id,m.kind,m.mobile,r.tracking_code,r.reserved_at,b.name AS branch_name FROM sms_messages m JOIN reservations r ON r.id=m.reservation_id JOIN branches b ON b.id=m.branch_id WHERE m.kind='reminder' AND m.status='queued' AND m.scheduled_at<=? AND r.status NOT IN ('cancelled','completed','no_show') ${condition} ORDER BY m.scheduled_at LIMIT 25`,
    statement = env.DB.prepare(query),
    result = branchId ? await statement.bind(now, branchId).all() : await statement.bind(now).all(),
    rows = result.results || [];
  let processed = 0;
  for (const row of rows) {
    const claimed = await env.DB.prepare(
      "UPDATE sms_messages SET status='sending' WHERE id=? AND status='queued'",
    )
      .bind(row.id)
      .run();
    if (!claimed.meta?.changes) continue;
    await deliverSmsMessage(env, row);
    processed++;
  }
  return { processed };
}
export async function readNotifications(env, cafeSlug, branchSlug) {
  const branch = await branchRow(env.DB, cafeSlug, branchSlug),
    settings = await readSettings(env.DB, cafeSlug, branchSlug),
    result = await env.DB.prepare(
      "SELECT id,kind,mobile,customer_name,message,status,scheduled_at,sent_at,provider,error,created_at FROM sms_messages WHERE branch_id=? ORDER BY created_at DESC LIMIT 40",
    )
      .bind(branch.id)
      .all(),
    messages = (result.results || []).map((row) => ({
      id: row.id,
      kind: row.kind,
      mobile: maskMobile(row.mobile),
      customerName: row.customer_name,
      message: row.message,
      status: row.status,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      provider: row.provider,
      error: row.error,
      createdAt: row.created_at,
    }));
  return {
    mode:
      env.KAVENEGAR_API_KEY &&
      env.KAVENEGAR_CONFIRMATION_TEMPLATE &&
      env.KAVENEGAR_REMINDER_TEMPLATE
        ? "kavenegar"
        : "demo",
    settings: {
      confirmationEnabled: settings.smsConfirmationEnabled,
      reminderEnabled: settings.smsReminderEnabled,
      reminderMinutes: settings.smsReminderMinutes,
    },
    stats: {
      total: messages.length,
      sent: messages.filter((item) => ["sent", "demo_sent"].includes(item.status)).length,
      queued: messages.filter((item) => item.status === "queued").length,
      failed: messages.filter((item) => item.status === "failed").length,
    },
    messages,
  };
}
export async function writeNotificationSettings(env, cafeSlug, branchSlug, body) {
  const branch = await branchRow(env.DB, cafeSlug, branchSlug);
  if (!branch) return reply({ error: "branch_not_found" }, 404);
  const reminderMinutes = [60, 120, 180, 360, 1440].includes(Number(body.reminderMinutes))
    ? Number(body.reminderMinutes)
    : 120;
  await env.DB.prepare(
    "UPDATE branch_settings SET sms_confirmation_enabled=?,sms_reminder_enabled=?,sms_reminder_minutes=?,updated_at=? WHERE branch_id=?",
  )
    .bind(
      body.confirmationEnabled === false ? 0 : 1,
      body.reminderEnabled === false ? 0 : 1,
      reminderMinutes,
      new Date().toISOString(),
      branch.id,
    )
    .run();
  return reply(await readNotifications(env, cafeSlug, branchSlug));
}
