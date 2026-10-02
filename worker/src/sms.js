import { isDemo } from "./util/env.js";
import { trackingCode } from "./util/ids.js";
export async function sendReservationSms(env, kind, mobile, trackingCode, time, branchName) {
  const template =
    kind === "confirmation" ? env.KAVENEGAR_CONFIRMATION_TEMPLATE : env.KAVENEGAR_REMINDER_TEMPLATE;
  if (isDemo(env)) return { mode: "demo", messageId: null };
  if (!env.KAVENEGAR_API_KEY || !template) throw new Error("sms_not_configured");
  const endpoint = `https://api.kavenegar.com/v1/${encodeURIComponent(env.KAVENEGAR_API_KEY)}/verify/lookup.json?receptor=${encodeURIComponent(mobile)}&token=${encodeURIComponent(trackingCode)}&token2=${encodeURIComponent(time)}&token3=${encodeURIComponent(branchName)}&template=${encodeURIComponent(template)}`,
    response = await fetch(endpoint, { method: "POST" });
  if (!response.ok) throw new Error(`kavenegar_${response.status}`);
  const data = await response.json().catch(() => null);
  return {
    mode: "kavenegar",
    messageId: String(data?.return?.value || data?.entries?.[0]?.messageid || "") || null,
  };
}
export function smsText(kind, reservation, branch) {
  return kind === "confirmation"
    ? `رزرو ${reservation.trackingCode} در ${branch.name} برای ${reservation.date} ساعت ${reservation.time} ثبت شد.`
    : `یادآوری رزرو ${reservation.trackingCode}: ${reservation.date} ساعت ${reservation.time} در ${branch.name} منتظر شما هستیم.`;
}
export async function deliverSmsMessage(env, row) {
  try {
    const delivery = await sendReservationSms(
        env,
        row.kind,
        row.mobile,
        row.tracking_code,
        row.reserved_at.slice(11, 16),
        row.branch_name,
      ),
      status = delivery.mode === "demo" ? "demo_sent" : "sent",
      sentAt = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE sms_messages SET status=?,sent_at=?,provider=?,provider_message_id=?,error='' WHERE id=?",
    )
      .bind(status, sentAt, delivery.mode, delivery.messageId, row.id)
      .run();
    return { status, provider: delivery.mode };
  } catch (error) {
    console.error("reservation_sms_failed", error);
    await env.DB.prepare("UPDATE sms_messages SET status='failed',error=? WHERE id=?")
      .bind(String(error?.message || "send_failed").slice(0, 160), row.id)
      .run();
    return { status: "failed", provider: "kavenegar" };
  }
}
