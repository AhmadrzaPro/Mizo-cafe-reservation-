import { hasPermission } from "./auth/session.js";
import { reply } from "./http.js";
export async function readReports(db, session, url) {
  if (!hasPermission(session, "reports.read"))
    return reply({ error: "forbidden", message: "به گزارش‌ها دسترسی ندارید." }, 403);
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days")))
      ? Number(url.searchParams.get("days"))
      : 30,
    start = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10),
    requestedBranch = String(url.searchParams.get("branch") || ""),
    branchId = session.role === "owner" ? requestedBranch : session.branch_id || "";
  if (branchId) {
    const allowed = await db
      .prepare("SELECT id FROM branches WHERE id=? AND cafe_id=? LIMIT 1")
      .bind(branchId, session.cafe_id)
      .first();
    if (!allowed) return reply({ error: "invalid_branch" }, 400);
  }
  const suffix = branchId ? " AND b.id=?" : "",
    bindValues = branchId
      ? [session.cafe_id, `${start}T00:00`, branchId]
      : [session.cafe_id, `${start}T00:00`];
  const [summaryResult, dailyResult, hoursResult, branchesResult, repeatResult] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) AS reservations,COALESCE(SUM(r.party_size),0) AS guests,SUM(CASE WHEN r.status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN r.status='no_show' THEN 1 ELSE 0 END) AS no_show,COUNT(DISTINCT NULLIF(r.mobile,'')) AS unique_customers FROM reservations r JOIN branches b ON b.id=r.branch_id WHERE b.cafe_id=? AND r.reserved_at>=?${suffix}`,
      )
      .bind(...bindValues),
    db
      .prepare(
        `SELECT SUBSTR(r.reserved_at,1,10) AS day,COUNT(*) AS reservations,COALESCE(SUM(r.party_size),0) AS guests FROM reservations r JOIN branches b ON b.id=r.branch_id WHERE b.cafe_id=? AND r.reserved_at>=?${suffix} GROUP BY day ORDER BY day`,
      )
      .bind(...bindValues),
    db
      .prepare(
        `SELECT SUBSTR(r.reserved_at,12,2) AS hour,COUNT(*) AS reservations FROM reservations r JOIN branches b ON b.id=r.branch_id WHERE b.cafe_id=? AND r.reserved_at>=?${suffix} GROUP BY hour ORDER BY reservations DESC,hour LIMIT 6`,
      )
      .bind(...bindValues),
    db
      .prepare(
        "SELECT b.id,b.name,COUNT(r.id) AS reservations,COALESCE(SUM(r.party_size),0) AS guests,SUM(CASE WHEN r.status='completed' THEN 1 ELSE 0 END) AS completed FROM branches b LEFT JOIN reservations r ON r.branch_id=b.id AND r.reserved_at>=? WHERE b.cafe_id=? AND b.active=1 GROUP BY b.id ORDER BY reservations DESC",
      )
      .bind(`${start}T00:00`, session.cafe_id),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM (SELECT r.mobile FROM reservations r JOIN branches b ON b.id=r.branch_id WHERE b.cafe_id=? AND r.reserved_at>=? AND r.mobile!=''${suffix} GROUP BY r.mobile HAVING COUNT(*)>1)`,
      )
      .bind(...bindValues),
  ]);
  const row = summaryResult.results?.[0] || {},
    reservations = Number(row.reservations || 0),
    completed = Number(row.completed || 0),
    noShow = Number(row.no_show || 0);
  return reply({
    days,
    start,
    branchId: branchId || null,
    summary: {
      reservations,
      guests: Number(row.guests || 0),
      completed,
      noShow,
      uniqueCustomers: Number(row.unique_customers || 0),
      repeatCustomers: Number(repeatResult.results?.[0]?.count || 0),
      completionRate: reservations ? Math.round((completed / reservations) * 100) : 0,
      noShowRate: reservations ? Math.round((noShow / reservations) * 100) : 0,
    },
    daily: (dailyResult.results || []).map((item) => ({
      date: item.day,
      reservations: Number(item.reservations),
      guests: Number(item.guests),
    })),
    busyHours: (hoursResult.results || []).map((item) => ({
      hour: `${item.hour}:00`,
      reservations: Number(item.reservations),
    })),
    branches: (branchesResult.results || [])
      .filter((item) => !branchId || item.id === branchId)
      .map((item) => ({
        id: item.id,
        name: item.name,
        reservations: Number(item.reservations),
        guests: Number(item.guests),
        completed: Number(item.completed || 0),
      })),
  });
}
