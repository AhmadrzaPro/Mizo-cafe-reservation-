import { settingsUrl } from "./api.js";
import { fetchAvailability } from "./booking.js";
import { byId } from "./dom.js";
import { faDigits } from "./format.js";
import { activeBranchProfile, applySettingsToCustomer } from "./profile.js";
import { store } from "./state.js";

export function renderControls() {
  byId("reservationsEnabled").checked = store.cafeSettings.reservationsEnabled;
  byId("autoConfirm").checked = store.cafeSettings.autoConfirm;
  byId("reservationDuration").value = String(store.cafeSettings.reservationDuration);
  byId("bufferMinutes").value = String(store.cafeSettings.bufferMinutes);
  byId("maxPartyValue").textContent = faDigits(store.cafeSettings.maxPartySize);
  byId("customerNotice").value = store.cafeSettings.customerNotice;
  byId("noticeCount").textContent = faDigits(store.cafeSettings.customerNotice.length);
  const light = byId("reservationStatusLight");
  light.classList.toggle("offline", !store.cafeSettings.reservationsEnabled);
  byId("reservationStatusTitle").textContent = store.cafeSettings.reservationsEnabled
    ? "رزرو آنلاین فعال است"
    : "رزرو آنلاین متوقف است";
  byId("reservationStatusCaption").textContent = store.cafeSettings.reservationsEnabled
    ? "مشتری‌ها می‌توانند میز رزرو کنند"
    : "فرم رزرو برای مشتری غیرفعال است";
}
export function readControls() {
  store.cafeSettings = {
    ...store.cafeSettings,
    reservationsEnabled: byId("reservationsEnabled").checked,
    autoConfirm: byId("autoConfirm").checked,
    reservationDuration: Number(byId("reservationDuration").value),
    bufferMinutes: Number(byId("bufferMinutes").value),
    maxPartySize: store.cafeSettings.maxPartySize,
    customerNotice: byId("customerNotice").value.trim(),
  };
  renderControls();
}

export function wireControls() {
  byId("reservationsEnabled").onchange = readControls;
  byId("autoConfirm").onchange = readControls;
  byId("reservationDuration").onchange = readControls;
  byId("bufferMinutes").onchange = readControls;
  byId("customerNotice").oninput = () => {
    const notice = byId("customerNotice").value;
    store.cafeSettings.customerNotice = notice;
    byId("noticeCount").textContent = faDigits(notice.length);
  };
  byId("maxPartyMinus").onclick = () => {
    store.cafeSettings.maxPartySize = Math.max(1, store.cafeSettings.maxPartySize - 1);
    renderControls();
  };
  byId("maxPartyPlus").onclick = () => {
    store.cafeSettings.maxPartySize = Math.min(20, store.cafeSettings.maxPartySize + 1);
    renderControls();
  };
  byId("saveControls").onclick = async () => {
    readControls();
    const status = byId("controlSaveStatus"),
      branch = activeBranchProfile();
    status.textContent = "در حال ذخیره…";
    try {
      const response = await fetch(settingsUrl(), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...store.cafeSettings,
          cafeName: store.cafeProfile.cafe.name,
          branchName: branch.name,
          city: branch.city,
          address: branch.address,
        }),
      });
      if (!response.ok) throw new Error("save");
      store.cafeSettings = await response.json();
      renderControls();
      applySettingsToCustomer();
      await fetchAvailability();
      status.textContent = "تغییرات با موفقیت اعمال شد";
    } catch {
      status.textContent = "ذخیره انجام نشد؛ دوباره تلاش کنید";
    }
  };
}
