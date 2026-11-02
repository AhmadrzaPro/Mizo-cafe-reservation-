import { normalizeDigits } from "./mobile.js";
// A 16-digit Iranian bank card number that passes the Luhn check, or "".
export function validCardNumber(value) {
  const digits = normalizeDigits(value).replace(/[\s-]/g, "");
  if (!/^\d{16}$/.test(digits)) return "";
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let digit = Number(digits[15 - i]);
    if (i % 2) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0 ? digits : "";
}
