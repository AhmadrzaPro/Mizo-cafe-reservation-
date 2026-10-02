import { fetchAvailability, renderCustomerMap, times } from "./booking.js";
import { editor } from "./dialogs.js";
import { renderEditor } from "./editor.js";
import { fitMap } from "./floor/editor-tools.js";
import { resetMapHistory } from "./floor/history.js";
import { faDigits } from "./format.js";
import { cloneDefault } from "./map-defaults.js";
import { applyCafeProfile, fetchMap, fetchSettings, loadCafeProfile } from "./profile.js";
import { store, studioDemo } from "./state.js";

export async function initializeApp() {
  if (studioDemo) {
    store.cafeMap = cloneDefault();
    store.cafeMap.areas.forEach((a) => {
      a.width = a.id === "main" ? 1600 : 1200;
      a.height = a.id === "main" ? 1000 : 800;
    });
    store.cafeMap.tables = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `demo-in-${i}`,
        area: "main",
        name: `میز ${faDigits(i + 1)}`,
        shape: i % 3 === 1 ? "rect" : i % 3 === 2 ? "square" : "round",
        capacity: i % 3 === 1 ? 6 : 4,
        x: 260 + (i % 3) * 450,
        y: 160 + Math.floor(i / 3) * 500,
        reservable: true,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `demo-out-${i}`,
        area: "terrace",
        name: `تراس ${faDigits(i + 1)}`,
        shape: i % 2 ? "rect" : "round",
        capacity: i % 2 ? 6 : 4,
        x: 210 + (i % 2) * 560,
        y: 160 + Math.floor(i / 2) * 400,
        reservable: true,
      })),
    ];
    resetMapHistory();
    renderEditor();
    document.querySelector("#publishMap").disabled = true;
    document.querySelector("#saveStatus").textContent = "دموی تعاملی · بدون تغییر اطلاعات کافه";
    document.querySelector("#branchSelect").disabled = true;
    editor.showModal();
    requestAnimationFrame(fitMap);
    return;
  }
  const profile = await loadCafeProfile();
  if (!profile.configured || !profile.branches?.length) {
    document.querySelector("#continueBtn").disabled = true;
    times.textContent =
      "برای رزرو، لینک اختصاصی کافه را باز کنید. برای راه‌اندازی، مدیریت کافه را انتخاب کنید.";
    return;
  }
  applyCafeProfile(profile);
  renderCustomerMap();
  await Promise.all([fetchMap(), fetchSettings()]);
  await fetchAvailability();
}
