export function normalizeDigits(value) {
  return String(value || "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
export function normalizeMobile(value) {
  let mobile = normalizeDigits(value).replace(/[^0-9+]/g, "");
  if (mobile.startsWith("+98")) mobile = "0" + mobile.slice(3);
  if (mobile.startsWith("98")) mobile = "0" + mobile.slice(2);
  return /^09\d{9}$/.test(mobile) ? mobile : null;
}
export function maskMobile(mobile) {
  return mobile ? `${mobile.slice(0, 4)}***${mobile.slice(-4)}` : "—";
}
