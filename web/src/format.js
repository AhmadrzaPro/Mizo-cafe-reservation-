export const faDigits = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
/** Rials as Persian toman, e.g. 4900000 → "۴۹۰٬۰۰۰ تومان". */
export const formatToman = (rials) =>
  `${new Intl.NumberFormat("fa-IR").format(Math.round(Number(rials || 0) / 10))} تومان`;
export const latinDigits = (n) =>
  String(n)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const persianDateFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
export const persianMonthFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "long",
});
export const persianPartsFormatter = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
export const dateFromIso = (value) => new Date(`${value}T12:00:00`);
// The server sends two kinds of time (see worker/src/util/dates.js): instants as ISO UTC ending
// in Z, shown on Tehran's clock whatever the device's zone, and café calendar dates or
// wall-clock times, which are already Tehran's and are shown as they are.
const isInstant = (value) => typeof value === "string" && value.endsWith("Z");
const tehranDateFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const tehranTimeFormatter = new Intl.DateTimeFormat("fa-IR", {
  timeZone: "Asia/Tehran",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export const formatPersianDate = (value) => {
  if (!value) return "—";
  if (isInstant(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? "—" : tehranDateFormatter.format(instant);
  }
  const date = value instanceof Date ? value : dateFromIso(String(value).slice(0, 10));
  return Number.isNaN(date.getTime()) ? "—" : persianDateFormatter.format(date);
};
/** The time of an instant on Tehran's clock, in Persian digits. @param {string} value */
export const formatTehranTime = (value) => {
  const instant = new Date(value);
  return value && !Number.isNaN(instant.getTime()) ? tehranTimeFormatter.format(instant) : "—";
};
export const persianParts = (date) =>
  Object.fromEntries(
    persianPartsFormatter
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  );
export const isoValue = (input) => input?.dataset.iso || "";
export function setJalaliInput(input, value) {
  if (!input) return;
  input.dataset.iso = value || "";
  input.value = value ? formatPersianDate(value) : "";
}
