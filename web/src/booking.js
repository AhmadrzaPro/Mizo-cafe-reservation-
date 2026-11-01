import { availabilityUrl, readableError } from "./api.js";
import { byId, fragment, html, setHtml } from "./dom.js";
import { tableSize } from "./editor.js";
import { tableFurniture } from "./floor/furniture.js";
import { featureStyle } from "./floor/venue-features.js";
import { applyFloorViewport, areaBounds } from "./floor/zoom.js";
import { faDigits, formatTehranTime } from "./format.js";
import { visibleAreas } from "./map-model.js";
import { tehranClientNow } from "./operations.js";
import { payButtonLabel } from "./payment-flow.js";
import { state, store } from "./state.js";
import { holdTable, releaseHold, startCountdown } from "./table-hold.js";
import { venueGeometry } from "./venue-layout.js";

export const dates = byId("dates"),
  times = byId("times");
export function renderDates() {
  dates.replaceChildren();
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
    setHtml(b, html`<small>${weekday}</small><b>${day}</b>`);
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
  times.replaceChildren();
  const data = state.availability;
  if (!data) {
    setHtml(times, html`<span class="slot-message">در حال بررسی ظرفیت…</span>`);
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
export const count = byId("guestCount");
export async function changeGuests(delta) {
  state.guests = Math.max(1, Math.min(store.cafeSettings.maxPartySize, state.guests + delta));
  count.textContent = faDigits(state.guests);
  state.time = "";
  await fetchAvailability();
}
export const tableDialog = byId("tableDialog"),
  customerDialog = byId("customerDialog"),
  successDialog = byId("successDialog"),
  trackingDialog = byId("trackingDialog");
export function renderCustomerMap() {
  const floor = byId("customerFloorPlan"),
    tabs = byId("customerAreaTabs"),
    areas = visibleAreas();
  if (!areas.some((area) => area.id === store.customerArea))
    store.customerArea =
      areas.find((area) => store.cafeMap.tables.some((table) => table.area === area.id))?.id ||
      areas[0]?.id ||
      "";
  const current = areas.find((area) => area.id === store.customerArea);
  tabs.replaceChildren();
  tabs.hidden = areas.length < 2;
  areas.forEach((area) => {
    const button = document.createElement("button"),
      count = store.cafeMap.tables.filter((table) => table.area === area.id).length;
    button.type = "button";
    button.className = area.id === store.customerArea ? "active" : "";
    setHtml(
      button,
      html`<span>${area.kind === "outdoor" ? "☀" : "⌂"}</span><b>${area.name}</b
        ><small>${faDigits(count)} میز</small>`,
    );
    button.onclick = () => {
      store.customerArea = area.id;
      store.customerMapZoom = 1;
      byId("customerMapViewport").scrollTo(0, 0);
      state.table = "";
      state.tableId = "";
      const confirmButton = byId("confirmBtn");
      confirmButton.disabled = true;
      confirmButton.textContent = "یک میز را انتخاب کنید";
      renderCustomerMap();
    };
    tabs.appendChild(button);
  });
  floor.classList.toggle("outdoor", current?.kind === "outdoor");
  // The room's window and counter, where the owner put them in the map editor.
  const venue = current ? venueGeometry(current) : null;
  setHtml(
    floor,
    html`${current?.kind === "outdoor" && html`<span class="outdoor-label">فضای باز</span>`}${
      venue?.window &&
      html`<span class="window-label" style="${featureStyle(venue.window)}">پنجره سرتاسری</span>`
    }${
      venue?.counter &&
      html`<div class="bar" style="${featureStyle(venue.counter)}">بار و صندوق</div>`
    }`,
  );
  applyFloorViewport(floor, byId("customerMapStage"), areaBounds(current), store.customerMapZoom);
  const areaTables = store.cafeMap.tables.filter((t) => t.area === store.customerArea);
  if (!areaTables.length) {
    floor.append(
      fragment(
        html`<div class="map-empty">
          <b>هنوز میزی در این فضا ثبت نشده</b><span>فضای دیگری را انتخاب کنید.</span>
        </div>`,
      ),
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
    setHtml(
      b,
      html`${tableFurniture(t)}<span class="table-surface"
          ><b>${t.name.replace(/[^۰-۹0-9]/g, "") || "•"}</b
          ><small
            >${store.mapPreviewMode || free ? `${faDigits(t.capacity)} نفره` : t.capacity < state.guests ? "ظرفیت کم" : "رزرو شده"}</small
          ></span
        >`,
    );
    b.onclick = () => {
      floor.querySelectorAll(".table").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      chooseTable(fullId, b.dataset.table || "");
    };
    floor.appendChild(b);
  });
}
/**
 * Chooses a table for the booking in progress. The 2D map and the Virtual Cafe both use it.
 * @param {string} fullId The table's full id, as availability lists it.
 * @param {string} label What the customer sees, e.g. "میز ۳، سالن اصلی".
 */
export function chooseTable(fullId, label) {
  state.table = label;
  state.tableId = fullId;
  const confirm = byId("confirmBtn");
  confirm.disabled = false;
  confirm.textContent = `تأیید ${label}`;
}
/**
 * Goes on from the chosen table to the customer's details, after the server holds the table for
 * them. Returns false, staying on the table step with the reason shown, when it cannot be held.
 * @param {() => void} [beforeOpen] Runs once the table is held, just before the form opens.
 */
export async function continueWithTable(beforeOpen) {
  const confirm = byId("confirmBtn"),
    error = byId("tableHoldError");
  confirm.disabled = true;
  confirm.textContent = "در حال نگه‌داشتن میز…";
  error.hidden = true;
  const held = await holdTable(state.tableId);
  if (!held.ok) {
    error.textContent = held.message;
    error.hidden = false;
    // Taken meanwhile: show the fresh state of every table.
    if (held.status === 409) {
      await fetchAvailability();
      state.table = "";
      state.tableId = "";
      renderCustomerMap();
      confirm.textContent = "یک میز را انتخاب کنید";
    } else {
      confirm.disabled = false;
      confirm.textContent = `تأیید ${state.table}`;
    }
    return false;
  }
  beforeOpen?.();
  tableDialog.close();
  byId("customerSummary").textContent =
    `${state.table} · ${state.dateLabel} · ساعت ${faDigits(state.time)} · ${faDigits(state.guests)} نفر`;
  byId("reservationError").hidden = true;
  customerDialog.showModal();
  startCountdown();
  confirm.disabled = false;
  confirm.textContent = `تأیید ${state.table}`;
  return true;
}
// The deposit box as the page ships it, restored before each booking.
export const depositTemplate = byId("depositPayment").cloneNode(true);
export const money = (value) =>
  `${faDigits(Math.round(Number(value || 0) / 10).toLocaleString("en-US"))} تومان`;
export function showDepositPayment(payment, trackingCode, mobile) {
  const box = byId("depositPayment");
  box.replaceChildren(...depositTemplate.cloneNode(true).childNodes);
  store.pendingPayment = payment?.required ? { trackingCode, mobile } : null;
  box.hidden = !payment?.required;
  if (!payment?.required) return;
  byId("successDepositAmount").textContent = money(payment.amountRials);
  byId("depositDeadline").textContent =
    `مهلت پرداخت: ${faDigits(payment.dueAt ? formatTehranTime(payment.dueAt) : "—")}`;
  byId("depositPolicy").textContent = payment.refundPolicy || "";
  byId("payDeposit").textContent = payButtonLabel(true);
}

export function wireBooking() {
  renderDates();
  byId("plus").onclick = () => changeGuests(1);
  byId("minus").onclick = () => changeGuests(-1);
  byId("continueBtn").onclick = () => {
    if (!state.time) {
      times.classList.add("attention");
      setTimeout(() => times.classList.remove("attention"), 700);
      return;
    }
    const selected = state.availability?.slots.find((s) => s.time === state.time),
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
    byId("confirmBtn").disabled = true;
    byId("confirmBtn").textContent = "یک میز را انتخاب کنید";
    byId("selectionSummary").textContent =
      `${state.dateLabel}، ساعت ${faDigits(state.time)} برای ${faDigits(state.guests)} نفر`;
    tableDialog.showModal();
    renderCustomerMap();
  };
  window.addEventListener("resize", () => {
    if (tableDialog.open) renderCustomerMap();
  });
  /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll(".dialog-close")).forEach(
    (button) =>
      (button.onclick = () => {
        button.closest("dialog")?.close();
        const target =
          button.dataset.backTo &&
          /** @type {HTMLDialogElement | null} */ (
            document.querySelector(`#${button.dataset.backTo}`)
          );
        if (target && !target.open) target.showModal();
      }),
  );
  byId("confirmBtn").onclick = () => continueWithTable();
  // Leaving the form without booking gives the held table back.
  customerDialog.addEventListener("close", () => {
    if (state.hold) releaseHold();
  });
}
