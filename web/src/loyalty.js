import { readableError, safeResponseJson } from "./api.js";
import {
  adminDialog,
  controlDialog,
  editor,
  loyaltyAdjustDialog,
  loyaltyDialog,
  scheduleDialog,
} from "./dialogs.js";
import { byId } from "./dom.js";
import { renderEditor } from "./editor.js";
import { faDigits } from "./format.js";
import { escapeHtml } from "./operations.js";
import { fetchMap, fetchSettings } from "./profile.js";
import { fetchSchedule } from "./schedule.js";
import { store } from "./state.js";

export function renderLoyalty() {
  byId("loyaltyTotal").textContent = faDigits(store.loyaltyData.stats.total);
  byId("loyaltyReturning").textContent = faDigits(store.loyaltyData.stats.returning);
  byId("loyaltyPoints").textContent = faDigits(store.loyaltyData.stats.points);
  const list = byId("loyaltyList");
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
  const error = byId("loyaltyError"),
    query = byId("loyaltySearch").value.trim(),
    list = byId("loyaltyList"),
    refresh = byId("refreshLoyalty"),
    search = byId("searchLoyalty");
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
  byId("loyaltyCustomerId").value = customer.id;
  byId("loyaltyAdjustTitle").textContent = `امتیاز ${customer.name}`;
  byId("loyaltyAdjustment").value = "";
  byId("loyaltyNote").value = "";
  byId("loyaltyAdjustError").textContent = "";
  loyaltyDialog.close();
  loyaltyAdjustDialog.showModal();
}

export function wireLoyalty() {
  byId("openLoyalty").onclick = async () => {
    adminDialog.close();
    loyaltyDialog.showModal();
    await fetchLoyalty();
  };
  byId("refreshLoyalty").onclick = fetchLoyalty;
  byId("searchLoyalty").onclick = fetchLoyalty;
  byId("loyaltySearch").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      fetchLoyalty();
    }
  };
  byId("loyaltyAdjustForm").onsubmit = async (event) => {
    event.preventDefault();
    const id = byId("loyaltyCustomerId").value,
      error = byId("loyaltyAdjustError"),
      button = /** @type {HTMLButtonElement} */ (
        /** @type {HTMLFormElement} */ (event.currentTarget).querySelector('button[type="submit"]')
      ),
      originalText = button.textContent;
    button.disabled = true;
    button.textContent = "در حال ثبت…";
    error.textContent = "";
    try {
      const response = await fetch(`/api/loyalty/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            points: Number(byId("loyaltyAdjustment").value),
            note: byId("loyaltyNote").value,
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
  byId("openMapEditor").onclick = async () => {
    adminDialog.close();
    renderEditor();
    editor.showModal();
    await fetchMap();
  };
  byId("openControlCenter").onclick = async () => {
    adminDialog.close();
    controlDialog.showModal();
    await fetchSettings();
  };
  byId("openSchedule").onclick = async () => {
    adminDialog.close();
    scheduleDialog.showModal();
    await fetchSchedule();
  };
}
