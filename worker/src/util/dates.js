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
export function subtractLocalMinutes(value, amount) {
  const date = new Date(`${value}:00Z`);
  date.setUTCMinutes(date.getUTCMinutes() - amount);
  return date.toISOString().slice(0, 16);
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
