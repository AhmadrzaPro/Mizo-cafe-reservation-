/** "۱۲۳" → "123" */
export const faDigitsToLatin = (value) =>
  String(value).replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
