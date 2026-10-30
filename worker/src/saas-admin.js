import { reply } from "./http.js";
import {
  pricedSubscription,
  subscriptionStanding,
  subscriptionUnitPriceRials,
} from "./subscription.js";
import { randomId } from "./util/ids.js";
// The SaaS console trusts the oai-authenticated-user-* headers only when the host is configured to
// set them itself (SAAS_ADMIN_AUTH=oai-header). Elsewhere, such as plain Cloudflare Workers, a
// client could send them and claim the console, so it stays closed.
/** @param {import("./types").Env} env @param {Request} request */
export async function requireSaasAdmin(env, request) {
  if (env.SAAS_ADMIN_AUTH !== "oai-header" || !env.DB) return null;
  const db = env.DB,
    id = request.headers.get("oai-authenticated-user-id");
  if (!id) return null;
  const email = request.headers.get("oai-authenticated-user-email") || "",
    existing = await db.prepare("SELECT id FROM saas_admins WHERE id=? LIMIT 1").bind(id).first();
  if (existing) {
    await db
      .prepare("UPDATE saas_admins SET email=?,last_seen_at=? WHERE id=?")
      .bind(email, new Date().toISOString(), id)
      .run();
    return { id, email };
  }
  const count = await db.prepare("SELECT COUNT(*) AS count FROM saas_admins").first();
  if (Number(count?.count || 0) > 0) return null;
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO saas_admins (id,email,created_at,last_seen_at) VALUES (?,?,?,?)")
    .bind(id, email, now, now)
    .run();
  return { id, email };
}
export async function readSaasOverview(db) {
  const result = await db
      .prepare(
        "SELECT c.id,c.name,c.slug,COUNT(DISTINCT CASE WHEN b.active=1 THEN b.id END) AS branch_count,COALESCE(s.enabled,0) AS enabled,COALESCE(s.status,'inactive') AS status,s.trial_ends_at,s.current_period_ends_at,s.updated_at,c.created_at FROM cafes c LEFT JOIN branches b ON b.cafe_id=c.id LEFT JOIN saas_subscriptions s ON s.cafe_id=c.id WHERE c.slug!='roma' GROUP BY c.id ORDER BY c.created_at DESC",
      )
      .all(),
    cafes = (result.results || []).map((row) => {
      const offer = pricedSubscription(row.branch_count),
        standing = subscriptionStanding(row);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        branchCount: offer.activeBranchCount,
        enabled: Boolean(row.enabled),
        plan: "standard",
        status: standing.status,
        bookingPaused: standing.bookingPaused,
        graceEndsAt: standing.graceEndsAt,
        unitPriceRials: offer.unitPriceRials,
        monthlyPriceRials: offer.monthlyPriceRials,
        trialEndsAt: row.trial_ends_at,
        currentPeriodEndsAt: row.current_period_ends_at,
        createdAt: row.created_at,
      };
    });
  // A bank reference that appears on more than one transfer is flagged for a closer look.
  const pending = await db
    .prepare(
      "SELECT p.id,p.cafe_id,p.amount_rials,p.months,p.reference,p.card_last4,p.created_at,c.name AS cafe_name,(SELECT COUNT(*) FROM subscription_payments d WHERE d.reference=p.reference AND d.id!=p.id) AS duplicates FROM subscription_payments p JOIN cafes c ON c.id=p.cafe_id WHERE p.status='submitted' ORDER BY p.created_at",
    )
    .all();
  return {
    unitPriceRials: subscriptionUnitPriceRials,
    pendingPayments: (pending.results || []).map((row) => ({
      id: row.id,
      cafeId: row.cafe_id,
      cafeName: row.cafe_name,
      amountRials: Number(row.amount_rials),
      months: Number(row.months),
      reference: row.reference,
      cardLast4: row.card_last4 || "",
      createdAt: row.created_at,
      duplicateReference: Number(row.duplicates) > 0,
    })),
    stats: {
      cafes: cafes.length,
      enabled: cafes.filter((item) => item.enabled).length,
      trials: cafes.filter((item) => item.status === "trial").length,
      active: cafes.filter((item) => item.status === "active").length,
      pastDue: cafes.filter((item) => item.status === "past_due").length,
      paused: cafes.filter((item) => item.bookingPaused).length,
      mrrRials: cafes
        .filter((item) => item.status === "active" && item.enabled)
        .reduce((sum, item) => sum + item.monthlyPriceRials, 0),
    },
    cafes,
  };
}
export async function updateSaasAccount(db, body) {
  const cafeId = String(body.cafeId || ""),
    [cafeRow, currentRow, branchRow] = await db.batch([
      db.prepare("SELECT id FROM cafes WHERE id=? LIMIT 1").bind(cafeId),
      db
        .prepare("SELECT enabled,plan,status FROM saas_subscriptions WHERE cafe_id=? LIMIT 1")
        .bind(cafeId),
      db
        .prepare("SELECT COUNT(*) AS count FROM branches WHERE cafe_id=? AND active=1")
        .bind(cafeId),
    ]),
    cafe = cafeRow.results?.[0],
    current = currentRow.results?.[0];
  if (!cafe) return reply({ error: "cafe_not_found" }, 404);
  const plan = "standard",
    enabled = body.enabled !== false,
    status =
      enabled && ["trial", "active", "past_due"].includes(body.status) ? body.status : "inactive",
    price = pricedSubscription(branchRow.results?.[0]?.count).monthlyPriceRials,
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO saas_subscriptions (cafe_id,enabled,plan,status,monthly_price_rials,trial_ends_at,current_period_ends_at,created_at,updated_at) VALUES (?,?,?,?,?,NULL,NULL,?,?) ON CONFLICT(cafe_id) DO UPDATE SET enabled=excluded.enabled,plan=excluded.plan,status=excluded.status,monthly_price_rials=excluded.monthly_price_rials,updated_at=excluded.updated_at",
      )
      .bind(cafeId, enabled ? 1 : 0, plan, status, price, now, now),
    db
      .prepare(
        "INSERT INTO subscription_events (id,cafe_id,type,from_plan,to_plan,amount_rials,note,created_at) VALUES (?,?, 'saas_admin_update',?,?,?,?,?)",
      )
      .bind(
        randomId("subevent"),
        cafeId,
        current?.plan || null,
        plan,
        0,
        "ویرایش از پنل مرکزی SaaS",
        now,
      ),
  ]);
  return reply(await readSaasOverview(db));
}

