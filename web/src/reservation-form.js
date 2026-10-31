import { reservationsUrl } from "./api.js";
import { customerDialog, fetchAvailability, showDepositPayment, successDialog } from "./booking.js";
import { byId, html, setHtml, required } from "./dom.js";
import { faDigits, latinDigits } from "./format.js";
import { followGatewayRedirect, payingLabel } from "./payment-flow.js";
import { state, store } from "./state.js";

export function wireReservationForm() {
  byId("reservationForm").onsubmit = async (e) => {
    e.preventDefault();
    const button = byId("submitReservation"),
      error = byId("reservationError"),
      mobile = latinDigits(byId("customerMobile").value);
    button.disabled = true;
    button.textContent = "در حال ثبت رزرو…";
    error.hidden = true;
    try {
      const response = await fetch(reservationsUrl(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customerName: byId("customerName").value,
            mobile,
            notes: byId("customerNotes").value,
            date: state.date,
            time: state.time,
            partySize: state.guests,
            tableIds: [state.tableId],
          }),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ثبت رزرو انجام نشد.");
      customerDialog.close();
      required(".success-dialog h2").textContent = data.payment?.required
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
      byId("successText").textContent = data.payment?.required
        ? `${state.table} تا پایان مهلت پرداخت برایت نگه داشته شده است.`
        : `${state.table} برای ${faDigits(state.guests)} نفر در ساعت ${faDigits(state.time)} ${data.status === "confirmed" ? "تأیید شد." : "در انتظار تأیید کافه است."}${smsNote}`;
      byId("successCode").textContent = data.trackingCode;
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
  byId("depositPayment").onclick = async (event) => {
    if (
      !(/** @type {HTMLElement} */ (event.target).closest("#payDeposit")) ||
      !store.pendingPayment
    )
      return;
    const button = byId("payDeposit");
    button.disabled = true;
    button.textContent = payingLabel();
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
      if (followGatewayRedirect(data)) return;
      setHtml(
        byId("depositPayment"),
        html`<b class="payment-success"
            >${data.status === "confirmed" ? "پرداخت موفق · رزرو تأیید شد" : "پرداخت موفق · در انتظار تأیید کافه"}</b
          ><small>شماره پیگیری: ${data.reference || "آزمایشی"}</small>`,
      );
      required(".success-dialog h2").textContent =
        data.status === "confirmed" ? "میزت رزرو شد!" : "پرداخت ثبت شد؛ منتظر تأیید کافه";
      byId("successText").textContent =
        `${state.table} برای ${faDigits(state.guests)} نفر در ساعت ${faDigits(state.time)} ${data.status === "confirmed" ? "تأیید شد." : "در انتظار تأیید کافه است."}`;
      store.pendingPayment = null;
    } catch (error) {
      button.disabled = false;
      button.textContent = error.message;
    }
  };
  byId("doneBtn").onclick = () => {
    successDialog.close();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}
