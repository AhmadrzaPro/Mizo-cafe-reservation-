import { fetchAvailability, money, trackingDialog } from "./booking.js";
import { byId } from "./dom.js";
import { faDigits, formatPersianDate, latinDigits } from "./format.js";
import { escapeHtml } from "./operations.js";
import { followGatewayRedirect, payButtonLabel, payingLabel } from "./payment-flow.js";

export function wireTracking() {
  byId("openTracking").onclick = () => {
    byId("trackingResult").hidden = true;
    byId("trackingError").hidden = true;
    byId("paymentReturn").hidden = true;
    trackingDialog.showModal();
  };
  byId("trackingForm").onsubmit = async (e) => {
    e.preventDefault();
    const code = latinDigits(byId("trackingCode").value).toUpperCase().trim(),
      mobile = latinDigits(byId("trackingMobile").value),
      error = byId("trackingError"),
      result = byId("trackingResult");
    error.hidden = true;
    try {
      const response = await fetch(`/api/reservations/${encodeURIComponent(code)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mobile }),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "رزرو پیدا نشد.");
      const labels = {
          pending: "در انتظار تأیید",
          confirmed: "تأیید شده",
          arrived: "مشتری رسیده",
          completed: "انجام شده",
          cancelled: "لغو شده",
          no_show: "عدم مراجعه",
        },
        payment =
          data.payment?.status === "pending" && ["pending", "confirmed"].includes(data.status)
            ? `<div class="tracking-payment"><b>بیعانه ${money(data.payment.amountRials)}</b><button type="button" id="trackingPay" class="primary-btn">${payButtonLabel()}</button></div>`
            : data.payment?.status === "paid"
              ? '<p class="paid-label">بیعانه پرداخت شده</p>'
              : "";
      result.innerHTML = `<b>${escapeHtml(labels[data.status] || data.status)}</b><p>${escapeHtml(data.tables.join("، "))} · ${faDigits(data.partySize)} نفر</p><p>${formatPersianDate(data.date)} ساعت ${faDigits(data.time)}</p>${payment}${["pending", "confirmed"].includes(data.status) ? '<button type="button" id="cancelReservation" class="danger-action">لغو رزرو</button>' : ""}`;
      result.hidden = false;
      /** @type {HTMLButtonElement | null} */ (
        document.querySelector("#trackingPay")
      )?.addEventListener("click", async (event) => {
        const payButton = /** @type {HTMLButtonElement} */ (event.currentTarget);
        payButton.disabled = true;
        payButton.textContent = payingLabel();
        const payResponse = await fetch(`/api/reservations/${encodeURIComponent(code)}/pay`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mobile }),
          }),
          paid = await payResponse.json();
        if (!payResponse.ok) {
          error.textContent = paid.message || "پرداخت انجام نشد";
          error.hidden = false;
          payButton.disabled = false;
          payButton.textContent = payButtonLabel();
          return;
        }
        if (followGatewayRedirect(paid)) return;
        result.querySelector(".tracking-payment").innerHTML =
          `<b class="payment-success">${paid.status === "confirmed" ? "پرداخت موفق · رزرو تأیید شد" : "پرداخت موفق · در انتظار تأیید کافه"}</b>`;
      });
      /** @type {HTMLButtonElement | null} */ (
        document.querySelector("#cancelReservation")
      )?.addEventListener("click", async () => {
        if (!confirm("این رزرو لغو شود؟")) return;
        const cancelResponse = await fetch(`/api/reservations/${encodeURIComponent(code)}/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mobile }),
        });
        if (!cancelResponse.ok) {
          const failure = await cancelResponse.json();
          error.textContent = failure.message || "لغو رزرو انجام نشد";
          error.hidden = false;
          return;
        }
        if (cancelResponse.ok) {
          result.innerHTML = "<b>رزرو با موفقیت لغو شد</b><p>ظرفیت میز دوباره آزاد شد.</p>";
          await fetchAvailability();
        }
      });
    } catch (err) {
      result.hidden = true;
      error.textContent = err.message;
      error.hidden = false;
    }
  };
}
