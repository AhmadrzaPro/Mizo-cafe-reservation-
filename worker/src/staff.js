import { hasPermission, roleLabel, staffPublic } from "./auth/session.js";
import { reply } from "./http.js";
import { randomId } from "./util/ids.js";
import { normalizeMobile } from "./util/mobile.js";
export async function listStaff(db, session) {
  if (!hasPermission(session, "staff.manage"))
    return reply(
      { error: "forbidden", message: "فقط مالک کافه می‌تواند فهرست پرسنل را ببیند." },
      403,
    );
  const result = await db
    .prepare(
      "SELECT s.id,s.name,s.mobile,s.role,s.active,s.branch_id,b.name AS branch_name FROM staff_members s LEFT JOIN branches b ON b.id=s.branch_id WHERE s.cafe_id=? ORDER BY s.created_at",
    )
    .bind(session.cafe_id)
    .all();
  return reply({
    staff: (result.results || []).map((row) => ({
      ...staffPublic(row),
      roleLabel: roleLabel(row.role),
      branchName: row.branch_name || "همه شعب",
    })),
  });
}
export async function saveStaff(db, session, body, id = null) {
  if (session.role !== "owner")
    return reply(
      { error: "forbidden", message: "فقط مالک کافه می‌تواند دسترسی پرسنل را تغییر دهد." },
      403,
    );
  const mobile = normalizeMobile(body.mobile),
    name = String(body.name || "")
      .trim()
      .slice(0, 70),
    allowed = ["owner", "branch_manager", "reception", "barista"],
    role = allowed.includes(body.role) ? body.role : "reception",
    branchId = role === "owner" ? null : String(body.branchId || "") || null,
    active = body.active !== false,
    now = new Date().toISOString();
  if (!mobile || name.length < 2 || (!branchId && role !== "owner"))
    return reply({ error: "invalid_staff", message: "اطلاعات پرسنل کامل نیست." }, 400);
  if (id === session.id && (!active || role !== "owner"))
    return reply(
      { error: "self_lockout", message: "نمی‌توانید نقش یا دسترسی حساب خودتان را حذف کنید." },
      409,
    );
  if (branchId) {
    const branch = await db
      .prepare("SELECT id FROM branches WHERE id=? AND cafe_id=? LIMIT 1")
      .bind(branchId, session.cafe_id)
      .first();
    if (!branch)
      return reply({ error: "invalid_branch", message: "شعبه انتخاب‌شده معتبر نیست." }, 400);
  }
  try {
    if (id) {
      const result = await db
        .prepare(
          "UPDATE staff_members SET mobile=?,name=?,role=?,branch_id=?,active=?,updated_at=? WHERE id=? AND cafe_id=?",
        )
        .bind(mobile, name, role, branchId, active ? 1 : 0, now, id, session.cafe_id)
        .run();
      if (!result.meta?.changes) return reply({ error: "staff_not_found" }, 404);
    } else
      await db
        .prepare(
          "INSERT INTO staff_members (id,cafe_id,branch_id,mobile,name,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)",
        )
        .bind(randomId("staff"), session.cafe_id, branchId, mobile, name, role, now, now)
        .run();
  } catch (error) {
    console.error("staff_save_failed", error);
    return reply(
      { error: "duplicate_mobile", message: "این شماره قبلاً برای یکی از پرسنل ثبت شده است." },
      409,
    );
  }
  return listStaff(db, session);
}