// The platform owner's decision on a café's card-to-card subscription payment. Approving extends
// the paid period by 30 days per month paid, from today or from the current period's end if later.
/** @param {any} db @param {{ id: string }} admin @param {string} paymentId @param {boolean} approve */
export async function reviewSubscriptionPayment(db, admin, paymentId, approve) {
  const payment = await db
    .prepare(
      "SELECT p.*,s.current_period_ends_at FROM subscription_payments p LEFT JOIN saas_subscriptions s ON s.cafe_id=p.cafe_id WHERE p.id=? LIMIT 1",
    )
    .bind(paymentId)
    .first();
  if (!payment) return reply({ error: "payment_not_found" }, 404);
  const alreadyReviewed = () =>
    reply({ error: "already_reviewed", message: "این پرداخت قبلاً بررسی شده است." }, 409);
  if (payment.status !== "submitted") return alreadyReviewed();
  const now = new Date(),
    nowIso = now.toISOString(),
    review = db
      .prepare(
        "UPDATE subscription_payments SET status=?,reviewed_at=?,reviewed_by=? WHERE id=? AND status='submitted'",
      )
      .bind(approve ? "approved" : "rejected", nowIso, admin.id, payment.id);
  if (!approve) {
    const [result] = await db.batch([
      review,
      db
        .prepare(
          "INSERT INTO subscription_events (id,cafe_id,type,from_plan,to_plan,amount_rials,note,created_at) SELECT ?,?,'payment_rejected','standard','standard',?,?,? WHERE changes()=1",
        )
        .bind(
          randomId("subevent"),
          payment.cafe_id,
          Number(payment.amount_rials),
          `واریز با پیگیری ${payment.reference} تأیید نشد`,
          nowIso,
        ),
    ]);
    if (!result.meta?.changes) return alreadyReviewed();
    return reply(await readSaasOverview(db));
  }
  const currentEnd = Date.parse(payment.current_period_ends_at || ""),
    start = Number.isFinite(currentEnd) && currentEnd > now.getTime() ? currentEnd : now.getTime(),
    periodEnd = new Date(start + Number(payment.months || 1) * 30 * 86400000).toISOString();
  const [result] = await db.batch([
    review,
    db
      .prepare(
        "UPDATE saas_subscriptions SET enabled=1,status='active',current_period_ends_at=?,updated_at=? WHERE cafe_id=? AND changes()=1",
      )
      .bind(periodEnd, nowIso, payment.cafe_id),
    db
      .prepare(
        "INSERT INTO subscription_events (id,cafe_id,type,from_plan,to_plan,amount_rials,note,created_at) SELECT ?,?,'payment_card','standard','standard',?,?,? WHERE changes()=1",
      )
      .bind(
        randomId("subevent"),
        payment.cafe_id,
        Number(payment.amount_rials),
        `کارت به کارت · پیگیری ${payment.reference}`,
        nowIso,
      ),
  ]);
  if (!result.meta?.changes) return alreadyReviewed();
  return reply(await readSaasOverview(db));
}
