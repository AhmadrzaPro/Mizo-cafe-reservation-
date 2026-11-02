import { cookieValue, reply, replyWithHeaders } from "../http.js";
import { isoInstant } from "../util/dates.js";
import { sha256 } from "../util/ids.js";
// A session's last use is recorded at most this often, so ordinary requests do not each write.
const SEEN_EVERY = 5 * 60000;
export async function sessionStaff(db, request) {
  const token = cookieValue(request, "mizo_session");
  if (!token) return null;
  const tokenHash = await sha256(token),
    nowMs = Date.now(),
    now = isoInstant(nowMs);
  const staff = await db
    .prepare(
      "SELECT s.id,s.cafe_id,s.branch_id,s.mobile,s.name,s.role,s.active,c.slug AS cafe_slug,ss.id AS session_id,ss.last_seen_at FROM staff_sessions ss JOIN staff_members s ON s.id=ss.staff_id JOIN cafes c ON c.id=s.cafe_id WHERE ss.token_hash=? AND ss.expires_at>? AND s.active=1 LIMIT 1",
    )
    .bind(tokenHash, now)
    .first();
  if (staff && nowMs - Date.parse(String(staff.last_seen_at)) >= SEEN_EVERY)
    await db
      .prepare("UPDATE staff_sessions SET last_seen_at=? WHERE id=?")
      .bind(now, staff.session_id)
      .run();
  return staff;
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
const clearCookie = {
  "set-cookie": "mizo_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
};
// The signed-in staff member's sessions on every device, newest use first.
export async function listSessions(db, session) {
  const result = await db
    .prepare(
      "SELECT id,created_at,last_seen_at FROM staff_sessions WHERE staff_id=? AND expires_at>? ORDER BY last_seen_at DESC",
    )
    .bind(session.id, isoInstant())
    .all();
  return reply({
    sessions: (result.results || []).map((row) => ({
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      current: row.id === session.session_id,
    })),
  });
}
// Signs the staff member out everywhere, for a lost phone or a shared device.
export async function logoutEverywhere(db, session) {
  const result = await db
    .prepare("DELETE FROM staff_sessions WHERE staff_id=?")
    .bind(session.id)
    .run();
  return replyWithHeaders(
    { authenticated: false, endedSessions: Number(result.meta?.changes || 0) },
    200,
    clearCookie,
  );
}
// Scheduled: drops expired sessions and OTP challenges, which are never read again.
export async function cleanupAuth(db, now = Date.now()) {
  await db.batch([
    db.prepare("DELETE FROM staff_sessions WHERE expires_at<=?").bind(isoInstant(now)),
    db.prepare("DELETE FROM otp_challenges WHERE expires_at<=?").bind(isoInstant(now - 86400000)),
  ]);
}
export async function logout(env, request) {
  const session = await sessionStaff(env.DB, request);
  if (session)
    await env.DB.prepare("DELETE FROM staff_sessions WHERE id=?").bind(session.session_id).run();
  return replyWithHeaders({ authenticated: false }, 200, clearCookie);
}
