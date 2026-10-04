import { availabilityUrl, readableError } from "./api.js";
import { tableSize } from "./editor.js";
import { tableFurniture } from "./floor/furniture.js";
import { applyFloorViewport, areaBounds } from "./floor/zoom.js";
import { faDigits } from "./format.js";
import { visibleAreas } from "./map-model.js";
import { escapeHtml, tehranClientNow } from "./operations.js";
import { state, store } from "./state.js";

export const dates = document.querySelector("#dates"),
  times = document.querySelector("#times");
export function renderDates() {
  dates.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    const d = new Date(tehranClientNow().date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10),
      parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        timeZone: "Asia/Tehran",
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(d),
      day = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
        timeZone: "Asia/Tehran",
        day: "numeric",
      }).format(d),
      weekday = i === 0 ? "امروز" : parts.split(" ")[0],
      b = document.createElement("button");
    if (i === 0 && !state.date) {
      state.date = date;
      state.dateLabel = parts;
    }
    b.className = "date" + (state.date === date ? " selected" : "");
    b.innerHTML = `<small>${weekday}</small><b>${day}</b>`;
    b.onclick = async () => {
      state.date = date;
      state.dateLabel = parts;
      state.time = "";
      renderDates();
      await fetchAvailability();
    };
    dates.appendChild(b);
  }
}
export function renderTimes() {
  times.innerHTML = "";
  const data = state.availability;
  if (!data) {
    times.innerHTML = '<span class="slot-message">در حال بررسی ظرفیت…</span>';
    return;
  }
  if (data.closed || !data.slots.length) {
    times.textContent = data.reason || "در این روز زمان آزادی وجود ندارد.";
    return;
  }
  data.slots.forEach((slot) => {
    const b = document.createElement("button");
    b.className = "time" + (state.time === slot.time ? " selected" : "");
    b.textContent = faDigits(slot.time);
    b.disabled = !slot.available;
    b.title = slot.available ? `${faDigits(slot.remaining)} میز آزاد` : "تکمیل ظرفیت";
    b.onclick = () => {
      state.time = slot.time;
      state.availableTableIds = new Set(slot.tableIds);
      renderTimes();
    };
    times.appendChild(b);
  });
}
export async function fetchAvailability() {
  const requestId = ++store.availabilityRequest;
  state.availability = null;
  state.availableTableIds = new Set();
  renderTimes();
  try {
    const response = await fetch(availabilityUrl()),
      data = await response.json();
    if (requestId !== store.availabilityRequest) return;
    if (!response.ok) throw new Error(data.message || "خطا");
    state.availability = data;
    const selected = data.slots?.find((s) => s.time === state.time && s.available);
    if (selected) state.availableTableIds = new Set(selected.tableIds);
    else state.time = "";
    renderTimes();
  } catch (error) {
    if (requestId !== store.availabilityRequest) return;
    times.textContent = readableError(error, "دریافت ظرفیت ممکن نیست.");
  }
}
export const count = document.querySelector("#guestCount");
export async function changeGuests(delta) {
  state.guests = Math.max(1, Math.min(store.cafeSettings.maxPartySize, state.guests + delta));
  count.textContent = faDigits(state.guests);
  state.time = "";
  await fetchAvailability();
}
export const tableDialog = document.querySelector("#tableDialog"),
  customerDialog = document.querySelector("#customerDialog"),
  successDialog = document.querySelector("#successDialog"),
  trackingDialog = document.querySelector("#trackingDialog");
