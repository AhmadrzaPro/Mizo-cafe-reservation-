import { reply } from "./http.js";
import { layoutStatements, starterLayout } from "./map.js";
import { randomId, safeSlug } from "./util/ids.js";
import { normalizeMobile } from "./util/mobile.js";
export const defaultHours = () =>
  Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openTime: "10:00",
    closeTime: "23:00",
    closed: false,
  }));
/**
 * @param {D1Database} db
 * @param {string | null} [cafeSlug]
 * @param {import("./types").Staff | null} [session]
 */
export async function readSetup(db, cafeSlug = null, session = null) {
  let cafe;
  if (cafeSlug && safeSlug(cafeSlug))
    cafe = await db
      // The internal slug or the owner's link name; the slug wins if both somehow match.
      .prepare(
        "SELECT id,slug,name,link_slug,created_at FROM cafes WHERE slug=? OR link_slug=? ORDER BY slug=? DESC LIMIT 1",
      )
      .bind(cafeSlug, cafeSlug, cafeSlug)
      .first();
  else if (session)
    cafe = await db
      .prepare("SELECT id,slug,name,link_slug,created_at FROM cafes WHERE id=?")
      .bind(session.cafe_id)
      .first();
  if (!cafe) return { configured: false };
  const own = session?.cafe_id === cafe.id;
  /** @type {D1Result<{ id: string, slug: string, name: string, city: string, address: string, active: number, link_slug: string | null }>} */
  const result = await db
    .prepare(
      "SELECT id,slug,name,city,address,active,link_slug FROM branches WHERE cafe_id=? ORDER BY updated_at,id",
    )
    .bind(cafe.id)
    .all();
  const branches = (result.results || []).filter((b) => own || b.active);
  return {
    configured: true,
    cafe: {
      id: cafe.id,
      slug: cafe.slug,
      name: cafe.name,
      // The café's part of its booking links: the owner's link name, else the slug.
      link: cafe.link_slug || "",
      structure: branches.length > 1 || cafe.slug.startsWith("multi-") ? "multi" : "single",
    },
    branches: branches.map(({ link_slug, ...b }) => ({
      ...b,
      link: link_slug || "",
      active: Boolean(b.active),
    })),
  };
}
/**
 * @param {D1Database} db
 * @param {Record<string, any>} body
 * @param {import("./types").Staff | null} [session]
 */
export async function writeSetup(db, body, session = null) {
  const name = String(body.cafeName || "")
      .trim()
      .slice(0, 80),
    city = String(body.city || "")
      .trim()
      .slice(0, 60),
    branchName = String(body.branchName || "")
      .trim()
      .slice(0, 80),
    address = String(body.address || "")
      .trim()
      .slice(0, 180);
  if (name.length < 2 || city.length < 2 || branchName.length < 2)
    return reply({ error: "invalid_setup", message: "نام کافه، شهر و شعبه را وارد کنید." }, 400);
  if (session) {
    const current = await readSetup(db, null, session),
      branch = current.branches?.find((b) => b.slug === body.branchSlug);
    if (!branch) return reply({ error: "branch_not_found" }, 404);
    await db.batch([
      db.prepare("UPDATE cafes SET name=? WHERE id=?").bind(name, session.cafe_id),
      db
        .prepare(
          "UPDATE branches SET name=?,city=?,address=?,updated_at=? WHERE id=? AND cafe_id=?",
        )
        .bind(branchName, city, address, new Date().toISOString(), branch.id, session.cafe_id),
    ]);
    return reply(await readSetup(db, null, session));
  }
  const mobile = normalizeMobile(body.ownerMobile),
    ownerName = String(body.ownerName || name)
      .trim()
      .slice(0, 70);
  if (!mobile)
    return reply(
      { error: "owner_mobile_required", message: "شماره موبایل مالک را برای ورود امن وارد کنید." },
      400,
    );
  const recent = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM staff_members WHERE mobile=? AND role='owner' AND created_at>?",
    )
    .bind(mobile, new Date(Date.now() - 3600000).toISOString())
    .first();
  if (Number(recent?.count) > 2)
    return reply(
      { error: "rate_limited", message: "تعداد راه‌اندازی‌ها زیاد است؛ بعداً تلاش کنید." },
      429,
    );
  const cafeSlug = `${body.structure === "multi" ? "multi" : "cafe"}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
    cafeId = `cafe:${cafeSlug}`,
    branchId = `branch:${cafeSlug}:main`,
    now = new Date().toISOString();
  const statements = [
    db
      .prepare("INSERT INTO cafes (id,slug,name,created_at) VALUES (?,?,?,?)")
      .bind(cafeId, cafeSlug, name, now),
    db
      .prepare(
        "INSERT INTO branches (id,cafe_id,slug,name,city,address,space_mode,updated_at) VALUES (?,?,'main',?,?,?,'indoor',?)",
      )
      .bind(branchId, cafeId, branchName, city, address, now),
    db
      .prepare("INSERT INTO branch_settings (branch_id,updated_at) VALUES (?,?)")
      .bind(branchId, now),
    db
      .prepare(
        "INSERT INTO staff_members (id,cafe_id,mobile,name,role,active,created_at,updated_at) VALUES (?,?,?,?,'owner',1,?,?)",
      )
      .bind(randomId("staff"), cafeId, mobile, ownerName, now, now),
    // Every café is on the subscription, starting with a 14-day trial.
    db
      .prepare(
        "INSERT INTO saas_subscriptions (cafe_id,enabled,plan,status,monthly_price_rials,trial_ends_at,current_period_ends_at,created_at,updated_at) VALUES (?,1,'standard','trial',0,?,NULL,?,?)",
      )
      .bind(cafeId, new Date(Date.now() + 14 * 86400000).toISOString(), now, now),
    db
      .prepare(
        "INSERT INTO subscription_events (id,cafe_id,type,from_plan,to_plan,amount_rials,note,created_at) VALUES (?,?,'activated',NULL,'standard',0,'شروع دوره آزمایشی ۱۴ روزه',?)",
      )
      .bind(randomId("subevent"), cafeId, now),
  ];
  statements.push(...layoutStatements(db, branchId, starterLayout, now));
  for (const h of defaultHours())
    statements.push(
      db
        .prepare(
          "INSERT INTO operating_hours (branch_id,weekday,open_time,close_time,closed) VALUES (?,?,?,?,0)",
        )
        .bind(branchId, h.weekday, h.openTime, h.closeTime),
    );
  await db.batch(statements);
  return reply(await readSetup(db, cafeSlug), 201);
}
