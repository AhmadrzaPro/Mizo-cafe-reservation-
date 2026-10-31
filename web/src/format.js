export const faDigits = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
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
export const formatPersianDate = (value) => {
  if (!value) return "—";
  const date = value instanceof Date ? value : dateFromIso(String(value).slice(0, 10));
  return Number.isNaN(date.getTime()) ? "—" : persianDateFormatter.format(date);
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
