import { cafeBaseUrl } from "./api.js";
import { adminDialog, smsDialog } from "./dialogs.js";
import { byId, html, setHtml, required } from "./dom.js";
import { switchBranch } from "./editor-nav.js";
import { faDigits, formatPersianDate, formatTehranTime } from "./format.js";
import { store } from "./state.js";

export function notificationsUrl(path = "") {
  return `${cafeBaseUrl()}/notifications${path}`;
}
export function smsStatusLabel(status) {
  return (
    {
      sent: "ارسال‌شده",
      demo_sent: "ثبت آزمایشی",
      queued: "در صف یادآوری",
      sending: "در حال ارسال",
      failed: "ناموفق",
      cancelled: "لغوشده",
      skipped: "ارسال‌نشده (سقف روزانه)",
    }[status] || status
  );
}
export function renderSms() {
  if (!store.smsData) return;
  const mode = byId("smsMode");
  mode.classList.toggle("connected", store.smsData.mode === "kavenegar");
  required("b", mode).textContent =
    store.smsData.mode === "kavenegar" ? "کاوه‌نگار متصل است" : "حالت آزمایشی";
  required("small", mode).textContent =
    store.smsData.mode === "kavenegar"
      ? "پیام‌ها از طریق قالب‌های تأییدشده کاوه‌نگار ارسال می‌شوند."
      : "متن پیامک ثبت می‌شود اما پیام واقعی ارسال نمی‌شود.";
  byId("smsConfirmationEnabled").checked = store.smsData.settings.confirmationEnabled;
  byId("smsReminderEnabled").checked = store.smsData.settings.reminderEnabled;
  byId("smsReminderMinutes").value = String(store.smsData.settings.reminderMinutes);
  byId("smsSent").textContent = faDigits(store.smsData.stats.sent);
  byId("smsQueued").textContent = faDigits(store.smsData.stats.queued);
  byId("smsFailed").textContent = faDigits(store.smsData.stats.failed);
  const list = byId("smsList");
  list.replaceChildren();
  if (!store.smsData.messages.length) {
    setHtml(
      list,
      html`<div class="sms-empty">
        هنوز پیامکی ثبت نشده است.<br />با ثبت رزرو جدید، پیام تأیید اینجا نمایش داده می‌شود.
      </div>`,
    );
    return;
  }
  store.smsData.messages.forEach((message) => {
    const item = document.createElement("article");
    item.className = `sms-row ${message.status}`;
    const moment = message.sentAt
      ? `ارسال: ${formatPersianDate(message.sentAt)} · ${formatTehranTime(message.sentAt)}`
      : `موعد: ${formatPersianDate(message.scheduledAt)} · ${formatTehranTime(message.scheduledAt)}`;
    setHtml(
      item,
      html`<div class="sms-row-top">
          <span class="sms-kind">${message.kind === "confirmation" ? "تأیید رزرو" : "یادآوری"}</span
          ><em>${smsStatusLabel(message.status)}</em>
        </div>
        <h3>${message.customerName} · ${faDigits(message.mobile)}</h3>
        <p>${message.message}</p>
        <small>${moment}${message.error && ` · ${message.error}`}</small>`,
    );
    list.appendChild(item);
  });
}
export async function fetchSms() {
  const error = byId("smsError");
  error.textContent = "";
  try {
    const response = await fetch(notificationsUrl()),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "دریافت پیامک‌ها انجام نشد.");
    store.smsData = data;
    renderSms();
  } catch (err) {
    error.textContent = err.message;
  }
}
export async function openSmsCenter() {
  adminDialog.close();
  byId("smsBranch").value = store.currentBranch;
  // Loaded before opening, so the toggles never show (or save) defaults instead of the settings.
  await fetchSms();
  smsDialog.showModal();
}

export function wireSms() {
  byId("openSms").onclick = openSmsCenter;
  byId("smsBranch").onchange = async () => {
    await switchBranch(byId("smsBranch").value);
    await fetchSms();
  };
  byId("refreshSms").onclick = fetchSms;
  byId("saveSmsSettings").onclick = async () => {
    const button = byId("saveSmsSettings"),
      error = byId("smsError");
    button.disabled = true;
    error.textContent = "";
    try {
      const response = await fetch(notificationsUrl(), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            confirmationEnabled: byId("smsConfirmationEnabled").checked,
            reminderEnabled: byId("smsReminderEnabled").checked,
            reminderMinutes: Number(byId("smsReminderMinutes").value),
          }),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ذخیره تنظیمات انجام نشد.");
      store.smsData = data;
      renderSms();
      button.textContent = "ذخیره شد";
      setTimeout(() => (button.textContent = "ذخیره تنظیمات"), 1400);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
  byId("processSms").onclick = async () => {
    const button = byId("processSms"),
      error = byId("smsError");
    button.disabled = true;
    button.textContent = "در حال بررسی…";
    error.textContent = "";
    try {
      const response = await fetch(notificationsUrl("/process"), { method: "POST" }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "اجرای یادآوری‌ها انجام نشد.");
      store.smsData = data.notifications;
      renderSms();
      button.textContent = data.processed
        ? `${faDigits(data.processed)} یادآوری اجرا شد`
        : "پیام موعدرسیده‌ای نبود";
    } catch (err) {
      error.textContent = err.message;
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = "اجرای یادآوری‌های موعدرسیده";
      }, 1500);
    }
  };
}
