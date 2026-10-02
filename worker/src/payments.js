import { hasPermission } from "./auth/session.js";
import { reply } from "./http.js";
import { queueReservationMessages } from "./notifications.js";
import { expireUnpaidReservations, lookupReservation, publicReservation } from "./reservations.js";
import { readSettings } from "./settings.js";
import { isDemo } from "./util/env.js";
import { randomId } from "./util/ids.js";
import { maskMobile } from "./util/mobile.js";
export async function payReservationDemo(env, row) {
  if (!isDemo(env))
    return reply(
      { error: "payment_not_configured", message: "پرداخت آزمایشی در این محیط فعال نیست." },
      503,
    );
  if (!["pending", "confirmed"].includes(row.status))
    return reply({ error: "cannot_pay", message: "این رزرو لغو یا بسته شده است." }, 409);
  if (row.payment_status === "paid") return reply(publicReservation(row));
  if (row.payment_status !== "pending" || !Number(row.deposit_amount_rials))
    return reply({ error: "payment_not_available" }, 409);
  const now = new Date().toISOString();
  if (!row.payment_due_at || row.payment_due_at <= now) {
    await expireUnpaidReservations(env.DB, row.branch_id);
    return reply({ error: "payment_expired" }, 409);
  }
  const reference = `DEMO-${crypto.randomUUID()}`,
    id = randomId("payment");
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE reservations SET payment_status='paid',paid_at=?,status=CASE WHEN (SELECT auto_confirm FROM branch_settings WHERE branch_id=reservations.branch_id)=0 THEN 'pending' ELSE 'confirmed' END,updated_at=? WHERE id=? AND status='pending' AND payment_status='pending' AND payment_due_at>?",
    ).bind(now, now, row.id, now),
    env.DB.prepare(
      "INSERT INTO payment_transactions (id,reservation_id,branch_id,type,amount_rials,status,provider,reference,created_at) SELECT ?,id,branch_id,'payment',deposit_amount_rials,'success','demo',?,? FROM reservations WHERE id=? AND changes()=1",
    ).bind(id, reference, now, row.id),
  ]);
  const updated = await lookupReservation(env.DB, row.tracking_code, row.mobile);
  if (!result[0].meta?.changes) {
    if (updated?.payment_status === "paid" && ["pending", "confirmed"].includes(updated.status))
      return reply(publicReservation(updated));
    return reply({ error: "cannot_pay" }, 409);
  }
  const branch = await env.DB.prepare("SELECT * FROM branches WHERE id=?")
    .bind(row.branch_id)
    .first();
  const settingsRow = await env.DB.prepare("SELECT slug FROM cafes WHERE id=?")
    .bind(branch.cafe_id)
    .first();
  const settings = await readSettings(env.DB, settingsRow.slug, branch.slug);
  try {
    await queueReservationMessages(
      env,
      branch,
      {
        id: row.id,
        trackingCode: row.tracking_code,
        customerName: row.customer_name,
        mobile: row.mobile,
        date: row.reserved_at.slice(0, 10),
        time: row.reserved_at.slice(11, 16),
      },
      settings,
    );
  } catch (error) {
    console.error("payment_notification_failed", error);
  }
  return reply({ ...publicReservation(updated), reference });
}
export async function readPayments(db, session, url) {
  if (!hasPermission(session, "payments.read"))
    return reply({ error: "forbidden", message: "به پرداخت‌ها دسترسی ندارید." }, 403);
  const branchId = String(url.searchParams.get("branch") || session.branch_id || ""),
    scope =
      session.role === "owner" ? (branchId ? " AND p.branch_id=?" : "") : " AND p.branch_id=?",
    params =
      session.role === "owner"
        ? branchId
          ? [session.cafe_id, branchId]
          : [session.cafe_id]
        : [session.cafe_id, session.branch_id],
    result = await db
      .prepare(
        `SELECT p.id,p.reservation_id,p.type,p.amount_rials,p.status,p.provider,p.reference,p.created_at,r.tracking_code,r.customer_name,r.mobile,b.name AS branch_name FROM payment_transactions p JOIN reservations r ON r.id=p.reservation_id JOIN branches b ON b.id=p.branch_id WHERE b.cafe_id=?${scope} ORDER BY p.created_at DESC LIMIT 100`,
      )
      .bind(...params)
      .all(),
    pending = await db
      .prepare(
        `SELECT COUNT(*) AS count,COALESCE(SUM(r.deposit_amount_rials),0) AS amount FROM reservations r JOIN branches b ON b.id=r.branch_id WHERE b.cafe_id=? AND r.payment_status='pending'${scope.replaceAll("p.branch_id", "r.branch_id")}`,
      )
      .bind(...params)
      .first(),
    transactions = (result.results || []).map((row) => ({
      id: row.id,
      reservationId: row.reservation_id,
      type: row.type,
      amountRials: Number(row.amount_rials),
      status: row.status,
      provider: row.provider,
      reference: row.reference,
      createdAt: row.created_at,
      trackingCode: row.tracking_code,
      customerName: row.customer_name,
      mobile: maskMobile(row.mobile),
      branchName: row.branch_name,
    })),
    paid = transactions
      .filter((item) => item.type === "payment" && item.status === "success")
      .reduce((sum, item) => sum + item.amountRials, 0),
    refunded = transactions
      .filter((item) => item.type === "refund" && item.status === "success")
      .reduce((sum, item) => sum + item.amountRials, 0);
  return reply({
    mode: "demo",
    canWrite: hasPermission(session, "payments.write"),
    summary: {
      paid,
      refunded,
      pending: Number(pending?.amount || 0),
      pendingCount: Number(pending?.count || 0),
    },
    transactions,
  });
}
export async function refundPayment(db, session, transactionId) {
  if (!hasPermission(session, "payments.write")) return reply({ error: "forbidden" }, 403);
  const row = await db
    .prepare(
      "SELECT p.*,b.cafe_id FROM payment_transactions p JOIN branches b ON b.id=p.branch_id WHERE p.id=? AND p.type='payment' AND p.status='success'",
    )
    .bind(transactionId)
    .first();
  if (
    !row ||
    row.cafe_id !== session.cafe_id ||
    (session.role !== "owner" && row.branch_id !== session.branch_id)
  )
    return reply({ error: "payment_not_found" }, 404);
  const now = new Date().toISOString(),
    reference = `REF-DEMO-${crypto.randomUUID()}`;
  const result = await db.batch([
    db
      .prepare(
        "UPDATE reservations SET payment_status='refunded',status=CASE WHEN status IN ('pending','confirmed','arrived') THEN 'cancelled' ELSE status END,updated_at=? WHERE id=? AND payment_status='paid'",
      )
      .bind(now, row.reservation_id),
    db
      .prepare(
        "INSERT INTO payment_transactions (id,reservation_id,branch_id,type,amount_rials,status,provider,reference,created_at) SELECT ?,id,branch_id,'refund',?,'success','demo',?,? FROM reservations WHERE id=? AND changes()=1",
      )
      .bind(randomId("payment"), row.amount_rials, reference, now, row.reservation_id),
    db
      .prepare(
        "DELETE FROM reservation_locks WHERE reservation_id=? AND EXISTS (SELECT 1 FROM reservations WHERE id=? AND payment_status='refunded')",
      )
      .bind(row.reservation_id, row.reservation_id),
    db
      .prepare(
        "UPDATE sms_messages SET status='cancelled' WHERE reservation_id=? AND status='queued' AND EXISTS (SELECT 1 FROM reservations WHERE id=? AND payment_status='refunded')",
      )
      .bind(row.reservation_id, row.reservation_id),
  ]);
  if (!result[0].meta?.changes)
    return reply(
      {
        error: "already_refunded",
        message: "این بیعانه قبلاً بازپرداخت شده یا قابل بازپرداخت نیست.",
      },
      409,
    );
  return reply({ refunded: true, reference });
}
