import { cafeBaseUrl } from "./api.js";
import { adminDialog, smsDialog } from "./dialogs.js";
import { switchBranch } from "./editor-nav.js";
import { faDigits, formatPersianDate } from "./format.js";
import { escapeHtml } from "./operations.js";
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
    }[status] || status
  );
}
export function renderSms() {
  if (!store.smsData) return;
  const mode = document.querySelector("#smsMode");
  mode.classList.toggle("connected", store.smsData.mode === "kavenegar");
  mode.querySelector("b").textContent =
    store.smsData.mode === "kavenegar" ? "کاوه‌نگار متصل است" : "حالت آزمایشی";
  mode.querySelector("small").textContent =
    store.smsData.mode === "kavenegar"
      ? "پیام‌ها از طریق قالب‌های تأییدشده کاوه‌نگار ارسال می‌شوند."
      : "متن پیامک ثبت می‌شود اما پیام واقعی ارسال نمی‌شود.";
  document.querySelector("#smsConfirmationEnabled").checked =
    store.smsData.settings.confirmationEnabled;
  document.querySelector("#smsReminderEnabled").checked = store.smsData.settings.reminderEnabled;
  document.querySelector("#smsReminderMinutes").value = String(
    store.smsData.settings.reminderMinutes,
  );
  document.querySelector("#smsSent").textContent = faDigits(store.smsData.stats.sent);
  document.querySelector("#smsQueued").textContent = faDigits(store.smsData.stats.queued);
  document.querySelector("#smsFailed").textContent = faDigits(store.smsData.stats.failed);
  const list = document.querySelector("#smsList");
  list.innerHTML = "";
  if (!store.smsData.messages.length) {
    list.innerHTML =
      '<div class="sms-empty">هنوز پیامکی ثبت نشده است.<br>با ثبت رزرو جدید، پیام تأیید اینجا نمایش داده می‌شود.</div>';
    return;
  }
  store.smsData.messages.forEach((message) => {
    const item = document.createElement("article");
    item.className = `sms-row ${message.status}`;
    const moment = message.sentAt
      ? `ارسال: ${formatPersianDate(message.sentAt)} · ${faDigits(String(message.sentAt).slice(11, 16))}`
      : `موعد: ${formatPersianDate(message.scheduledAt)} · ${faDigits(String(message.scheduledAt).slice(11, 16))}`;
    item.innerHTML = `<div class="sms-row-top"><span class="sms-kind">${message.kind === "confirmation" ? "تأیید رزرو" : "یادآوری"}</span><em>${smsStatusLabel(message.status)}</em></div><h3>${escapeHtml(message.customerName)} · ${faDigits(message.mobile)}</h3><p>${escapeHtml(message.message)}</p><small>${moment}${message.error ? ` · ${escapeHtml(message.error)}` : ""}</small>`;
    list.appendChild(item);
  });
}
export async function fetchSms() {
  const error = document.querySelector("#smsError");
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
  document.querySelector("#smsBranch").value = store.currentBranch;
  smsDialog.showModal();
  await fetchSms();
}

export function wireSms() {
  document.querySelector("#openSms").onclick = openSmsCenter;
  document.querySelector("#smsBranch").onchange = async (event) => {
    await switchBranch(event.target.value);
    await fetchSms();
  };
  document.querySelector("#refreshSms").onclick = fetchSms;
  document.querySelector("#saveSmsSettings").onclick = async () => {
    const button = document.querySelector("#saveSmsSettings"),
      error = document.querySelector("#smsError");
    button.disabled = true;
    error.textContent = "";
    try {
      const response = await fetch(notificationsUrl(), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            confirmationEnabled: document.querySelector("#smsConfirmationEnabled").checked,
            reminderEnabled: document.querySelector("#smsReminderEnabled").checked,
            reminderMinutes: Number(document.querySelector("#smsReminderMinutes").value),
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
  document.querySelector("#processSms").onclick = async () => {
    const button = document.querySelector("#processSms"),
      error = document.querySelector("#smsError");
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
