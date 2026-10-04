import { readableError, safeResponseJson } from "./api.js";
import {
  adminDialog,
  controlDialog,
  editor,
  loyaltyAdjustDialog,
  loyaltyDialog,
  scheduleDialog,
} from "./dialogs.js";
import { renderEditor } from "./editor.js";
import { faDigits } from "./format.js";
import { escapeHtml } from "./operations.js";
import { fetchMap, fetchSettings } from "./profile.js";
import { fetchSchedule } from "./schedule.js";
import { store } from "./state.js";

export function renderLoyalty() {
  document.querySelector("#loyaltyTotal").textContent = faDigits(store.loyaltyData.stats.total);
  document.querySelector("#loyaltyReturning").textContent = faDigits(
    store.loyaltyData.stats.returning,
  );
  document.querySelector("#loyaltyPoints").textContent = faDigits(store.loyaltyData.stats.points);
  const list = document.querySelector("#loyaltyList");
  if (!store.loyaltyData.customers.length) {
    list.innerHTML = '<div class="insight-empty">هنوز مشتری‌ای با این مشخصات پیدا نشده است.</div>';
    return;
  }
  list.innerHTML = "";
  store.loyaltyData.customers.forEach((customer) => {
    const progress = Math.min(
        100,
        Math.round((customer.points / store.loyaltyData.rewardThreshold) * 100),
      ),
      item = document.createElement("article");
    item.className = "loyalty-customer";
    item.innerHTML = `<span class="loyalty-avatar">${escapeHtml(customer.name.trim().charAt(0) || "م")}</span><div class="loyalty-info"><h3>${escapeHtml(customer.name)}</h3><p>${faDigits(customer.mobile)} · ${faDigits(customer.completedVisits)} مراجعه تکمیل‌شده</p><div class="loyalty-progress"><i><b style="width:${progress}%"></b></i><small>${faDigits(customer.points)} از ${faDigits(store.loyaltyData.rewardThreshold)} امتیاز</small></div></div><strong>${faDigits(customer.points)}<small> امتیاز</small></strong>${store.loyaltyData.canWrite ? '<button type="button">تغییر امتیاز</button>' : ""}`;
    item.querySelector("button")?.addEventListener("click", () => openLoyaltyAdjust(customer));
    list.appendChild(item);
  });
}
export async function fetchLoyalty() {
  const error = document.querySelector("#loyaltyError"),
    query = document.querySelector("#loyaltySearch").value.trim(),
    list = document.querySelector("#loyaltyList"),
    refresh = document.querySelector("#refreshLoyalty"),
    search = document.querySelector("#searchLoyalty");
  error.textContent = "";
  list.innerHTML = '<div class="insight-empty">در حال دریافت اطلاعات مشتریان…</div>';
  refresh.disabled = true;
  search.disabled = true;
  try {
    const response = await fetch(`/api/loyalty?q=${encodeURIComponent(query)}`),
      data = await safeResponseJson(response, "دریافت باشگاه مشتریان انجام نشد.");
    if (!response.ok) throw new Error(data.message || "دریافت باشگاه مشتریان انجام نشد.");
    if (!data?.stats || !Array.isArray(data.customers))
      throw new Error("پاسخ باشگاه مشتریان معتبر نیست.");
    store.loyaltyData = data;
    renderLoyalty();
  } catch (err) {
    list.innerHTML =
      '<div class="insight-empty">اطلاعات مشتریان دریافت نشد. دوباره تلاش کنید.</div>';
    error.textContent = readableError(
      err,
      "ارتباط با باشگاه مشتریان برقرار نشد. دوباره تلاش کنید.",
    );
  } finally {
    refresh.disabled = false;
    search.disabled = false;
  }
}
export function openLoyaltyAdjust(customer) {
  document.querySelector("#loyaltyCustomerId").value = customer.id;
  document.querySelector("#loyaltyAdjustTitle").textContent = `امتیاز ${customer.name}`;
  document.querySelector("#loyaltyAdjustment").value = "";
  document.querySelector("#loyaltyNote").value = "";
  document.querySelector("#loyaltyAdjustError").textContent = "";
  loyaltyDialog.close();
  loyaltyAdjustDialog.showModal();
}

export function wireLoyalty() {
  document.querySelector("#openLoyalty").onclick = async () => {
    adminDialog.close();
    loyaltyDialog.showModal();
    await fetchLoyalty();
  };
  document.querySelector("#refreshLoyalty").onclick = fetchLoyalty;
  document.querySelector("#searchLoyalty").onclick = fetchLoyalty;
  document.querySelector("#loyaltySearch").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      fetchLoyalty();
    }
  };
  document.querySelector("#loyaltyAdjustForm").onsubmit = async (event) => {
    event.preventDefault();
    const id = document.querySelector("#loyaltyCustomerId").value,
      error = document.querySelector("#loyaltyAdjustError"),
      button = event.currentTarget.querySelector('button[type="submit"]'),
      originalText = button.textContent;
    button.disabled = true;
    button.textContent = "در حال ثبت…";
    error.textContent = "";
    try {
      const response = await fetch(`/api/loyalty/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            points: Number(document.querySelector("#loyaltyAdjustment").value),
            note: document.querySelector("#loyaltyNote").value,
          }),
        }),
        data = await safeResponseJson(response, "تغییر امتیاز انجام نشد.");
      if (!response.ok) throw new Error(data.message || "تغییر امتیاز انجام نشد.");
      if (!data?.stats || !Array.isArray(data.customers))
        throw new Error("پاسخ باشگاه مشتریان معتبر نیست.");
      store.loyaltyData = data;
      renderLoyalty();
      loyaltyAdjustDialog.close();
      loyaltyDialog.showModal();
    } catch (err) {
      error.textContent = readableError(err, "تغییر امتیاز انجام نشد. دوباره تلاش کنید.");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  };
  document.querySelector("#openMapEditor").onclick = async () => {
    adminDialog.close();
    renderEditor();
    editor.showModal();
    await fetchMap();
  };
  document.querySelector("#openControlCenter").onclick = async () => {
    adminDialog.close();
    controlDialog.showModal();
    await fetchSettings();
  };
  document.querySelector("#openSchedule").onclick = async () => {
    adminDialog.close();
    scheduleDialog.showModal();
    await fetchSchedule();
  };
}
