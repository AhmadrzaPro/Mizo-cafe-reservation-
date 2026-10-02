import { dayRules } from "./settings.js";
import { minutes, pad, tehranNow, timeAt, validDate, validTime } from "./util/dates.js";
// Locks retain their audit role; exact overlap is enforced by database triggers.
export function lockTimes(date, time) {
  return [`${date}T${time}`];
}
export function bookingTimeError(date, time, duration, rules, operational = false) {
  if (!validDate(date) || !validTime(time)) return "invalid_datetime";
  const now = tehranNow(),
    key = `${date}T${time}`;
  // Walk-ins may use the current minute, never an earlier minute.
  if (key < now.key || (!operational && key === now.key)) return "past_booking";
  if (
    rules.closed ||
    minutes(time) < minutes(rules.openTime) ||
    minutes(time) + duration > minutes(rules.closeTime)
  )
    return "outside_hours";
  return null;
}
export async function availableTables(db, date, time, settings, tables) {
  const start = `${date}T${time}`,
    end = timeAt(date, minutes(time) + settings.reservationDuration + settings.bufferMinutes);
  const result = await db
    .prepare(
      "SELECT DISTINCT rt.table_id FROM reservation_tables rt JOIN reservations r ON r.id=rt.reservation_id WHERE r.status NOT IN ('cancelled','completed','no_show') AND r.reserved_at<? AND datetime(r.reserved_at,'+'||(r.duration_minutes+r.buffer_minutes)||' minutes')>datetime(?)",
    )
    .bind(end, start)
    .all();
  const busy = new Set((result.results || []).map((r) => r.table_id));
  return tables.filter(
    (t) => !busy.has(t.id) && (!t.operational_status || t.operational_status === "available"),
  );
}
export async function availability(db, branch, date, partySize, settings) {
  const rules = await dayRules(db, branch, date);
  if (rules.closed) return { date, closed: true, reason: rules.reason, slots: [] };
  const mode = ["indoor", "outdoor", "both"].includes(branch.space_mode)
      ? branch.space_mode
      : "indoor",
    result = await db
      .prepare(
        "SELECT t.id,t.name,t.capacity FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=? AND t.reservable=1 AND t.operational_status='available' AND (?='both' OR a.kind=?) ORDER BY t.name",
      )
      .bind(branch.id, mode, mode)
      .all(),
    tables = result.results || [],
    start = minutes(rules.openTime),
    latest = minutes(rules.closeTime) - settings.reservationDuration,
    slots = [];
  for (let value = start; value <= latest; value += settings.slotInterval) {
    const time = `${pad(Math.floor(value / 60))}:${pad(value % 60)}`,
      free = await availableTables(db, date, time, settings, tables),
      eligible = free.filter((t) => t.capacity >= partySize);
    slots.push({
      time,
      available:
        settings.reservationsEnabled && `${date}T${time}` > tehranNow().key && eligible.length > 0,
      tableIds:
        settings.reservationsEnabled && `${date}T${time}` > tehranNow().key
          ? eligible.map((t) => t.id)
          : [],
      remaining:
        settings.reservationsEnabled && `${date}T${time}` > tehranNow().key ? eligible.length : 0,
    });
  }
  return {
    date,
    closed: false,
    reason: "",
    openTime: rules.openTime,
    closeTime: rules.closeTime,
    slots,
  };
}
