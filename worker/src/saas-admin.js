import { reply } from "./http.js";
import { pricedSubscription, subscriptionUnitPriceRials } from "./subscription.js";
import { randomId } from "./util/ids.js";
export async function requireSaasAdmin(db, request) {
  const id = request.headers.get("oai-authenticated-user-id");
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
        "SELECT c.id,c.name,c.slug,COUNT(DISTINCT CASE WHEN b.active=1 THEN b.id END) AS branch_count,COALESCE(s.enabled,0) AS enabled,COALESCE(s.status,'inactive') AS status,s.trial_ends_at,s.current_period_ends_at,c.created_at FROM cafes c LEFT JOIN branches b ON b.cafe_id=c.id LEFT JOIN saas_subscriptions s ON s.cafe_id=c.id WHERE c.slug!='roma' GROUP BY c.id ORDER BY c.created_at DESC",
      )
      .all(),
    cafes = (result.results || []).map((row) => {
      const offer = pricedSubscription(row.branch_count);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        branchCount: offer.activeBranchCount,
        enabled: Boolean(row.enabled),
        plan: "standard",
        status: row.status,
        unitPriceRials: offer.unitPriceRials,
        monthlyPriceRials: offer.monthlyPriceRials,
        trialEndsAt: row.trial_ends_at,
        currentPeriodEndsAt: row.current_period_ends_at,
        createdAt: row.created_at,
      };
    });
  return {
    unitPriceRials: subscriptionUnitPriceRials,
    stats: {
      cafes: cafes.length,
      enabled: cafes.filter((item) => item.enabled).length,
      trials: cafes.filter((item) => item.status === "trial").length,
      active: cafes.filter((item) => item.status === "active").length,
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
