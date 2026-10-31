import { reply } from "./http.js";
import { validCardNumber } from "./util/card.js";
import { isDemo } from "./util/env.js";
import { randomId } from "./util/ids.js";
import { normalizeDigits } from "./util/mobile.js";
export const subscriptionUnitPriceRials = 4900000;
export const subscriptionOffer = {
  id: "standard",
  name: "اشتراک کامل میزو",
  features: ["همه امکانات میزو", "قیمت ثابت برای هر شعبه فعال", "هزینه پیامک جدا و بر اساس مصرف"],
};
const DAY = 86400000;
// Days a café keeps online booking after its trial or paid period ends without payment.
export const SUBSCRIPTION_GRACE_DAYS = 3;
// Where a subscription stands at `now`. A trial or paid period that has ended counts as past_due
// even before the scheduled job records it, and online booking pauses once the grace period is
// over. A subscription that is off, or has no end date (set by the SaaS admin), never pauses.
export function subscriptionStanding(row, now = Date.now()) {
  const status = row?.status || "inactive",
    idle = { status, endsAt: null, graceEndsAt: null, bookingPaused: false };
  if (!row?.enabled || !["trial", "active", "past_due"].includes(status)) return idle;
  const endsAt =
      status === "trial"
        ? row.trial_ends_at
        : status === "active"
          ? row.current_period_ends_at
          : row.current_period_ends_at || row.trial_ends_at || row.updated_at,
    end = Date.parse(endsAt || "");
  if (!Number.isFinite(end)) return status === "past_due" ? { ...idle, bookingPaused: true } : idle;
  if (status !== "past_due" && end > now) return { ...idle, endsAt };
  const graceEnd = end + SUBSCRIPTION_GRACE_DAYS * DAY;
  return {
    status: "past_due",
    endsAt,
    graceEndsAt: new Date(graceEnd).toISOString(),
    bookingPaused: now >= graceEnd,
  };
}
/** @param {any} db @param {string} cafeId */
export async function onlineBookingPaused(db, cafeId) {
  const row = await db
    .prepare(
      "SELECT enabled,status,trial_ends_at,current_period_ends_at,updated_at FROM saas_subscriptions WHERE cafe_id=? LIMIT 1",
    )
    .bind(cafeId)
    .first();
  return subscriptionStanding(row).bookingPaused;
}
/** The same, by café slug, in one query. @param {any} db @param {string} slug */
export async function onlineBookingPausedBySlug(db, slug) {
  const row = await db
    .prepare(
      "SELECT s.enabled,s.status,s.trial_ends_at,s.current_period_ends_at,s.updated_at FROM saas_subscriptions s JOIN cafes c ON c.id=s.cafe_id WHERE c.slug=? LIMIT 1",
    )
    .bind(slug)
    .first();
  return subscriptionStanding(row).bookingPaused;
}
// Scheduled: records ended trials and paid periods as past_due, with an entry in each café's history.
/** @param {any} db */
export async function expireSubscriptions(db, now = new Date().toISOString()) {
  const ended =
    "enabled=1 AND ((status='trial' AND trial_ends_at IS NOT NULL AND trial_ends_at<=?) OR (status='active' AND current_period_ends_at IS NOT NULL AND current_period_ends_at<=?))";
  await db.batch([
    db
      .prepare(
        `INSERT INTO subscription_events (id,cafe_id,type,from_plan,to_plan,amount_rials,note,created_at) SELECT 'subevent:'||lower(hex(randomblob(16))),cafe_id,'expired',plan,plan,0,CASE status WHEN 'trial' THEN 'پایان دوره آزمایشی' ELSE 'پایان دوره پرداخت‌شده' END,? FROM saas_subscriptions WHERE ${ended}`,
      )
      .bind(now, now, now),
    db
      .prepare(`UPDATE saas_subscriptions SET status='past_due',updated_at=? WHERE ${ended}`)
      .bind(now, now, now),
  ]);
}
export function pricedSubscription(activeBranchCount) {
  const count = Math.max(0, Number(activeBranchCount) || 0);
  return {
    ...subscriptionOffer,
    activeBranchCount: count,
    unitPriceRials: subscriptionUnitPriceRials,
    monthlyPriceRials: count * subscriptionUnitPriceRials,
  };
}
// How cafés may pay the platform: the platform's card for card-to-card transfers (configured with
// SUBSCRIPTION_CARD_NUMBER and SUBSCRIPTION_CARD_HOLDER) and, in demo mode, a simulated renewal.
/** @param {import("./types").Env} env */
export function subscriptionPaymentOptions(env) {
  const cardNumber = validCardNumber(env.SUBSCRIPTION_CARD_NUMBER);
  return {
    card: cardNumber ? { cardNumber, cardHolder: env.SUBSCRIPTION_CARD_HOLDER || "" } : null,
    demo: isDemo(env),
  };
}
/** @param {any} db @param {string} cafeId @param {{ card?: { cardNumber: string, cardHolder: string } | null, demo?: boolean }} [options] */
export async function readSubscription(db, cafeId, options = {}) {
  const [row, branches, events, pending] = await db.batch([
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
      db
        .prepare(
          "SELECT id,amount_rials,reference,created_at FROM subscription_payments WHERE cafe_id=? AND status='submitted' ORDER BY created_at DESC LIMIT 1",
        )
        .bind(cafeId),
    ]),
    pendingRow = pending.results?.[0],
    subscription = row.results?.[0],
    standing = subscriptionStanding(subscription),
    offer = pricedSubscription(branches.results?.[0]?.count);
  return {
    optional: true,
    enabled: Boolean(subscription?.enabled),
    plan: "standard",
    status: standing.status,
    endsAt: standing.endsAt,
    graceEndsAt: standing.graceEndsAt,
    bookingPaused: standing.bookingPaused,
    monthlyPriceRials: offer.monthlyPriceRials,
    activeBranchCount: offer.activeBranchCount,
    unitPriceRials: offer.unitPriceRials,
    offer,
    trialEndsAt: subscription?.trial_ends_at || null,
    currentPeriodEndsAt: subscription?.current_period_ends_at || null,
    payment: {
      card: options.card || null,
      demo: Boolean(options.demo),
      pending: pendingRow
        ? {
            id: pendingRow.id,
            amountRials: Number(pendingRow.amount_rials),
            reference: pendingRow.reference,
            createdAt: pendingRow.created_at,
          }
        : null,
    },
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
export async function updateSubscription(db, session, body, options = {}) {
  if (session.role !== "owner")
    return reply(
      { error: "forbidden", message: "فقط مالک کافه می‌تواند اشتراک را مدیریت کند." },
      403,
    );
  const [currentRow, branchRow] = await db.batch([
      db
        .prepare(
          "SELECT enabled,plan,status,trial_ends_at,current_period_ends_at,updated_at FROM saas_subscriptions WHERE cafe_id=? LIMIT 1",
        )
        .bind(session.cafe_id),
      db
        .prepare("SELECT COUNT(*) AS count FROM branches WHERE cafe_id=? AND active=1")
        .bind(session.cafe_id),
    ]),
    current = currentRow.results?.[0],
    enabled = body.enabled === true;
  // Turning the subscription off must not become a way around an unpaid period.
  if (!enabled && subscriptionStanding(current).status === "past_due")
    return reply(
      {
        error: "payment_required",
        message: "دوره اشتراک تمام شده است؛ پیش از غیرفعال‌کردن، اشتراک را پرداخت کنید.",
      },
      409,
    );
  const plan = "standard",
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
  return reply(await readSubscription(db, session.cafe_id, options));
}
export async function renewSubscriptionDemo(db, session, options = {}) {
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
  return reply(await readSubscription(db, session.cafe_id, options));
}

// A café owner reports a card-to-card transfer of one month's fee to the platform's card. It waits
// for the platform owner to find it in the bank account and approve it in the SaaS console.
export async function submitSubscriptionTransfer(db, session, body, options) {
  if (session.role !== "owner")
    return reply(
      { error: "forbidden", message: "فقط مالک کافه می‌تواند اشتراک را پرداخت کند." },
      403,
    );
  if (!options.card)
    return reply(
      { error: "card_transfer_not_configured", message: "پرداخت کارت به کارت اشتراک فعال نیست." },
      503,
    );
  const reference = normalizeDigits(body.reference).replace(/[\s-]/g, ""),
    cardLast4 = normalizeDigits(body.cardLast4).replace(/\s/g, "");
  if (!/^[A-Za-z0-9]{4,40}$/.test(reference))
    return reply(
      { error: "invalid_reference", message: "شماره پیگیری انتقال را درست وارد کنید." },
      400,
    );
  if (cardLast4 && !/^\d{4}$/.test(cardLast4))
    return reply(
      { error: "invalid_card_last4", message: "چهار رقم آخر کارت خود را وارد کنید." },
      400,
    );
  const subscription = await readSubscription(db, session.cafe_id, options);
  if (!subscription.enabled)
    return reply(
      { error: "subscription_disabled", message: "ابتدا ماژول اشتراک را فعال کنید." },
      409,
    );
  if (!subscription.monthlyPriceRials)
    return reply({ error: "nothing_to_pay", message: "شعبه فعالی برای پرداخت وجود ندارد." }, 409);
  const now = new Date().toISOString(),
    id = randomId("subpay");
  // At most one transfer per café waits for review at a time.
  const [inserted] = await db.batch([
    db
      .prepare(
        "INSERT INTO subscription_payments (id,cafe_id,amount_rials,months,method,reference,card_last4,status,created_at) SELECT ?,?,?,1,'card',?,?,'submitted',? WHERE NOT EXISTS (SELECT 1 FROM subscription_payments WHERE cafe_id=? AND status='submitted')",
      )
      .bind(
        id,
        session.cafe_id,
        subscription.monthlyPriceRials,
        reference,
        cardLast4 || null,
        now,
        session.cafe_id,
      ),
    db
      .prepare(
        "INSERT INTO subscription_events (id,cafe_id,type,from_plan,to_plan,amount_rials,note,created_at) SELECT ?,?,'payment_submitted','standard','standard',?,?,? WHERE changes()=1",
      )
      .bind(
        randomId("subevent"),
        session.cafe_id,
        subscription.monthlyPriceRials,
        `کارت به کارت · پیگیری ${reference}`,
        now,
      ),
  ]);
  if (!inserted.meta?.changes)
    return reply(
      {
        error: "payment_pending",
        message: "پرداخت قبلی شما هنوز در انتظار تأیید است.",
      },
      409,
    );
  return reply(await readSubscription(db, session.cafe_id, options));
}
