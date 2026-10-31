import { adminDialog, subscriptionDialog } from "./dialogs.js";
import { byId } from "./dom.js";
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
  byId("subscriptionDisabled").hidden = store.subscriptionData.enabled;
  byId("subscriptionEnabled").hidden = !store.subscriptionData.enabled;
  if (!store.subscriptionData.enabled) return renderSubscriptionNotice();
  byId("subscriptionStatus").textContent = subscriptionStatusLabel(store.subscriptionData.status);
  const period =
    store.subscriptionData.endsAt ||
    (store.subscriptionData.status === "trial"
      ? store.subscriptionData.trialEndsAt
      : store.subscriptionData.currentPeriodEndsAt);
  byId("subscriptionPeriod").textContent = period ? formatPersianDate(period) : "تعیین نشده";
  byId("subscriptionBranchCount").textContent = faDigits(store.subscriptionData.activeBranchCount);
  byId("subscriptionUnitPrice").textContent = formatToman(store.subscriptionData.unitPriceRials);
  byId("subscriptionMonthlyTotal").textContent =
    `${formatToman(store.subscriptionData.monthlyPriceRials)} / ماه`;
  const events = byId("subscriptionEvents");
  events.innerHTML = store.subscriptionData.events.length
    ? store.subscriptionData.events
        .map(
          (event) =>
            `<article><b>${{ activated: "شروع دوره آزمایشی", plan_changed: "به‌روزرسانی اشتراک", disabled: "غیرفعال‌سازی", payment_demo: "پرداخت آزمایشی", payment_submitted: "ثبت کارت به کارت", payment_card: "تأیید پرداخت کارت به کارت", payment_rejected: "رد پرداخت کارت به کارت", expired: "پایان دوره؛ نیازمند پرداخت", updated: "به‌روزرسانی", saas_admin_update: "ویرایش مدیر SaaS" }[event.type] || event.type}</b><span>${formatPersianDate(event.createdAt)}${event.amountRials ? ` · ${formatToman(event.amountRials)}` : ""}</span></article>`,
        )
        .join("")
    : '<div class="subscription-empty">هنوز رویدادی ثبت نشده است.</div>';
  renderSubscriptionPayment();
  renderSubscriptionNotice();
}
/** "6219861930664833" → "6219 8619 3066 4833" */
const groupCard = (number) => String(number).replace(/(\d{4})(?=\d)/g, "$1 ");
// Paying the platform: the Mizo card for card-to-card transfers, or the pending transfer's status.
function renderSubscriptionPayment() {
  const data = store.subscriptionData,
    payment = data.payment || {},
    section = byId("subscriptionCardPayment");
  byId("renewSubscription").hidden = !payment.demo;
  section.hidden = !payment.card && !payment.pending;
  if (payment.pending) {
    section.innerHTML = `<b class="payment-review">پرداخت ${formatToman(payment.pending.amountRials)} با شماره پیگیری <span dir="ltr">${escapeHtml(payment.pending.reference)}</span> ثبت شد و پس از تأیید میزو، اشتراک تمدید می‌شود.</b>`;
    return;
  }
  if (!payment.card) return;
  section.innerHTML = `<h3>پرداخت اشتراک با کارت به کارت</h3><p>مبلغ یک ماه، <b>${formatToman(data.monthlyPriceRials)}</b>، را به این کارت واریز کنید و شماره پیگیری را ثبت کنید. پس از تأیید واریز، اشتراک ۳۰ روز تمدید می‌شود.</p><div class="card-number"><strong dir="ltr">${groupCard(payment.card.cardNumber)}</strong><button type="button" data-copy-card>کپی</button></div>${payment.card.cardHolder ? `<small>به نام ${escapeHtml(payment.card.cardHolder)}</small>` : ""}<form class="card-transfer-form"><label>شماره پیگیری انتقال<input name="reference" inputmode="numeric" maxlength="40" required dir="ltr"></label><label>۴ رقم آخر کارت شما<input name="cardLast4" inputmode="numeric" maxlength="4" dir="ltr"></label><button class="publish-btn" type="submit">ثبت پرداخت</button></form>`;
  const copy = /** @type {HTMLButtonElement} */ (section.querySelector("[data-copy-card]"));
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
    const error = byId("subscriptionError"),
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
const persianDate = (iso) =>
  new Date(iso).toLocaleDateString("fa-IR", { day: "numeric", month: "long" });
// The owner's warning once a trial or paid period has ended without payment.
export function renderSubscriptionNotice() {
  const data = store.subscriptionData,
    notice = byId("subscriptionNotice"),
    show = store.managerSession?.role === "owner" && data?.enabled && data.status === "past_due";
  notice.hidden = !show;
  if (!show) return;
  notice.dataset.paused = String(Boolean(data.bookingPaused));
  notice.querySelector("p").textContent = data.payment?.pending
    ? "دوره اشتراک تمام شده و پرداخت شما در انتظار تأیید میزو است."
    : data.bookingPaused
      ? "دوره اشتراک تمام شده و رزرو آنلاین مشتریان بسته شده است. پس از پرداخت و تأیید، دوباره باز می‌شود. پنل و رزرو تلفنی کار می‌کنند."
      : `دوره اشتراک تمام شده است. اگر تا ${data.graceEndsAt ? persianDate(data.graceEndsAt) : "چند روز آینده"} پرداخت نشود، رزرو آنلاین مشتریان بسته می‌شود.`;
}
/** Loads the subscription for the owner's warning when the panel opens. */
export async function refreshSubscriptionNotice() {
  if (store.managerSession?.role !== "owner") return renderSubscriptionNotice();
  try {
    const response = await fetch("/api/subscription");
    if (response.ok) store.subscriptionData = await response.json();
  } catch {
    // The warning is optional; the panel works without it.
  }
  renderSubscriptionNotice();
}
export async function fetchSubscription() {
  const error = byId("subscriptionError");
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
export function wireSubscription() {
  const openSubscription = async () => {
    adminDialog.close();
    await fetchSubscription();
    subscriptionDialog.showModal();
  };
  byId("openSubscription").onclick = openSubscription;
  byId("subscriptionNoticePay").onclick = openSubscription;
  byId("renewSubscription").onclick = async () => {
    const button = byId("renewSubscription"),
      error = byId("subscriptionError");
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
