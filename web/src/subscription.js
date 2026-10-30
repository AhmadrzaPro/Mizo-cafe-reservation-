import { adminDialog, subscriptionDialog } from "./dialogs.js";
import { faDigits, formatPersianDate, latinDigits } from "./format.js";
import { escapeHtml } from "./operations.js";
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
            `<article><b>${{ activated: "شروع دوره آزمایشی", plan_changed: "به‌روزرسانی اشتراک", disabled: "غیرفعال‌سازی", payment_demo: "پرداخت آزمایشی", payment_submitted: "ثبت کارت به کارت", payment_card: "تأیید پرداخت کارت به کارت", payment_rejected: "رد پرداخت کارت به کارت", updated: "به‌روزرسانی", saas_admin_update: "ویرایش مدیر SaaS" }[event.type] || event.type}</b><span>${formatPersianDate(event.createdAt)}${event.amountRials ? ` · ${formatToman(event.amountRials)}` : ""}</span></article>`,
        )
        .join("")
    : '<div class="subscription-empty">هنوز رویدادی ثبت نشده است.</div>';
  renderSubscriptionPayment();
}
/** "6219861930664833" → "6219 8619 3066 4833" */
const groupCard = (number) => String(number).replace(/(\d{4})(?=\d)/g, "$1 ");
// Paying the platform: the Mizo card for card-to-card transfers, or the pending transfer's status.
function renderSubscriptionPayment() {
  const data = store.subscriptionData,
    payment = data.payment || {},
    section = document.querySelector("#subscriptionCardPayment");
  document.querySelector("#renewSubscription").hidden = !payment.demo;
  section.hidden = !payment.card && !payment.pending;
  if (payment.pending) {
    section.innerHTML = `<b class="payment-review">پرداخت ${formatToman(payment.pending.amountRials)} با شماره پیگیری <span dir="ltr">${escapeHtml(payment.pending.reference)}</span> ثبت شد و پس از تأیید میزو، اشتراک تمدید می‌شود.</b>`;
    return;
  }
  if (!payment.card) return;
  section.innerHTML = `<h3>پرداخت اشتراک با کارت به کارت</h3><p>مبلغ یک ماه، <b>${formatToman(data.monthlyPriceRials)}</b>، را به این کارت واریز کنید و شماره پیگیری را ثبت کنید. پس از تأیید واریز، اشتراک ۳۰ روز تمدید می‌شود.</p><div class="card-number"><strong dir="ltr">${groupCard(payment.card.cardNumber)}</strong><button type="button" data-copy-card>کپی</button></div>${payment.card.cardHolder ? `<small>به نام ${escapeHtml(payment.card.cardHolder)}</small>` : ""}<form class="card-transfer-form"><label>شماره پیگیری انتقال<input name="reference" inputmode="numeric" maxlength="40" required dir="ltr"></label><label>۴ رقم آخر کارت شما<input name="cardLast4" inputmode="numeric" maxlength="4" dir="ltr"></label><button class="publish-btn" type="submit">ثبت پرداخت</button></form>`;
  const copy = section.querySelector("[data-copy-card]");
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(payment.card.cardNumber);
      copy.textContent = "کپی شد ✓";
    } catch {
      copy.textContent = "کپی نشد";
    }
  };
  const form = section.querySelector("form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    const error = document.querySelector("#subscriptionError"),
      button = form.querySelector("button"),
      fields = new FormData(form);
    error.textContent = "";
    button.disabled = true;
    try {
      const response = await fetch("/api/subscription/card-transfer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reference: latinDigits(String(fields.get("reference") || "")),
            cardLast4: latinDigits(String(fields.get("cardLast4") || "")),
          }),
        }),
        result = await response.json();
      if (!response.ok) throw new Error(result.message || "ثبت پرداخت انجام نشد.");
      store.subscriptionData = result;
      renderSubscription();
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
    }
  };
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
