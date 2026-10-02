import { fetchAvailability, money, trackingDialog } from "./booking.js";
import { faDigits, formatPersianDate, latinDigits } from "./format.js";
import { escapeHtml } from "./operations.js";

export function wireTracking() {
  document.querySelector("#openTracking").onclick = () => {
    document.querySelector("#trackingResult").hidden = true;
    document.querySelector("#trackingError").hidden = true;
    trackingDialog.showModal();
  };
  document.querySelector("#trackingForm").onsubmit = async (e) => {
    e.preventDefault();
    const code = latinDigits(document.querySelector("#trackingCode").value).toUpperCase().trim(),
      mobile = latinDigits(document.querySelector("#trackingMobile").value),
      error = document.querySelector("#trackingError"),
      result = document.querySelector("#trackingResult");
    error.hidden = true;
    try {
      const response = await fetch(
          `/api/reservations/${encodeURIComponent(code)}?mobile=${encodeURIComponent(mobile)}`,
        ),
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
            ? `<div class="tracking-payment"><b>بیعانه ${money(data.payment.amountRials)}</b><button type="button" id="trackingPay" class="primary-btn">پرداخت آزمایشی</button></div>`
            : data.payment?.status === "paid"
              ? '<p class="paid-label">بیعانه پرداخت شده</p>'
              : "";
      result.innerHTML = `<b>${escapeHtml(labels[data.status] || data.status)}</b><p>${escapeHtml(data.tables.join("، "))} · ${faDigits(data.partySize)} نفر</p><p>${formatPersianDate(data.date)} ساعت ${faDigits(data.time)}</p>${payment}${["pending", "confirmed"].includes(data.status) ? '<button type="button" id="cancelReservation" class="danger-action">لغو رزرو</button>' : ""}`;
      result.hidden = false;
      document.querySelector("#trackingPay")?.addEventListener("click", async (event) => {
        event.target.disabled = true;
        const payResponse = await fetch(`/api/reservations/${encodeURIComponent(code)}/pay`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mobile }),
          }),
          paid = await payResponse.json();
        if (!payResponse.ok) {
          error.textContent = paid.message || "پرداخت انجام نشد";
          error.hidden = false;
          event.target.disabled = false;
          return;
        }
        result.querySelector(".tracking-payment").innerHTML =
          `<b class="payment-success">${paid.status === "confirmed" ? "پرداخت موفق · رزرو تأیید شد" : "پرداخت موفق · در انتظار تأیید کافه"}</b>`;
      });
      document.querySelector("#cancelReservation")?.addEventListener("click", async () => {
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
