import { settingsUrl } from "./api.js";
import { fetchAvailability, money } from "./booking.js";
import { adminDialog, paymentsDialog } from "./dialogs.js";
import { switchBranch } from "./editor-nav.js";
import { faDigits, formatPersianDate } from "./format.js";
import { escapeHtml } from "./operations.js";
import { activeBranchProfile } from "./profile.js";
import { store } from "./state.js";

export function fillPaymentSettings() {
  document.querySelector("#depositEnabled").checked = Boolean(store.cafeSettings.depositEnabled);
  document.querySelector("#depositMode").value = store.cafeSettings.depositMode || "fixed";
  document.querySelector("#depositAmount").value = Math.round(
    Number(store.cafeSettings.depositAmountRials || 0) / 10,
  );
  document.querySelector("#depositPeakOnly").checked = Boolean(store.cafeSettings.depositPeakOnly);
  document.querySelector("#depositPeakStart").value =
    store.cafeSettings.depositPeakStart || "18:00";
  document.querySelector("#depositPeakEnd").value = store.cafeSettings.depositPeakEnd || "22:00";
  document.querySelector("#paymentDeadline").value = String(
    store.cafeSettings.paymentDeadlineMinutes || 15,
  );
  document.querySelector("#refundPolicy").value = store.cafeSettings.refundPolicy || "";
}
export async function fetchPayments() {
  const error = document.querySelector("#paymentsError");
  error.textContent = "";
  try {
    const branch = activeBranchProfile(),
      params =
        store.managerSession?.role === "owner" ? `?branch=${encodeURIComponent(branch.id)}` : "",
      response = await fetch(`/api/payments${params}`),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "دریافت تراکنش‌ها انجام نشد.");
    document.querySelector("#paymentsPaid").textContent = money(data.summary.paid);
    document.querySelector("#paymentsPending").textContent =
      `${money(data.summary.pending)} · ${faDigits(data.summary.pendingCount)} رزرو`;
    document.querySelector("#paymentsRefunded").textContent = money(data.summary.refunded);
    const list = document.querySelector("#paymentsList");
    if (!data.transactions.length) {
      list.innerHTML = '<div class="insight-empty">هنوز تراکنشی برای این شعبه ثبت نشده است.</div>';
      return;
    }
    list.innerHTML = "";
    data.transactions.forEach((item) => {
      const row = document.createElement("article"),
        isRefund = item.type === "refund";
      row.innerHTML = `<span class="transaction-icon ${isRefund ? "refund" : "paid"}">${isRefund ? "↩" : "✓"}</span><div><b>${escapeHtml(item.customerName)}</b><small>${escapeHtml(item.trackingCode)} · ${escapeHtml(item.branchName)} · ${formatPersianDate(item.createdAt)}</small></div><strong>${isRefund ? "−" : "+"}${money(item.amountRials)}</strong>${!isRefund && data.canWrite ? '<button type="button">بازپرداخت</button>' : ""}`;
      row.querySelector("button")?.addEventListener("click", async () => {
        if (!confirm("بیعانه بازپرداخت و رزرو لغو شود؟")) return;
        const refund = await fetch(`/api/payments/${encodeURIComponent(item.id)}/refund`, {
            method: "POST",
          }),
          result = await refund.json();
        if (!refund.ok) {
          error.textContent = result.message || "بازپرداخت انجام نشد";
          return;
        }
        await Promise.all([fetchPayments(), fetchAvailability()]);
      });
      list.appendChild(row);
    });
  } catch (err) {
    error.textContent = err.message;
  }
}
export async function openPayments() {
  adminDialog.close();
  document.querySelector("#paymentsBranch").value = store.currentBranch;
  fillPaymentSettings();
  paymentsDialog.showModal();
  await fetchPayments();
}

export function wirePayments() {
  document.querySelector("#openPayments").onclick = openPayments;
  document.querySelector("#refreshPayments").onclick = fetchPayments;
  document.querySelector("#paymentsBranch").onchange = async (event) => {
    await switchBranch(event.target.value);
    fillPaymentSettings();
    await fetchPayments();
  };
  document.querySelector("#savePaymentSettings").onclick = async () => {
    const button = document.querySelector("#savePaymentSettings"),
      error = document.querySelector("#paymentsError"),
      branch = activeBranchProfile(),
      payload = {
        ...store.cafeSettings,
        cafeName: store.cafeProfile.cafe.name,
        branchName: branch.name,
        city: branch.city,
        address: branch.address,
        depositEnabled: document.querySelector("#depositEnabled").checked,
        depositMode: document.querySelector("#depositMode").value,
        depositAmountRials: Number(document.querySelector("#depositAmount").value) * 10,
        depositPeakOnly: document.querySelector("#depositPeakOnly").checked,
        depositPeakStart: document.querySelector("#depositPeakStart").value,
        paymentDeadlineMinutes: Number(document.querySelector("#paymentDeadline").value),
        depositPeakEnd: document.querySelector("#depositPeakEnd").value,
        refundPolicy: document.querySelector("#refundPolicy").value,
      };
    button.disabled = true;
    error.textContent = "";
    try {
      const response = await fetch(settingsUrl(), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ذخیره تنظیمات انجام نشد.");
      store.cafeSettings = data;
      fillPaymentSettings();
      button.textContent = "ذخیره شد ✓";
      setTimeout(() => (button.textContent = "ذخیره قوانین بیعانه"), 1400);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
