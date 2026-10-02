import { apiUrl, readableError, safeResponseJson, settingsUrl } from "./api.js";
import { renderCustomerMap } from "./booking.js";
import { renderControls } from "./controls.js";
import { renderEditor, showPublishedToast } from "./editor.js";
import { recordMapHistory, resetMapHistory } from "./floor/history.js";
import { faDigits } from "./format.js";
import { cloneDefault } from "./map-defaults.js";
import { visibleAreas } from "./map-model.js";
import { pageParams, state, store, studioDemo } from "./state.js";

export function markDirty() {
  recordMapHistory();
  store.dirty = true;
  document.querySelector("#saveStatus").textContent = "تغییرات منتشر نشده";
}
export function activeBranches() {
  return store.cafeProfile.branches.filter(
    (branch) =>
      branch.active !== false &&
      (!store.managerSession?.branchId || branch.id === store.managerSession.branchId),
  );
}
export function activeBranchProfile() {
  return (
    store.cafeProfile.branches.find((branch) => branch.slug === store.currentBranch) ||
    activeBranches()[0] ||
    store.cafeProfile.branches[0]
  );
}
export function syncBranchSelectors() {
  const branches = activeBranches(),
    single = branches.length === 1;
  ["branchSelect", "controlBranch", "opsBranch", "smsBranch", "paymentsBranch"].forEach((id) => {
    const select = document.querySelector(`#${id}`);
    if (!select) return;
    select.innerHTML = "";
    branches.forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch.slug;
      option.textContent = branch.name;
      select.appendChild(option);
    });
    select.value = store.currentBranch;
    select.classList.toggle("single-branch", single);
  });
}
export function applyCafeProfile(profile) {
  if (!profile?.configured) return;
  store.cafeProfile = profile;
  store.currentCafeSlug = profile.cafe.slug;
  const url = new URL(location.href);
  url.searchParams.set("cafe", store.currentCafeSlug);
  url.searchParams.delete("new");
  history.replaceState(null, "", url);
  pageParams.delete("new");
  if (
    !profile.branches.some(
      (branch) => branch.slug === store.currentBranch && branch.active !== false,
    )
  )
    store.currentBranch = activeBranches()[0]?.slug || profile.branches[0]?.slug || "main";
  syncBranchSelectors();
  const branch = activeBranchProfile();
  if (!branch) return;
  document.querySelector(".cafe-meta span:first-child").textContent = profile.cafe.name;
  document.querySelector(".cafe-meta span:nth-child(2)").textContent =
    `${branch.city}، ${branch.name}`;
  document.querySelector("#adminCafeName").textContent = profile.cafe.name;
  document.querySelector("#adminCafeLocation").textContent = `${branch.city} · ${branch.name}`;
  document.querySelector(".ops-brand b").textContent = `عملیات ${profile.cafe.name}`;
  document.querySelector(".editor-header b").textContent = `چیدمان ${profile.cafe.name}`;
}
export async function loadCafeProfile() {
  if (pageParams.get("new") === "1") return { configured: false };
  try {
    const response = await fetch(
        "/api/setup" +
          (store.currentCafeSlug ? "?cafe=" + encodeURIComponent(store.currentCafeSlug) : ""),
      ),
      profile = await response.json();
    if (response.ok && profile.configured) applyCafeProfile(profile);
    return profile;
  } catch {
    return { configured: false };
  }
}
export function applySettingsToCustomer() {
  const notice = document.querySelector("#customerNoticeBanner"),
    continueBtn = document.querySelector("#continueBtn");
  notice.textContent = store.cafeSettings.customerNotice;
  notice.hidden = !store.cafeSettings.customerNotice;
  document.querySelector("#durationLabel").textContent =
    `مدت رزرو: ${faDigits(store.cafeSettings.reservationDuration)} دقیقه`;
  continueBtn.disabled = !store.cafeSettings.reservationsEnabled;
  continueBtn.innerHTML = store.cafeSettings.reservationsEnabled
    ? "ادامه و انتخاب میز <span>←</span>"
    : "رزرو موقتاً متوقف است";
  document
    .querySelector(".booking-card")
    .classList.toggle("booking-paused", !store.cafeSettings.reservationsEnabled);
  if (state.guests > store.cafeSettings.maxPartySize) {
    state.guests = store.cafeSettings.maxPartySize;
    document.querySelector("#guestCount").textContent = faDigits(state.guests);
  }
}
export async function fetchSettings() {
  try {
    const response = await fetch(settingsUrl());
    if (response.ok) {
      store.cafeSettings = await response.json();
      applySettingsToCustomer();
      renderControls();
      return true;
    }
  } catch {}
  document.querySelector("#controlSaveStatus").textContent = "دریافت تنظیمات ممکن نیست";
  return false;
}
export async function fetchMap() {
  if (studioDemo) return;
  document.querySelector("#saveStatus").textContent = "در حال دریافت از دیتابیس…";
  const requestedBranch = store.currentBranch,
    requestedCafe = store.currentCafeSlug;
  try {
    const response = await fetch(apiUrl());
    if (requestedBranch !== store.currentBranch || requestedCafe !== store.currentCafeSlug) return;
    if (response.status === 404) {
      store.cafeMap = cloneDefault();
      store.dirty = true;
      document.querySelector("#saveStatus").textContent = "شعبه جدید؛ آماده انتشار";
    } else if (response.ok) {
      store.cafeMap = await response.json();
      store.dirty = false;
      document.querySelector("#saveStatus").textContent = "همگام با دیتابیس";
    } else throw new Error("load");
    store.activeArea = visibleAreas()[0]?.id || store.cafeMap.areas[0]?.id || "main";
    store.customerArea = store.activeArea;
    store.selectedId = null;
    resetMapHistory();
    renderEditor();
    renderCustomerMap();
  } catch {
    if (requestedBranch !== store.currentBranch) return;
    document.querySelector("#saveStatus").textContent = "اتصال برقرار نشد؛ دوباره تلاش کنید";
    showPublishedToast("خطا در دریافت نقشه");
  }
}
export async function saveMap() {
  if (studioDemo) {
    showPublishedToast("این یک دمو است؛ اطلاعات کافه تغییر نمی‌کند.");
    return false;
  }
  document.querySelector("#saveStatus").textContent = "در حال ذخیره در دیتابیس…";
  const branch = activeBranchProfile();
  try {
    const response = await fetch(apiUrl(), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cafeName: store.cafeProfile.cafe.name,
          branchName: branch.name,
          city: branch.city,
          address: branch.address,
          map: store.cafeMap,
        }),
      }),
      data = await safeResponseJson(response, "ذخیره نقشه انجام نشد.");
    if (!response.ok) throw new Error(data.message || "ذخیره نقشه انجام نشد.");
    store.cafeMap = data;
    store.dirty = false;
    document.querySelector("#saveStatus").textContent = "همگام با دیتابیس";
    return true;
  } catch (error) {
    document.querySelector("#saveStatus").textContent = "ذخیره نشد؛ تغییرات حفظ شده‌اند";
    showPublishedToast(readableError(error, "خطا در ذخیره نقشه"));
    return false;
  }
}
