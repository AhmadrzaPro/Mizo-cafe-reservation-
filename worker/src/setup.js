import { reply } from "./http.js";
import { randomId, safeSlug } from "./util/ids.js";
import { normalizeMobile } from "./util/mobile.js";
export const defaultHours = () =>
  Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openTime: "10:00",
    closeTime: "23:00",
    closed: false,
  }));
export const starterMap = {
  spaceMode: "indoor",
  areas: [{ id: "main", name: "سالن اصلی", kind: "indoor" }],
  tables: [
    {
      id: "t1",
      area: "main",
      name: "میز ۱",
      shape: "round",
      capacity: 2,
      x: 655,
      y: 62,
      reservable: true,
    },
    {
      id: "t2",
      area: "main",
      name: "میز ۲",
      shape: "round",
      capacity: 2,
      x: 505,
      y: 60,
      reservable: true,
    },
    {
      id: "t3",
      area: "main",
      name: "میز ۳",
      shape: "rect",
      capacity: 4,
      x: 345,
      y: 68,
      reservable: true,
    },
    {
      id: "t4",
      area: "main",
      name: "میز ۴",
      shape: "square",
      capacity: 2,
      x: 620,
      y: 230,
      reservable: true,
    },
    {
      id: "t5",
      area: "main",
      name: "میز ۵",
      shape: "round",
      capacity: 2,
      x: 430,
      y: 235,
      reservable: true,
    },
  ],
};
export async function readSetup(db, cafeSlug = null, session = null) {
  let cafe;
  if (cafeSlug && safeSlug(cafeSlug))
    cafe = await db
      .prepare("SELECT id,slug,name,created_at FROM cafes WHERE slug=?")
      .bind(cafeSlug)
      .first();
  else if (session)
    cafe = await db
      .prepare("SELECT id,slug,name,created_at FROM cafes WHERE id=?")
      .bind(session.cafe_id)
      .first();
  if (!cafe) return { configured: false };
  const own = session?.cafe_id === cafe.id;
  const result = await db
    .prepare(
      "SELECT id,slug,name,city,address,active FROM branches WHERE cafe_id=? ORDER BY updated_at,id",
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
      structure: branches.length > 1 || cafe.slug.startsWith("multi-") ? "multi" : "single",
    },
    branches: branches.map((b) => ({ ...b, active: Boolean(b.active) })),
  };
}
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
  ];
  for (const area of starterMap.areas)
    statements.push(
      db
        .prepare("INSERT INTO areas (id,branch_id,name,kind,sort_order) VALUES (?,?,?,'indoor',0)")
        .bind(`${branchId}:${area.id}`, branchId, area.name),
    );
  for (const t of starterMap.tables)
    statements.push(
      db
        .prepare(
          "INSERT INTO cafe_tables (id,area_id,name,shape,capacity,position_x,position_y,reservable,operational_status,updated_at) VALUES (?,?,?,?,?,?,?,1,'available',?)",
        )
        .bind(
          `${branchId}:${t.id}`,
          `${branchId}:${t.area}`,
          t.name,
          t.shape,
          t.capacity,
          t.x,
          t.y,
          now,
        ),
    );
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
