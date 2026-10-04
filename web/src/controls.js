import { settingsUrl } from "./api.js";
import { fetchAvailability } from "./booking.js";
import { faDigits } from "./format.js";
import { activeBranchProfile, applySettingsToCustomer } from "./profile.js";
import { store } from "./state.js";

export function renderControls() {
  document.querySelector("#reservationsEnabled").checked = store.cafeSettings.reservationsEnabled;
  document.querySelector("#autoConfirm").checked = store.cafeSettings.autoConfirm;
  document.querySelector("#reservationDuration").value = String(
    store.cafeSettings.reservationDuration,
  );
  document.querySelector("#bufferMinutes").value = String(store.cafeSettings.bufferMinutes);
  document.querySelector("#maxPartyValue").textContent = faDigits(store.cafeSettings.maxPartySize);
  document.querySelector("#customerNotice").value = store.cafeSettings.customerNotice;
  document.querySelector("#noticeCount").textContent = faDigits(
    store.cafeSettings.customerNotice.length,
  );
  const light = document.querySelector("#reservationStatusLight");
  light.classList.toggle("offline", !store.cafeSettings.reservationsEnabled);
  document.querySelector("#reservationStatusTitle").textContent = store.cafeSettings
    .reservationsEnabled
    ? "رزرو آنلاین فعال است"
    : "رزرو آنلاین متوقف است";
  document.querySelector("#reservationStatusCaption").textContent = store.cafeSettings
    .reservationsEnabled
    ? "مشتری‌ها می‌توانند میز رزرو کنند"
    : "فرم رزرو برای مشتری غیرفعال است";
}
export function readControls() {
  store.cafeSettings = {
    ...store.cafeSettings,
    reservationsEnabled: document.querySelector("#reservationsEnabled").checked,
    autoConfirm: document.querySelector("#autoConfirm").checked,
    reservationDuration: Number(document.querySelector("#reservationDuration").value),
    bufferMinutes: Number(document.querySelector("#bufferMinutes").value),
    maxPartySize: store.cafeSettings.maxPartySize,
    customerNotice: document.querySelector("#customerNotice").value.trim(),
  };
  renderControls();
}

export function wireControls() {
  document.querySelector("#reservationsEnabled").onchange = readControls;
  document.querySelector("#autoConfirm").onchange = readControls;
  document.querySelector("#reservationDuration").onchange = readControls;
  document.querySelector("#bufferMinutes").onchange = readControls;
  document.querySelector("#customerNotice").oninput = (e) => {
    store.cafeSettings.customerNotice = e.target.value;
    document.querySelector("#noticeCount").textContent = faDigits(e.target.value.length);
  };
  document.querySelector("#maxPartyMinus").onclick = () => {
    store.cafeSettings.maxPartySize = Math.max(1, store.cafeSettings.maxPartySize - 1);
    renderControls();
  };
  document.querySelector("#maxPartyPlus").onclick = () => {
    store.cafeSettings.maxPartySize = Math.min(20, store.cafeSettings.maxPartySize + 1);
    renderControls();
  };
  document.querySelector("#saveControls").onclick = async () => {
    readControls();
    const status = document.querySelector("#controlSaveStatus"),
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
