import { branchRow } from "./branches.js";
import { reply } from "./http.js";
import { randomId } from "./util/ids.js";
export const subscriptionUnitPriceRials = 4900000;
export const subscriptionOffer = {
  id: "standard",
  name: "اشتراک کامل میزو",
  features: ["همه امکانات میزو", "قیمت ثابت برای هر شعبه فعال", "هزینه پیامک جدا و بر اساس مصرف"],
};
export function pricedSubscription(activeBranchCount) {
  const count = Math.max(0, Number(activeBranchCount) || 0);
  return {
    ...subscriptionOffer,
    activeBranchCount: count,
    unitPriceRials: subscriptionUnitPriceRials,
    monthlyPriceRials: count * subscriptionUnitPriceRials,
  };
}
export async function readSubscription(db, cafeId) {
  const [row, branches, events] = await db.batch([
      db
        .prepare(
          "SELECT cafe_id,enabled,plan,status,monthly_price_rials,trial_ends_at,current_period_ends_at,created_at,updated_at FROM saas_subscriptions WHERE cafe_id=? LIMIT 1",
        )
        .bind(cafeId),
      db
        .prepare("SELECT COUNT(*) AS count FROM branches WHERE cafe_id=? AND active=1")
        .bind(cafeId),
      db
        .prepare(
          "SELECT id,type,from_plan,to_plan,amount_rials,note,created_at FROM subscription_events WHERE cafe_id=? ORDER BY created_at DESC LIMIT 12",
        )
        .bind(cafeId),
    ]),
    subscription = row.results?.[0],
    offer = pricedSubscription(branches.results?.[0]?.count);
  return {
    optional: true,
    enabled: Boolean(subscription?.enabled),
    plan: "standard",
    status: subscription?.status || "inactive",
    monthlyPriceRials: offer.monthlyPriceRials,
    activeBranchCount: offer.activeBranchCount,
    unitPriceRials: offer.unitPriceRials,
    offer,
    trialEndsAt: subscription?.trial_ends_at || null,
    currentPeriodEndsAt: subscription?.current_period_ends_at || null,
    events: (events.results || []).map((item) => ({
      id: item.id,
      type: item.type,
      fromPlan: item.from_plan,
      toPlan: item.to_plan,
      amountRials: item.amount_rials,
      note: item.note,
      createdAt: item.created_at,
    })),
  };
}
export async function updateSubscription(db, session, body) {
  if (session.role !== "owner")
    return reply(
      { error: "forbidden", message: "فقط مالک کافه می‌تواند اشتراک را مدیریت کند." },
      403,
    );
  const [currentRow, branchRow] = await db.batch([
      db
        .prepare(
          "SELECT enabled,plan,status,trial_ends_at,current_period_ends_at FROM saas_subscriptions WHERE cafe_id=? LIMIT 1",
        )
        .bind(session.cafe_id),
      db
        .prepare("SELECT COUNT(*) AS count FROM branches WHERE cafe_id=? AND active=1")
        .bind(session.cafe_id),
    ]),
    current = currentRow.results?.[0],
    enabled = body.enabled === true,
    plan = "standard",
    now = new Date().toISOString(),
    firstActivation = enabled && !current,
    status = enabled
      ? firstActivation
        ? "trial"
        : ["trial", "active", "past_due"].includes(current?.status) && current.status !== "inactive"
          ? current.status
          : "past_due"
      : "inactive",
    trialEndsAt = firstActivation
      ? new Date(Date.now() + 14 * 86400000).toISOString()
      : current?.trial_ends_at || null,
    price = pricedSubscription(branchRow.results?.[0]?.count).monthlyPriceRials,
    type = !enabled ? "disabled" : firstActivation ? "activated" : "updated",
    eventId = randomId("subevent");
  await db.batch([
    db
      .prepare(
        "INSERT INTO saas_subscriptions (cafe_id,enabled,plan,status,monthly_price_rials,trial_ends_at,current_period_ends_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(cafe_id) DO UPDATE SET enabled=excluded.enabled,plan=excluded.plan,status=excluded.status,monthly_price_rials=excluded.monthly_price_rials,trial_ends_at=excluded.trial_ends_at,updated_at=excluded.updated_at",
      )
      .bind(
        session.cafe_id,
        enabled ? 1 : 0,
        plan,
        status,
        price,
        trialEndsAt,
        current?.current_period_ends_at || null,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO subscription_events (id,cafe_id,type,from_plan,to_plan,amount_rials,note,created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(
        eventId,
        session.cafe_id,
        type,
        current?.plan || null,
        plan,
        0,
        enabled
          ? "تنظیمات اشتراک توسط مالک کافه تغییر کرد"
          : "ماژول اشتراک توسط مالک کافه غیرفعال شد",
        now,
      ),
  ]);
  return reply(await readSubscription(db, session.cafe_id));
}
export async function renewSubscriptionDemo(db, session) {
  if (session.role !== "owner") return reply({ error: "forbidden" }, 403);
  const [currentRow, branchRow] = await db.batch([
      db
        .prepare("SELECT enabled,plan FROM saas_subscriptions WHERE cafe_id=? LIMIT 1")
        .bind(session.cafe_id),
      db
        .prepare("SELECT COUNT(*) AS count FROM branches WHERE cafe_id=? AND active=1")
        .bind(session.cafe_id),
    ]),
    current = currentRow.results?.[0];
  if (!current?.enabled)
    return reply(
      { error: "subscription_disabled", message: "ابتدا ماژول اشتراک را فعال کنید." },
      409,
    );
  const plan = "standard",
    price = pricedSubscription(branchRow.results?.[0]?.count).monthlyPriceRials,
    now = new Date().toISOString(),
    periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE saas_subscriptions SET status='active',plan=?,monthly_price_rials=?,current_period_ends_at=?,updated_at=? WHERE cafe_id=?",
      )
      .bind(plan, price, periodEnd, now, session.cafe_id),
    db
      .prepare(
        "INSERT INTO subscription_events (id,cafe_id,type,from_plan,to_plan,amount_rials,note,created_at) VALUES (?,?, 'payment_demo',?,?,?,'پرداخت آزمایشی ثبت شد',?)",
      )
      .bind(randomId("subevent"), session.cafe_id, current.plan || null, plan, price, now),
  ]);
  return reply(await readSubscription(db, session.cafe_id));
}
