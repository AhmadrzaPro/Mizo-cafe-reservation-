import { settingsUrl } from "./api.js";
import { fetchAvailability, money } from "./booking.js";
import { adminDialog, paymentsCard, paymentsDialog } from "./dialogs.js";
import { byId } from "./dom.js";
import { switchBranch } from "./editor-nav.js";
import { faDigits, formatPersianDate } from "./format.js";
import { escapeHtml } from "./operations.js";
import { activeBranchProfile } from "./profile.js";
import { store } from "./state.js";

export function fillPaymentSettings() {
  byId("depositEnabled").checked = Boolean(store.cafeSettings.depositEnabled);
  byId("depositMode").value = store.cafeSettings.depositMode || "fixed";
  byId("depositAmount").value = String(
    Math.round(Number(store.cafeSettings.depositAmountRials || 0) / 10),
  );
  byId("depositPeakOnly").checked = Boolean(store.cafeSettings.depositPeakOnly);
  byId("depositPeakStart").value = store.cafeSettings.depositPeakStart || "18:00";
  byId("depositPeakEnd").value = store.cafeSettings.depositPeakEnd || "22:00";
  byId("paymentDeadline").value = String(store.cafeSettings.paymentDeadlineMinutes || 15);
  byId("refundPolicy").value = store.cafeSettings.refundPolicy || "";
}
const paymentModes = {
  zarinpal: [
    "درگاه زرین‌پال",
    "بیعانه آنلاین از درگاه زرین‌پال دریافت می‌شود. بازپرداخت را از پنل زرین‌پال انجام دهید و این‌جا ثبت کنید.",
  ],
  demo: ["درگاه آزمایشی", "جریان کامل پرداخت شبیه‌سازی می‌شود و پول واقعی جابه‌جا نمی‌شود."],
  none: [
    "درگاه پرداخت تنظیم نشده",
    "تا اتصال درگاه، رزرو آنلاین شعبه‌هایی که بیعانه دارند ممکن نیست.",
  ],
};
function showPaymentMode(mode) {
  const [title, text] = paymentModes[mode] || paymentModes.none,
    box = byId("paymentMode");
  box.querySelector("b").textContent = title;
  box.querySelector("small").textContent = text;
  box.dataset.mode = mode;
}
export async function fetchPayments() {
  const error = byId("paymentsError");
  error.textContent = "";
  try {
    const branch = activeBranchProfile(),
      params =
        store.managerSession?.role === "owner" ? `?branch=${encodeURIComponent(branch.id)}` : "",
      response = await fetch(`/api/payments${params}`),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "دریافت تراکنش‌ها انجام نشد.");
    showPaymentMode(data.mode);
    byId("paymentsPaid").textContent = money(data.summary.paid);
    byId("paymentsPending").textContent =
      `${money(data.summary.pending)} · ${faDigits(data.summary.pendingCount)} رزرو`;
    byId("paymentsRefunded").textContent = money(data.summary.refunded);
    const list = byId("paymentsList");
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
        if (
          !confirm(
            data.mode === "demo"
              ? "بیعانه بازپرداخت و رزرو لغو شود؟"
              : "ابتدا مبلغ را از پنل درگاه پرداخت به مشتری برگردانید. بازپرداخت این‌جا ثبت و رزرو لغو شود؟",
          )
        )
          return;
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
  byId("paymentsBranch").value = store.currentBranch;
  fillPaymentSettings();
  paymentsDialog.showModal();
  await fetchPayments();
}

export function wirePayments() {
  paymentsCard.onclick = openPayments;
  byId("refreshPayments").onclick = fetchPayments;
  byId("paymentsBranch").onchange = async (event) => {
    await switchBranch(byId("paymentsBranch").value);
    fillPaymentSettings();
    await fetchPayments();
  };
  byId("savePaymentSettings").onclick = async () => {
    const button = byId("savePaymentSettings"),
      error = byId("paymentsError"),
      branch = activeBranchProfile(),
      payload = {
        ...store.cafeSettings,
        cafeName: store.cafeProfile.cafe.name,
        branchName: branch.name,
        city: branch.city,
        address: branch.address,
        depositEnabled: byId("depositEnabled").checked,
        depositMode: byId("depositMode").value,
        depositAmountRials: Number(byId("depositAmount").value) * 10,
        depositPeakOnly: byId("depositPeakOnly").checked,
        depositPeakStart: byId("depositPeakStart").value,
        paymentDeadlineMinutes: Number(byId("paymentDeadline").value),
        depositPeakEnd: byId("depositPeakEnd").value,
        refundPolicy: byId("refundPolicy").value,
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
