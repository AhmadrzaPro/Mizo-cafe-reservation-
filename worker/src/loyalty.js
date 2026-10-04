import { hasPermission } from "./auth/session.js";
import { reply } from "./http.js";
import { randomId } from "./util/ids.js";
export async function awardLoyaltyVisit(db, branch, reservation, now) {
  if (!reservation.customer_id) return;
  const existing = await db
    .prepare("SELECT id FROM loyalty_transactions WHERE reservation_id=? LIMIT 1")
    .bind(reservation.id)
    .first();
  if (existing) return;
  await db.batch([
    db
      .prepare(
        "INSERT INTO loyalty_transactions (id,cafe_id,customer_id,branch_id,reservation_id,type,points,note,created_at) VALUES (?,?,?,?,?,'visit',10,'امتیاز مراجعه تکمیل‌شده',?)",
      )
      .bind(
        randomId("loyalty"),
        branch.cafe_id,
        reservation.customer_id,
        branch.id,
        reservation.id,
        now,
      ),
    db
      .prepare(
        "UPDATE customers SET points=points+10,completed_visits=completed_visits+1,last_seen_at=? WHERE id=? AND cafe_id=?",
      )
      .bind(now, reservation.customer_id, branch.cafe_id),
  ]);
}
export async function readLoyalty(db, session, url) {
  if (!hasPermission(session, "loyalty.read"))
    return reply({ error: "forbidden", message: "به باشگاه مشتریان دسترسی ندارید." }, 403);
  const query = String(url.searchParams.get("q") || "")
      .trim()
      .slice(0, 60),
    escapedQuery = query.replace(/[\\%_]/g, "\\$&"),
    pattern = `%${escapedQuery}%`,
    branchScope =
      session.role === "owner"
        ? ""
        : " AND EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id=c.id AND r.branch_id=?)",
    listParams =
      session.role === "owner"
        ? [session.cafe_id, query, pattern, pattern]
        : [session.cafe_id, session.branch_id, query, pattern, pattern],
    result = await db
      .prepare(
        `SELECT c.id,c.name,c.mobile,c.points,c.completed_visits,c.last_seen_at,c.created_at FROM customers c WHERE c.cafe_id=?${branchScope} AND (?='' OR c.name LIKE ? ESCAPE '\\' OR c.mobile LIKE ? ESCAPE '\\') ORDER BY c.points DESC,c.last_seen_at DESC LIMIT 100`,
      )
      .bind(...listParams)
      .all(),
    customers = (result.results || []).map((row) => ({
      id: row.id,
      name: row.name,
      mobile: row.mobile,
      points: Number(row.points || 0),
      completedVisits: Number(row.completed_visits || 0),
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
    }));
  const statsParams =
      session.role === "owner" ? [session.cafe_id] : [session.cafe_id, session.branch_id],
    stats = await db
      .prepare(
        `SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN c.completed_visits>1 THEN 1 ELSE 0 END),0) AS returning_customers,COALESCE(SUM(c.points),0) AS points FROM customers c WHERE c.cafe_id=?${branchScope}`,
      )
      .bind(...statsParams)
      .first();
  return reply({
    pointsPerVisit: 10,
    rewardThreshold: 100,
    canWrite: hasPermission(session, "loyalty.write"),
    stats: {
      total: Number(stats?.total || 0),
      returning: Number(stats?.returning_customers || 0),
      points: Number(stats?.points || 0),
    },
    customers,
  });
}
export async function adjustLoyalty(db, session, customerId, body) {
  if (!hasPermission(session, "loyalty.write"))
    return reply({ error: "forbidden", message: "اجازه تغییر امتیاز مشتریان را ندارید." }, 403);
  if (!customerId || customerId.length > 180)
    return reply({ error: "invalid_customer", message: "شناسه مشتری معتبر نیست." }, 400);
  const points = Number(body.points),
    note = String(body.note || "")
      .trim()
      .slice(0, 120);
  if (!Number.isInteger(points) || points === 0 || points < -500 || points > 500)
    return reply(
      { error: "invalid_points", message: "مقدار امتیاز باید عددی بین ۵۰۰- تا ۵۰۰ باشد." },
      400,
    );
  const customer =
    session.role === "owner"
      ? await db
          .prepare("SELECT id,points FROM customers WHERE id=? AND cafe_id=? LIMIT 1")
          .bind(customerId, session.cafe_id)
          .first()
      : await db
          .prepare(
            "SELECT c.id,c.points FROM customers c WHERE c.id=? AND c.cafe_id=? AND EXISTS (SELECT 1 FROM reservations r WHERE r.customer_id=c.id AND r.branch_id=?) LIMIT 1",
          )
          .bind(customerId, session.cafe_id, session.branch_id)
          .first();
  if (!customer)
    return reply(
      { error: "customer_not_found", message: "مشتری پیدا نشد یا به این شعبه دسترسی ندارید." },
      404,
    );
  const now = new Date().toISOString(),
    results = await db.batch([
      db
        .prepare("UPDATE customers SET points=points+? WHERE id=? AND cafe_id=? AND points+?>=0")
        .bind(points, customerId, session.cafe_id, points),
      db
        .prepare(
          "INSERT INTO loyalty_transactions (id,cafe_id,customer_id,branch_id,reservation_id,type,points,note,created_at) SELECT ?,?,?,?,NULL,?,?,?,? WHERE changes()>0",
        )
        .bind(
          randomId("loyalty"),
          session.cafe_id,
          customerId,
          session.branch_id || null,
          points > 0 ? "bonus" : "redeem",
          points,
          note || (points > 0 ? "امتیاز تشویقی" : "استفاده از پاداش"),
          now,
        ),
    ]);
  if (!results?.[0]?.meta?.changes)
    return reply(
      { error: "insufficient_points", message: "امتیاز مشتری برای این کسر کافی نیست." },
      409,
    );
  return readLoyalty(db, session, new URL("https://local/api/loyalty"));
}
