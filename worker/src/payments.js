import { hasPermission } from "./auth/session.js";
import { paymentGateway } from "./gateway.js";
import { reply } from "./http.js";
import { queueReservationMessages } from "./notifications.js";
import { expireUnpaidReservations, lookupReservation, publicReservation } from "./reservations.js";
import { readSettings } from "./settings.js";
import { isDemo } from "./util/env.js";
import { randomId } from "./util/ids.js";
import { maskMobile } from "./util/mobile.js";
// Minutes a started gateway payment keeps the table held, so the customer can finish at the bank.
const GATEWAY_HOLD_MINUTES = 10;
// Recorded on an attempt whose verification never got an answer.
const VERIFY_UNKNOWN = "verify_unreachable";
// Checks shared by every way of paying. Returns the response to send instead, or null to go on.
async function paymentBlocked(env, row) {
  if (!["pending", "confirmed"].includes(row.status))
    return reply({ error: "cannot_pay", message: "این رزرو لغو یا بسته شده است." }, 409);
  if (row.payment_status === "paid") return reply(publicReservation(row));
  if (row.payment_status !== "pending" || !Number(row.deposit_amount_rials))
    return reply({ error: "payment_not_available" }, 409);
  if (!row.payment_due_at || row.payment_due_at <= new Date().toISOString()) {
    await expireUnpaidReservations(env.DB, row.branch_id);
    return reply(
      { error: "payment_expired", message: "مهلت پرداخت تمام شده و میز آزاد شده است." },
      409,
    );
  }
  return null;
}
// Pays a reservation's deposit: through the configured gateway, or simulated in demo mode.
export async function payReservation(env, row, origin) {
  const gateway = paymentGateway(env);
  if (gateway) return startGatewayPayment(env, gateway, row, origin);
  return payReservationDemo(env, row);
}
async function startGatewayPayment(env, gateway, row, origin) {
  const blocked = await paymentBlocked(env, row);
  if (blocked) return blocked;
  let started;
  try {
    started = await gateway.request({
      amountRials: Number(row.deposit_amount_rials),
      callbackUrl: `${origin}/api/payments/${gateway.name}/callback`,
      description: `بیعانه رزرو ${row.tracking_code}`,
      mobile: row.mobile,
    });
  } catch (error) {
    console.error("payment_request_failed", error);
    return reply(
      {
        error: "gateway_unavailable",
        message: "اتصال به درگاه پرداخت برقرار نشد؛ دوباره تلاش کنید.",
      },
      502,
    );
  }
  const now = new Date(),
    holdUntil = new Date(now.getTime() + GATEWAY_HOLD_MINUTES * 60000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO payment_attempts (id,reservation_id,branch_id,provider,authority,amount_rials,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?)",
    ).bind(
      randomId("attempt"),
      row.id,
      row.branch_id,
      gateway.name,
      started.authority,
      Number(row.deposit_amount_rials),
      now.toISOString(),
      now.toISOString(),
    ),
    env.DB.prepare(
      "UPDATE reservations SET payment_due_at=? WHERE id=? AND payment_status='pending' AND payment_due_at<?",
    ).bind(holdUntil, row.id, holdUntil),
  ]);
  return reply({ ...publicReservation(row), redirectUrl: started.url });
}
// Where the gateway sends the customer back. Verifies the payment once and redirects to the
// booking page with ?payment=success|late|pending|failed and the tracking code.
export async function completeGatewayPayment(env, provider, url) {
  const gateway = paymentGateway(env),
    db = env.DB,
    authority = String(url.searchParams.get("Authority") || "").slice(0, 100);
  /** @param {string} result @param {Record<string, any> | null} [attempt] */
  const back = (result, attempt = null) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `/?${new URLSearchParams({
          ...(attempt ? { cafe: attempt.cafe_slug, code: attempt.tracking_code } : {}),
          payment: result,
        })}`,
        "cache-control": "no-store",
      },
    });
  if (!gateway || gateway.name !== provider || !authority) return back("failed");
  const attempt = await db
    .prepare(
      "SELECT a.*,r.tracking_code,r.status AS reservation_status,r.payment_status,r.payment_due_at,r.deposit_amount_rials,c.slug AS cafe_slug FROM payment_attempts a JOIN reservations r ON r.id=a.reservation_id JOIN branches b ON b.id=a.branch_id JOIN cafes c ON c.id=b.cafe_id WHERE a.provider=? AND a.authority=? LIMIT 1",
    )
    .bind(provider, authority)
    .first();
  if (!attempt) return back("failed");
  if (attempt.status === "paid") return back("success", attempt);
  if (attempt.status === "paid_late") return back("late", attempt);
  const now = new Date().toISOString();
  // Claiming the attempt first means a repeated or concurrent callback cannot verify it twice.
  const claimed = await db
    .prepare(
      "UPDATE payment_attempts SET status='verifying',updated_at=? WHERE id=? AND status='pending'",
    )
    .bind(now, attempt.id)
    .run();
  if (!claimed.meta?.changes)
    return back(attempt.status === "verifying" ? "pending" : "failed", attempt);
  const fail = async (error) => {
    await db
      .prepare("UPDATE payment_attempts SET status='failed',error=?,updated_at=? WHERE id=?")
      .bind(error, now, attempt.id)
      .run();
    return back("failed", attempt);
  };
  if (url.searchParams.get("Status") !== "OK") return fail("cancelled_at_gateway");
  // A payment that is never verified goes back to the customer, so one that the reservation can
  // no longer take is simply left unverified. After a verification whose outcome was lost, though,
  // ZarinPal may already have settled the money, so that attempt is always verified again; if it
  // was paid, the late path below records it for a refund.
  if (
    attempt.error !== VERIFY_UNKNOWN &&
    (attempt.reservation_status !== "pending" ||
      attempt.payment_status !== "pending" ||
      !attempt.payment_due_at ||
      attempt.payment_due_at <= now ||
      Number(attempt.deposit_amount_rials) !== Number(attempt.amount_rials))
  )
    return fail("reservation_not_payable");
  let verified;
  try {
    verified = await gateway.verify({ amountRials: Number(attempt.amount_rials), authority });
  } catch (error) {
    // The outcome is unknown: release the claim so returning to this URL verifies again.
    console.error("payment_verify_failed", error);
    await db
      .prepare(
        "UPDATE payment_attempts SET status='pending',error=?,updated_at=? WHERE id=? AND status='verifying'",
      )
      .bind(VERIFY_UNKNOWN, now, attempt.id)
      .run();
    return back("pending", attempt);
  }
  if (!verified.ok) return fail(`verify_${verified.code}`);
  await db.batch([
    db
      .prepare(
        "UPDATE reservations SET payment_status='paid',paid_at=?,status=CASE WHEN (SELECT auto_confirm FROM branch_settings WHERE branch_id=reservations.branch_id)=0 THEN 'pending' ELSE 'confirmed' END,updated_at=? WHERE id=? AND status='pending' AND payment_status='pending'",
      )
      .bind(now, now, attempt.reservation_id),
    // Released while the customer was at the bank: the money is kept on record so staff refund it.
    db
      .prepare(
        "UPDATE reservations SET payment_status='paid',paid_at=?,updated_at=? WHERE id=? AND payment_status IN ('pending','failed') AND changes()=0",
      )
      .bind(now, now, attempt.reservation_id),
    db
      .prepare(
        "INSERT INTO payment_transactions (id,reservation_id,branch_id,type,amount_rials,status,provider,reference,created_at) SELECT ?,id,branch_id,'payment',?,'success',?,?,? FROM reservations WHERE id=? AND payment_status='paid' AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE reservation_id=? AND provider=? AND reference=? AND type='payment')",
      )
      .bind(
        randomId("payment"),
        Number(attempt.amount_rials),
        provider,
        verified.reference,
        now,
        attempt.reservation_id,
        attempt.reservation_id,
        provider,
        verified.reference,
      ),
    db
      .prepare(
        // A second payment for a reservation another attempt already paid is also late: it is
        // recorded for a refund rather than reported to the customer as their booking payment.
        "UPDATE payment_attempts SET status=CASE WHEN (SELECT status FROM reservations WHERE id=?) IN ('pending','confirmed') AND (SELECT COUNT(*) FROM payment_transactions WHERE reservation_id=? AND type='payment' AND status='success')=1 THEN 'paid' ELSE 'paid_late' END,reference=?,card_pan=?,updated_at=? WHERE id=?",
      )
      .bind(
        attempt.reservation_id,
        attempt.reservation_id,
        verified.reference,
        verified.cardPan,
        now,
        attempt.id,
      ),
  ]);
  const settled = await db
    .prepare("SELECT status FROM payment_attempts WHERE id=?")
    .bind(attempt.id)
    .first();
  if (settled?.status !== "paid") return back("late", attempt);
  const row = await db
    .prepare("SELECT * FROM reservations WHERE id=?")
    .bind(attempt.reservation_id)
    .first();
  await notifyPaid(env, row);
  return back("success", attempt);
}
async function notifyPaid(env, row) {
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
}
export async function payReservationDemo(env, row) {
  if (!isDemo(env))
    return reply(
      { error: "payment_not_configured", message: "پرداخت آزمایشی در این محیط فعال نیست." },
      503,
    );
  const blocked = await paymentBlocked(env, row);
  if (blocked) return blocked;
  const now = new Date().toISOString();
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
  await notifyPaid(env, row);
  return reply({ ...publicReservation(updated), reference });
}
/** @param {"zarinpal" | "demo" | "none"} mode */
export async function readPayments(db, session, url, mode) {
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
    mode,
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
// Real money (gateway) is returned from the gateway's own panel; this records it (provider
// "manual") and releases the reservation. A demo payment's refund is simulated, and only in demo
// mode. Each payment is refunded at most once (the refund's reference names it). When the
// reservation holds another payment that is still unrefunded, as after a duplicate payment, the
// refund is recorded without cancelling the reservation.
export async function refundPayment(db, session, transactionId, { demo = false } = {}) {
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
  const manual = row.provider !== "demo";
  if (!manual && !demo) return reply({ error: "payment_not_configured" }, 503);
  const now = new Date().toISOString(),
    reference = `${manual ? "REF-MANUAL" : "REF-DEMO"}-${row.id}`,
    alreadyRefunded = () =>
      reply(
        {
          error: "already_refunded",
          message: "این بیعانه قبلاً بازپرداخت شده یا قابل بازپرداخت نیست.",
        },
        409,
      ),
    insertRefund = (condition) =>
      db
        .prepare(
          `INSERT INTO payment_transactions (id,reservation_id,branch_id,type,amount_rials,status,provider,reference,created_at) SELECT ?,id,branch_id,'refund',?,'success',?,?,? FROM reservations WHERE id=? AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE type='refund' AND reference=?) AND ${condition}`,
        )
        .bind(
          randomId("payment"),
          row.amount_rials,
          manual ? "manual" : "demo",
          reference,
          now,
          row.reservation_id,
          reference,
        );
  const others = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM payment_transactions p WHERE p.reservation_id=? AND p.id!=? AND p.type='payment' AND p.status='success' AND NOT EXISTS (SELECT 1 FROM payment_transactions r WHERE r.type='refund' AND r.reference LIKE '%-'||p.id)",
    )
    .bind(row.reservation_id, row.id)
    .first();
  if (Number(others?.count || 0) > 0) {
    const [inserted] = await db.batch([insertRefund("1")]);
    if (!inserted.meta?.changes) return alreadyRefunded();
    return reply({ refunded: true, manual, reference });
  }
  const result = await db.batch([
    db
      .prepare(
        "UPDATE reservations SET payment_status='refunded',status=CASE WHEN status IN ('pending','confirmed','arrived') THEN 'cancelled' ELSE status END,updated_at=? WHERE id=? AND payment_status='paid'",
      )
      .bind(now, row.reservation_id),
    insertRefund("changes()=1"),
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
  if (!result[0].meta?.changes) return alreadyRefunded();
  return reply({ refunded: true, manual, reference });
}
