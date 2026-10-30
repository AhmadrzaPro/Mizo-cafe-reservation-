// @ts-check
// Deposit payment in the customer flow: button labels for the active payment mode, sending the
// customer to the gateway, and the message shown when the gateway sends them back.
import { pageParams, store } from "./state.js";

/** True when deposits go through a real gateway rather than the demo simulation. */
export const usesGateway = () =>
  !["demo", "none", undefined].includes(store.cafeSettings?.paymentMode);
/** True when the deposit can be paid online (a gateway, or the demo simulation). */
export const onlinePayment = () => (store.cafeSettings?.paymentMode || "none") !== "none";

export const payButtonLabel = (confirming = false) =>
  usesGateway()
    ? "پرداخت آنلاین بیعانه"
    : confirming
      ? "پرداخت آزمایشی و تأیید رزرو"
      : "پرداخت آزمایشی";

export const payingLabel = () =>
  usesGateway() ? "در حال انتقال به درگاه پرداخت…" : "در حال پرداخت آزمایشی…";

/**
 * Sends the customer to the gateway when the pay response asks for it.
 * @param {{ redirectUrl?: string }} data
 * @returns {boolean} whether the page is leaving for the gateway
 */
export function followGatewayRedirect(data) {
  if (!data.redirectUrl) return false;
  globalThis.location.assign(data.redirectUrl);
  return true;
}

const returnMessages = {
  success: [
    "success",
    "پرداخت با موفقیت انجام شد. برای دیدن وضعیت رزرو، شماره موبایل را وارد کنید.",
  ],
  late: [
    "warning",
    "پرداخت انجام شد اما مهلت نگه‌داشتن میز تمام شده بود. کافه مبلغ را به شما بازمی‌گرداند.",
  ],
  pending: [
    "warning",
    "نتیجه پرداخت هنوز مشخص نیست. چند دقیقه بعد وضعیت رزرو را دوباره بررسی کنید.",
  ],
  failed: ["error", "پرداخت انجام نشد. اگر مبلغی از حساب شما کم شده باشد، طی ۷۲ ساعت بازمی‌گردد."],
};

/** Opens the tracking dialog with the gateway's result when the page was opened from a callback. */
export function showPaymentReturn() {
  const result = pageParams.get("payment");
  if (!result) return;
  const [tone, text] = returnMessages[result] || returnMessages.failed,
    code = pageParams.get("code") || "",
    message = /** @type {HTMLElement} */ (document.querySelector("#paymentReturn")),
    dialog = /** @type {HTMLDialogElement} */ (document.querySelector("#trackingDialog"));
  /** @type {HTMLInputElement} */ (document.querySelector("#trackingCode")).value = code;
  message.textContent = text;
  message.dataset.tone = tone;
  message.hidden = false;
  /** @type {HTMLElement} */ (document.querySelector("#trackingResult")).hidden = true;
  /** @type {HTMLElement} */ (document.querySelector("#trackingError")).hidden = true;
  dialog.showModal();
  // Drop the result from the address so a reload does not show it again.
  const url = new URL(globalThis.location.href);
  url.searchParams.delete("payment");
  url.searchParams.delete("code");
  history.replaceState(null, "", url);
}
