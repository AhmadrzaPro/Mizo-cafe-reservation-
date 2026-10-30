// @ts-check
// Card-to-card deposits for customers: the café's card, and the form that submits the transfer's
// bank reference. Used in the booking success dialog and in reservation tracking.
import { faDigits, latinDigits } from "./format.js";
import { escapeHtml } from "./operations.js";

/** "6219861930664833" → "6219 8619 3066 4833" */
export const groupCard = (number) => String(number).replace(/(\d{4})(?=\d)/g, "$1 ");

/**
 * @param {{ cardNumber: string, cardHolder: string }} card
 * @param {number} amountRials
 */
export function cardTransferMarkup(card, amountRials) {
  return `<div class="card-transfer"><b>پرداخت کارت به کارت</b><p>مبلغ ${faDigits(Math.round(amountRials / 10).toLocaleString("en-US"))} تومان را به این کارت واریز کنید و شماره پیگیری را وارد کنید. رزرو پس از بررسی کافه تأیید می‌شود.</p><div class="card-number"><strong dir="ltr">${escapeHtml(groupCard(card.cardNumber))}</strong><button type="button" data-copy-card>کپی</button></div>${card.cardHolder ? `<small>به نام ${escapeHtml(card.cardHolder)}</small>` : ""}<form class="card-transfer-form"><label>شماره پیگیری انتقال<input name="reference" inputmode="numeric" maxlength="40" required dir="ltr"></label><label>۴ رقم آخر کارت شما<input name="cardLast4" inputmode="numeric" maxlength="4" dir="ltr"></label><p class="form-error" hidden></p><button class="primary-btn" type="submit">ثبت پرداخت کارت به کارت</button></form></div>`;
}

export const reviewMessage =
  '<b class="payment-review">پرداخت کارت به کارت ثبت شد · در انتظار بررسی کافه</b>';

/**
 * Wires the card-to-card section inside `container`.
 * @param {Element} container
 * @param {{ cardNumber: string }} card
 * @param {string} trackingCode
 * @param {string} mobile
 * @param {(data: any) => void} onSubmitted
 */
export function wireCardTransfer(container, card, trackingCode, mobile, onSubmitted) {
  const copy = /** @type {HTMLButtonElement | null} */ (
    container.querySelector("[data-copy-card]")
  );
  if (copy)
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(card.cardNumber);
        copy.textContent = "کپی شد ✓";
      } catch {
        copy.textContent = "کپی نشد";
      }
    };
  const form = /** @type {HTMLFormElement | null} */ (
    container.querySelector(".card-transfer-form")
  );
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const error = /** @type {HTMLElement} */ (form.querySelector(".form-error")),
      button = /** @type {HTMLButtonElement} */ (form.querySelector("button[type=submit]")),
      fields = new FormData(form);
    error.hidden = true;
    button.disabled = true;
    try {
      const response = await fetch(
          `/api/reservations/${encodeURIComponent(trackingCode)}/card-transfer`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mobile,
              reference: latinDigits(String(fields.get("reference") || "")),
              cardLast4: latinDigits(String(fields.get("cardLast4") || "")),
            }),
          },
        ),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ثبت پرداخت انجام نشد.");
      onSubmitted(data);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  };
}
