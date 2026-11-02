export const pad = (n) => String(n).padStart(2, "0");
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || "")) return false;
  const [h, m] = value.split(":").map(Number);
  return h < 24 && m < 60;
}
export function minutes(value) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function timeAt(date, total) {
  const dayOffset = Math.floor(total / 1440),
    left = ((total % 1440) + 1440) % 1440,
    d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return `${d.toISOString().slice(0, 10)}T${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
}
/*
 * Two kinds of time are stored, and only two:
 * - an instant (created_at, expires_at, sent_at, scheduled_at…) is ISO-8601 UTC text with
 *   milliseconds, exactly as Date.prototype.toISOString() writes it, e.g. 2026-10-31T20:15:00.000Z.
 *   Equal-length UTC strings sort and compare correctly as text.
 * - a café's wall-clock schedule (reserved_at, closure dates, opening hours) is Tehran local
 *   time without a zone: YYYY-MM-DDTHH:MM, YYYY-MM-DD or HH:MM.
 */
/** The instant as stored. @param {number | Date} [at] */
export const isoInstant = (at = Date.now()) => new Date(at).toISOString();
// Iran has had no daylight saving time since 2022, so Tehran is always UTC+03:30.
const TEHRAN_OFFSET_MS = 210 * 60000;
/** The instant at which Tehran's clock shows this local time, less some minutes. */
export function tehranInstant(local, minutesBefore = 0) {
  return isoInstant(Date.parse(`${local}:00Z`) - TEHRAN_OFFSET_MS - minutesBefore * 60000);
}
export function tehranNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    key: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
  };
}
