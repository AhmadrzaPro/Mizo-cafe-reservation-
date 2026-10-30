import { settingsUrl } from "./api.js";
import { fetchAvailability, money } from "./booking.js";
import { adminDialog, paymentsDialog } from "./dialogs.js";
import { switchBranch } from "./editor-nav.js";
import { groupCard } from "./card-transfer.js";
import { faDigits, formatPersianDate, latinDigits } from "./format.js";
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
  document.querySelector("#cardTransferEnabled").checked = Boolean(
    store.cafeSettings.cardTransferEnabled,
  );
  document.querySelector("#cardNumber").value = groupCard(store.cafeSettings.cardNumber || "");
  document.querySelector("#cardHolder").value = store.cafeSettings.cardHolder || "";
}
function renderTransfers(data) {
  const section = document.querySelector("#cardTransfers"),
    list = document.querySelector("#transfersList"),
    error = document.querySelector("#paymentsError");
  section.hidden = !data.transfers?.length;
  list.innerHTML = "";
  for (const item of data.transfers || []) {
    const row = document.createElement("article");
    row.className = "transfer-row";
    row.innerHTML = `<span class="transaction-icon transfer">⇄</span><div><b>${escapeHtml(item.customerName)}</b><small>${escapeHtml(item.trackingCode)} · ${escapeHtml(item.mobile)} · ${formatPersianDate(item.createdAt)}</small><small dir="ltr">پیگیری ${escapeHtml(item.reference)}${item.cardLast4 ? ` · کارت ****${escapeHtml(item.cardLast4)}` : ""}</small>${item.duplicateReference ? '<small class="transfer-warning">این شماره پیگیری برای رزرو دیگری هم ثبت شده است</small>' : ""}</div><strong>${money(item.amountRials)}</strong>${data.canWrite ? '<div class="transfer-actions"><button type="button" data-decision="approve">تأیید واریز</button><button type="button" data-decision="reject" class="danger-action">رد</button></div>' : ""}`;
    row.querySelectorAll("[data-decision]").forEach((button) =>
      button.addEventListener("click", async () => {
        const approve = button.dataset.decision === "approve";
        if (
          !confirm(
            approve
              ? "واریز در حساب کافه دیده شده است؟ رزرو تأیید می‌شود."
              : "پرداخت رد و رزرو لغو شود؟",
          )
        )
          return;
        const response = await fetch(
            `/api/payments/transfers/${encodeURIComponent(item.id)}/${button.dataset.decision}`,
            { method: "POST" },
          ),
          result = await response.json();
        if (!response.ok) {
          error.textContent = result.message || "بررسی پرداخت انجام نشد";
          return;
        }
        await Promise.all([fetchPayments(), fetchAvailability()]);
      }),
    );
    list.appendChild(row);
  }
}
const paymentModes = {
  zarinpal: [
    "درگاه زرین‌پال",
    "بیعانه آنلاین از درگاه زرین‌پال دریافت می‌شود. بازپرداخت را از پنل زرین‌پال انجام دهید و این‌جا ثبت کنید.",
  ],
  demo: ["درگاه آزمایشی", "جریان کامل پرداخت شبیه‌سازی می‌شود و پول واقعی جابه‌جا نمی‌شود."],
  card: [
    "کارت به کارت · بررسی دستی",
    "مشتری بیعانه را به کارت کافه واریز می‌کند و شماره پیگیری را ثبت می‌کند. پس از دیدن واریز در حساب، آن را تأیید کنید.",
  ],
  none: [
    "درگاه پرداخت تنظیم نشده",
    "تا اتصال درگاه، رزرو آنلاین شعبه‌هایی که بیعانه دارند ممکن نیست.",
  ],
};
function showPaymentMode(mode) {
  if (mode === "none" && store.cafeSettings.cardTransferEnabled) mode = "card";
  const [title, text] = paymentModes[mode] || paymentModes.none,
    box = document.querySelector("#paymentMode");
  box.querySelector("b").textContent = title;
  box.querySelector("small").textContent = text;
  box.dataset.mode = mode;
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
    showPaymentMode(data.mode);
    renderTransfers(data);
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
        if (
          !confirm(
            item.provider === "demo"
              ? "بیعانه بازپرداخت و رزرو لغو شود؟"
              : item.provider === "card"
                ? "ابتدا مبلغ را به کارت مشتری برگردانید. بازپرداخت این‌جا ثبت و رزرو لغو شود؟"
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
        cardTransferEnabled: document.querySelector("#cardTransferEnabled").checked,
        cardNumber: latinDigits(document.querySelector("#cardNumber").value),
        cardHolder: document.querySelector("#cardHolder").value,
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
      if (payload.cardTransferEnabled && !data.cardTransferEnabled)
        throw new Error("شماره کارت معتبر نیست؛ ۱۶ رقم کارت را دوباره بررسی کنید.");
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
