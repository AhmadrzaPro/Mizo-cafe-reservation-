import { reservationsUrl } from "./api.js";
import { customerDialog, fetchAvailability, showDepositPayment, successDialog } from "./booking.js";
import { faDigits, latinDigits } from "./format.js";
import { escapeHtml } from "./operations.js";
import { state, store } from "./state.js";

export function wireReservationForm() {
  document.querySelector("#reservationForm").onsubmit = async (e) => {
    e.preventDefault();
    const button = document.querySelector("#submitReservation"),
      error = document.querySelector("#reservationError"),
      mobile = latinDigits(document.querySelector("#customerMobile").value);
    button.disabled = true;
    button.textContent = "در حال ثبت رزرو…";
    error.hidden = true;
    try {
      const response = await fetch(reservationsUrl(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customerName: document.querySelector("#customerName").value,
            mobile,
            notes: document.querySelector("#customerNotes").value,
            date: state.date,
            time: state.time,
            partySize: state.guests,
            tableIds: [state.tableId],
          }),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ثبت رزرو انجام نشد.");
      customerDialog.close();
      document.querySelector(".success-dialog h2").textContent = data.payment?.required
        ? "رزرو در انتظار پرداخت است"
        : data.status === "confirmed"
          ? "میزت رزرو شد!"
          : "درخواستت ثبت شد";
      const smsNote =
        data.notifications?.confirmation === "demo_sent"
          ? " نمونه پیامک تأیید نیز در حالت آزمایشی ثبت شد."
          : data.notifications?.confirmation === "sent"
            ? " پیامک تأیید برایت ارسال شد."
            : "";
      document.querySelector("#successText").textContent = data.payment?.required
        ? `${state.table} تا پایان مهلت پرداخت برایت نگه داشته شده است.`
        : `${state.table} برای ${faDigits(state.guests)} نفر در ساعت ${faDigits(state.time)} ${data.status === "confirmed" ? "تأیید شد." : "در انتظار تأیید کافه است."}${smsNote}`;
      document.querySelector("#successCode").textContent = data.trackingCode;
      showDepositPayment(data.payment, data.trackingCode, mobile);
      successDialog.showModal();
      await fetchAvailability();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = "ثبت نهایی رزرو";
    }
  };
  document.querySelector("#depositPayment").onclick = async (event) => {
    if (!event.target.closest("#payDeposit") || !store.pendingPayment) return;
    const button = document.querySelector("#payDeposit");
    button.disabled = true;
    button.textContent = "در حال پرداخت آزمایشی…";
    try {
      const response = await fetch(
          `/api/reservations/${encodeURIComponent(store.pendingPayment.trackingCode)}/pay`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mobile: store.pendingPayment.mobile }),
          },
        ),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "پرداخت انجام نشد.");
      document.querySelector("#depositPayment").innerHTML =
        `<b class="payment-success">${data.status === "confirmed" ? "پرداخت موفق · رزرو تأیید شد" : "پرداخت موفق · در انتظار تأیید کافه"}</b><small>شماره پیگیری: ${escapeHtml(data.reference || "آزمایشی")}</small>`;
      document.querySelector(".success-dialog h2").textContent =
        data.status === "confirmed" ? "میزت رزرو شد!" : "پرداخت ثبت شد؛ منتظر تأیید کافه";
      document.querySelector("#successText").textContent =
        `${state.table} برای ${faDigits(state.guests)} نفر در ساعت ${faDigits(state.time)} ${data.status === "confirmed" ? "تأیید شد." : "در انتظار تأیید کافه است."}`;
      store.pendingPayment = null;
    } catch (error) {
      button.disabled = false;
      button.textContent = error.message;
    }
  };
  document.querySelector("#doneBtn").onclick = () => {
    successDialog.close();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}
