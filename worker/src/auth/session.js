import { cookieValue, replyWithHeaders } from "../http.js";
import { sha256 } from "../util/ids.js";
export async function sessionStaff(db, request) {
  const token = cookieValue(request, "mizo_session");
  if (!token) return null;
  const tokenHash = await sha256(token),
    now = Date.now();
  return db
    .prepare(
      "SELECT s.id,s.cafe_id,s.branch_id,s.mobile,s.name,s.role,s.active,c.slug AS cafe_slug,ss.id AS session_id FROM staff_sessions ss JOIN staff_members s ON s.id=ss.staff_id JOIN cafes c ON c.id=s.cafe_id WHERE ss.token_hash=? AND ss.expires_at>? AND s.active=1 LIMIT 1",
    )
    .bind(tokenHash, now)
    .first();
}
export function staffPublic(row) {
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile,
    role: row.role,
    active: Boolean(row.active),
    branchId: row.branch_id || null,
  };
}
export function roleLabel(role) {
  return (
    { owner: "مالک کافه", branch_manager: "مدیر شعبه", reception: "پذیرش", barista: "باریستا" }[
      role
    ] || role
  );
}
export const rolePermissions = {
  owner: [
    "dashboard.view",
    "reservations.read",
    "reservations.write",
    "waitlist.read",
    "waitlist.write",
    "tables.write",
    "settings.write",
    "map.write",
    "schedule.write",
    "messages.read",
    "messages.write",
    "reports.read",
    "loyalty.read",
    "loyalty.write",
    "payments.read",
    "payments.write",
    "staff.manage",
    "branches.manage",
    "cafe.manage",
  ],
  branch_manager: [
    "dashboard.view",
    "reservations.read",
    "reservations.write",
    "waitlist.read",
    "waitlist.write",
    "tables.write",
    "settings.write",
    "map.write",
    "schedule.write",
    "messages.read",
    "messages.write",
    "reports.read",
    "loyalty.read",
    "loyalty.write",
    "payments.read",
    "payments.write",
  ],
  reception: [
    "dashboard.view",
    "reservations.read",
    "reservations.write",
    "waitlist.read",
    "waitlist.write",
    "messages.read",
    "loyalty.read",
    "payments.read",
  ],
  barista: ["dashboard.view", "tables.write"],
};
export function permissionsFor(role) {
  return rolePermissions[role] || [];
}
export function hasPermission(staff, permission) {
  return Boolean(staff && permissionsFor(staff.role).includes(permission));
}
export function staffSessionPublic(row) {
  return {
    ...staffPublic(row),
    cafeId: row.cafe_id,
    cafeSlug: row.cafe_slug,
    roleLabel: roleLabel(row.role),
    permissions: permissionsFor(row.role),
  };
}
export function canUseBranch(staff, branch) {
  return Boolean(
    staff &&
    branch &&
    staff.cafe_id === branch.cafe_id &&
    (staff.role === "owner" || staff.branch_id === branch.id),
  );
}
export async function logout(env, request) {
  const session = await sessionStaff(env.DB, request);
  if (session)
    await env.DB.prepare("DELETE FROM staff_sessions WHERE id=?").bind(session.session_id).run();
  return replyWithHeaders({ authenticated: false }, 200, {
    "set-cookie": "mizo_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
  });
}