export function renderCustomerMap() {
  const floor = document.querySelector("#customerFloorPlan"),
    tabs = document.querySelector("#customerAreaTabs"),
    areas = visibleAreas();
  if (!areas.some((area) => area.id === store.customerArea))
    store.customerArea =
      areas.find((area) => store.cafeMap.tables.some((table) => table.area === area.id))?.id ||
      areas[0]?.id ||
      "";
  const current = areas.find((area) => area.id === store.customerArea);
  tabs.innerHTML = "";
  tabs.hidden = areas.length < 2;
  areas.forEach((area) => {
    const button = document.createElement("button"),
      count = store.cafeMap.tables.filter((table) => table.area === area.id).length;
    button.type = "button";
    button.className = area.id === store.customerArea ? "active" : "";
    button.innerHTML = `<span>${area.kind === "outdoor" ? "☀" : "⌂"}</span><b>${escapeHtml(area.name)}</b><small>${faDigits(count)} میز</small>`;
    button.onclick = () => {
      store.customerArea = area.id;
      store.customerMapZoom = 1;
      document.querySelector("#customerMapViewport").scrollTo(0, 0);
      state.table = "";
      state.tableId = "";
      const confirmButton = document.querySelector("#confirmBtn");
      confirmButton.disabled = true;
      confirmButton.textContent = "یک میز را انتخاب کنید";
      renderCustomerMap();
    };
    tabs.appendChild(button);
  });
  floor.classList.toggle("outdoor", current?.kind === "outdoor");
  floor.innerHTML =
    current?.kind === "outdoor"
      ? '<span class="outdoor-label">فضای باز</span>'
      : '<span class="window-label">پنجره سرتاسری</span><div class="bar">بار و صندوق</div>';
  applyFloorViewport(
    floor,
    document.querySelector("#customerMapStage"),
    areaBounds(current),
    store.customerMapZoom,
  );
  const areaTables = store.cafeMap.tables.filter((t) => t.area === store.customerArea);
  if (!areaTables.length) {
    floor.insertAdjacentHTML(
      "beforeend",
      '<div class="map-empty"><b>هنوز میزی در این فضا ثبت نشده</b><span>فضای دیگری را انتخاب کنید.</span></div>',
    );
  }
  areaTables.forEach((t) => {
    const fullId = `branch:${store.currentCafeSlug}:${store.currentBranch}:${t.id}`,
      free = store.mapPreviewMode || state.availableTableIds.has(fullId),
      b = document.createElement("button"),
      size = tableSize(t);
    b.className = `table studio-table ${t.shape} ${free ? "available" : "reserved"}`;
    b.style.left = `${t.x}px`;
    b.style.top = `${t.y}px`;
    b.style.width = `${size.w}px`;
    b.style.height = `${size.h}px`;
    if (t.shape !== "round") b.style.borderRadius = "12px";
    b.disabled = store.mapPreviewMode || !free;
    b.dataset.table = `${t.name}، ${current?.name || "فضای کافه"}`;
    b.innerHTML =
      tableFurniture(t) +
      `<span class="table-surface"><b>${escapeHtml(t.name.replace(/[^۰-۹0-9]/g, "") || "•")}</b><small>${store.mapPreviewMode || free ? `${faDigits(t.capacity)} نفره` : t.capacity < state.guests ? "ظرفیت کم" : "رزرو شده"}</small></span>`;
    b.onclick = () => {
      floor.querySelectorAll(".table").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      state.table = b.dataset.table;
      state.tableId = fullId;
      const c = document.querySelector("#confirmBtn");
      c.disabled = false;
      c.textContent = `تأیید ${state.table}`;
    };
    floor.appendChild(b);
  });
}
export const depositTemplate = document.querySelector("#depositPayment").innerHTML;
export const money = (value) =>
  `${faDigits(Math.round(Number(value || 0) / 10).toLocaleString("en-US"))} تومان`;
export function showDepositPayment(payment, trackingCode, mobile) {
  const box = document.querySelector("#depositPayment");
  box.innerHTML = depositTemplate;
  store.pendingPayment = payment?.required ? { trackingCode, mobile } : null;
  box.hidden = !payment?.required;
  if (!payment?.required) return;
  document.querySelector("#successDepositAmount").textContent = money(payment.amountRials);
  document.querySelector("#depositDeadline").textContent =
    `مهلت پرداخت: ${faDigits(payment.dueAt ? new Date(payment.dueAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) : "—")}`;
  document.querySelector("#depositPolicy").textContent = payment.refundPolicy || "";
}

export function wireBooking() {
  renderDates();
  document.querySelector("#plus").onclick = () => changeGuests(1);
  document.querySelector("#minus").onclick = () => changeGuests(-1);
  document.querySelector("#continueBtn").onclick = () => {
    if (!state.time) {
      times.classList.add("attention");
      setTimeout(() => times.classList.remove("attention"), 700);
      return;
    }
    const selected = state.availability.slots.find((s) => s.time === state.time),
      areas = visibleAreas();
    state.availableTableIds = new Set(selected?.tableIds || []);
    state.table = "";
    state.tableId = "";
    store.customerArea =
      areas.find((area) =>
        store.cafeMap.tables.some(
          (table) =>
            table.area === area.id &&
            state.availableTableIds.has(
              `branch:${store.currentCafeSlug}:${store.currentBranch}:${table.id}`,
            ),
        ),
      )?.id ||
      areas[0]?.id ||
      "";
    document.querySelector("#confirmBtn").disabled = true;
    document.querySelector("#confirmBtn").textContent = "یک میز را انتخاب کنید";
    document.querySelector("#selectionSummary").textContent =
      `${state.dateLabel}، ساعت ${faDigits(state.time)} برای ${faDigits(state.guests)} نفر`;
    tableDialog.showModal();
    renderCustomerMap();
  };
  window.addEventListener("resize", () => {
    if (tableDialog.open) renderCustomerMap();
  });
  document.querySelectorAll(".dialog-close").forEach(
    (button) =>
      (button.onclick = () => {
        button.closest("dialog").close();
        const target = button.dataset.backTo && document.querySelector(`#${button.dataset.backTo}`);
        if (target && !target.open) target.showModal();
      }),
  );
  document.querySelector("#confirmBtn").onclick = () => {
    tableDialog.close();
    document.querySelector("#customerSummary").textContent =
      `${state.table} · ${state.dateLabel} · ساعت ${faDigits(state.time)} · ${faDigits(state.guests)} نفر`;
    document.querySelector("#reservationError").hidden = true;
    customerDialog.showModal();
  };
}
