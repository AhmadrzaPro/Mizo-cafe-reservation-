import { adminDialog, subscriptionDialog } from "./dialogs.js";
import { faDigits, formatPersianDate } from "./format.js";
import { store } from "./state.js";

export const formatToman = (rials) =>
  `${new Intl.NumberFormat("fa-IR").format(Math.round(Number(rials || 0) / 10))} تومان`;
export const subscriptionStatusLabel = (status) =>
  ({ inactive: "غیرفعال", trial: "دوره آزمایشی", active: "فعال", past_due: "نیازمند پرداخت" })[
    status
  ] || status;
export function renderSubscription() {
  if (!store.subscriptionData) return;
  document.querySelector("#subscriptionDisabled").hidden = store.subscriptionData.enabled;
  document.querySelector("#subscriptionEnabled").hidden = !store.subscriptionData.enabled;
  if (!store.subscriptionData.enabled) return;
  document.querySelector("#subscriptionStatus").textContent = subscriptionStatusLabel(
    store.subscriptionData.status,
  );
  const period =
    store.subscriptionData.status === "trial"
      ? store.subscriptionData.trialEndsAt
      : store.subscriptionData.currentPeriodEndsAt;
  document.querySelector("#subscriptionPeriod").textContent = period
    ? formatPersianDate(period)
    : "تعیین نشده";
  document.querySelector("#subscriptionBranchCount").textContent = faDigits(
    store.subscriptionData.activeBranchCount,
  );
  document.querySelector("#subscriptionUnitPrice").textContent = formatToman(
    store.subscriptionData.unitPriceRials,
  );
  document.querySelector("#subscriptionMonthlyTotal").textContent =
    `${formatToman(store.subscriptionData.monthlyPriceRials)} / ماه`;
  const events = document.querySelector("#subscriptionEvents");
  events.innerHTML = store.subscriptionData.events.length
    ? store.subscriptionData.events
        .map(
          (event) =>
            `<article><b>${{ activated: "شروع دوره آزمایشی", plan_changed: "به‌روزرسانی اشتراک", disabled: "غیرفعال‌سازی", payment_demo: "پرداخت آزمایشی", updated: "به‌روزرسانی", saas_admin_update: "ویرایش مدیر SaaS" }[event.type] || event.type}</b><span>${formatPersianDate(event.createdAt)}${event.amountRials ? ` · ${formatToman(event.amountRials)}` : ""}</span></article>`,
        )
        .join("")
    : '<div class="subscription-empty">هنوز رویدادی ثبت نشده است.</div>';
}
export async function fetchSubscription() {
  const error = document.querySelector("#subscriptionError");
  error.textContent = "";
  try {
    const response = await fetch("/api/subscription"),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "دریافت اشتراک انجام نشد.");
    store.subscriptionData = data;
    renderSubscription();
  } catch (err) {
    error.textContent = err.message;
  }
}
export async function changeSubscription(payload) {
  const error = document.querySelector("#subscriptionError");
  error.textContent = "";
  try {
    const response = await fetch("/api/subscription", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "تغییر اشتراک انجام نشد.");
    store.subscriptionData = data;
    renderSubscription();
  } catch (err) {
    error.textContent = err.message;
  }
}

export function wireSubscription() {
  document.querySelector("#openSubscription").onclick = async () => {
    adminDialog.close();
    subscriptionDialog.showModal();
    await fetchSubscription();
  };
  document.querySelector("#enableSubscription").onclick = () =>
    changeSubscription({ enabled: true });
  document.querySelector("#disableSubscription").onclick = () => {
    if (confirm("اشتراک برای این کافه غیرفعال شود؟")) changeSubscription({ enabled: false });
  };
  document.querySelector("#renewSubscription").onclick = async () => {
    const button = document.querySelector("#renewSubscription"),
      error = document.querySelector("#subscriptionError");
    button.disabled = true;
    error.textContent = "";
    try {
      const response = await fetch("/api/subscription/renew", { method: "POST" }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "تمدید انجام نشد.");
      store.subscriptionData = data;
      renderSubscription();
      button.textContent = "تمدید شد";
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "پرداخت آزمایشی و تمدید";
      }, 1400);
    }
  };
}
