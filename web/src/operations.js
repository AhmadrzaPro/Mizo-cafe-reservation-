import { cafeBaseUrl } from "./api.js";
import { fetchAvailability } from "./booking.js";
import { adminDialog } from "./dialogs.js";
import { tableSize } from "./editor.js";
import { switchBranch } from "./editor-nav.js";
import { tableFurniture } from "./floor/furniture.js";
import { applyFloorViewport, areaBounds } from "./floor/zoom.js";
import { faDigits, isoDate, isoValue, latinDigits, setJalaliInput } from "./format.js";
import { applyManagerAccess, hasManagerPermission } from "./manager.js";
import { store } from "./state.js";

// Phase 2: live operations dashboard
export const opsDialog = document.querySelector("#opsDialog"),
  opsReservationDialog = document.querySelector("#opsReservationDialog"),
  waitlistDialog = document.querySelector("#waitlistDialog");
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char],
  );
export function operationsUrl(path = "") {
  return `${cafeBaseUrl()}/operations${path}`;
}
export function opsStatusLabel(status) {
  return (
    {
      pending: "در انتظار",
      confirmed: "تأیید شده",
      arrived: "مشتری رسیده",
      completed: "تکمیل شده",
      cancelled: "لغو شده",
      no_show: "عدم مراجعه",
    }[status] || status
  );
}
export function sourceLabel(source) {
  return source === "phone" ? "تلفنی" : source === "walk_in" ? "حضوری" : "آنلاین";
}
export async function fetchOperations() {
  const sync = document.querySelector("#opsSync");
  sync.textContent = "در حال تازه‌سازی…";
  try {
    const date = isoValue(document.querySelector("#opsDate")) || isoDate(new Date()),
      time = document.querySelector("#opsFloorTime").value || roundedFloorTime(),
      response = await fetch(`${operationsUrl()}?date=${date}&time=${encodeURIComponent(time)}`),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "دریافت عملیات ممکن نیست");
    store.opsData = data;
    renderOperations();
    sync.textContent = `به‌روز شد · ${new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
  } catch (err) {
    sync.textContent = err.message;
  }
}
export function renderOperations() {
  if (!store.opsData) return;
  const s = store.opsData.stats,
    cards = document.querySelectorAll("#opsKpis article");
  [
    [s.reservations, "رزرو امروز"],
    [s.guests, "مهمان"],
    [`${s.occupiedTables}/${s.totalTables}`, "میز قفل‌شده"],
    [s.remainingCapacity, "صندلی آزاد"],
    [s.delayed + s.waiting, "نیازمند توجه"],
  ].forEach(([value, label], i) => {
    cards[i].querySelector("span").textContent = label;
    cards[i].querySelector("strong").textContent = faDigits(value);
  });
  document.querySelector("#opsNextReservation").textContent = store.opsData.nextReservation
    ? `رزرو بعدی: ${store.opsData.nextReservation.customerName}، ساعت ${faDigits(store.opsData.nextReservation.time)}`
    : "رزرو فعال دیگری باقی نمانده";
  renderOperationalReservations();
  renderOpsAreas();
  renderOpsMap();
  renderWaitlist();
  fillOpsTables();
}
export function renderOperationalReservations() {
  const list = document.querySelector("#opsReservationList"),
    query = latinDigits(document.querySelector("#opsSearch").value).trim().toLowerCase(),
    filter = document.querySelector("#opsStatusFilter").value,
    rows = store.opsData.reservations.filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        (!query || `${r.customerName} ${r.mobile} ${r.trackingCode}`.toLowerCase().includes(query)),
    );
  list.innerHTML = "";
  if (!rows.length) {
    list.innerHTML =
      '<div class="ops-empty">رزروی با این فیلتر پیدا نشد.<br>رزرو تلفنی یا حضوری را از دکمه بالا ثبت کنید.</div>';
    return;
  }
  rows.forEach((r) => {
    const row = document.createElement("div");
    row.className = "ops-reservation-row";
    row.innerHTML = `<time>${faDigits(r.time)}</time><div><h4>${escapeHtml(r.customerName)}</h4><p>${faDigits(r.partySize)} نفر · ${escapeHtml(r.tables.join("، ") || "بدون میز")} <span class="source">${sourceLabel(r.source)}</span></p></div><em class="ops-status ${r.status}">${opsStatusLabel(r.status)}</em>`;
    if (hasManagerPermission("reservations.write")) row.onclick = () => openOpsReservation(r);
    else row.classList.add("readonly");
    list.appendChild(row);
  });
}
export function renderOpsAreas() {
  const tabs = document.querySelector("#opsAreaTabs"),
    areas = [
      ...new Map(
        store.opsData.tables.map((table) => [
          table.areaId,
          { id: table.areaId, name: table.areaName },
        ]),
      ).values(),
    ];
  if (!areas.some((area) => area.id === store.opsAreaId)) store.opsAreaId = areas[0]?.id || "";
  tabs.innerHTML = "";
  tabs.hidden = areas.length < 2;
  areas.forEach((area) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = area.id === store.opsAreaId ? "active" : "";
    button.textContent = area.name;
    button.onclick = () => {
      store.opsAreaId = area.id;
      store.opsMapZoom = 1;
      document.querySelector("#opsMapViewport").scrollTo(0, 0);
      renderOpsAreas();
      renderOpsMap();
    };
    tabs.appendChild(button);
  });
}
export function renderOpsMap() {
  document.querySelector("#opsMapViewport .table-popover")?.remove();
  const floor = document.querySelector("#opsFloor");
  floor.innerHTML = "";
  const tables = store.opsData.tables.filter(
      (table) => !store.opsAreaId || table.areaId === store.opsAreaId,
    ),
    area = { width: tables[0]?.areaWidth, height: tables[0]?.areaHeight };
  applyFloorViewport(
    floor,
    document.querySelector("#opsMapStage"),
    areaBounds(area),
    store.opsMapZoom,
  );
  tables.forEach((t) => {
    const b = document.createElement("button"),
      size = tableSize(t);
    b.className = `ops-table ${t.shape} ${t.liveStatus}`;
    b.style.left = `${t.x}px`;
    b.style.top = `${t.y}px`;
    b.style.width = `${size.w}px`;
    b.style.height = `${size.h}px`;
    const reservationLabel = t.reservation
      ? `${t.reservation.customerName ? escapeHtml(t.reservation.customerName) + " · " : ""}${faDigits(t.reservation.time)}`
      : `${faDigits(t.capacity)} نفره`;
    b.innerHTML =
      tableFurniture(t) +
      `<span class="table-surface"><b>${escapeHtml(t.name)}</b><small>${reservationLabel}</small></span>`;
    b.onclick = (e) => {
      if (t.canQuickLock && hasManagerPermission("reservations.write")) quickLockTable(t, b);
      else openTablePopover(e, t);
    };
    floor.appendChild(b);
  });
}
export async function quickLockTable(table, button) {
  button.disabled = true;
  button.classList.add("locking");
  document.querySelector("#opsFloorHint").textContent = `در حال قفل‌کردن ${table.name}…`;
  const payload = {
    customerName: "مهمان حضوری",
    mobile: "",
    source: "walk_in",
    status: "confirmed",
    date: isoValue(document.querySelector("#opsDate")) || tehranClientNow().date,
    time: document.querySelector("#opsFloorTime").value || roundedFloorTime(),
    partySize: Math.min(table.capacity, store.cafeSettings.maxPartySize || 20),
    tableIds: [table.id],
    notes: "ثبت سریع از نقشه سالن",
    internalNotes: "قفل سریع میز برای مراجعه حضوری",
  };
  try {
    const response = await fetch(operationsUrl("/reservations"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "قفل میز انجام نشد");
    document.querySelector("#opsFloorHint").textContent =
      `${table.name} برای ساعت ${faDigits(payload.time)} قفل شد`;
    await Promise.all([fetchOperations(), fetchAvailability()]);
  } catch (error) {
    button.disabled = false;
    button.classList.remove("locking");
    document.querySelector("#opsFloorHint").textContent = error.message;
  }
}
export async function quickReleaseTable(table, button) {
  button.disabled = true;
  const response = await fetch(
      `${operationsUrl("/reservations")}/${encodeURIComponent(table.reservation.trackingCode)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      },
    ),
    data = await response.json();
  if (!response.ok) {
    button.disabled = false;
    document.querySelector("#opsFloorHint").textContent = data.message || "آزادکردن میز انجام نشد";
    return;
  }
  document.querySelector("#opsFloorHint").textContent = `${table.name} آزاد شد`;
  document.querySelector(".table-popover")?.remove();
  await Promise.all([fetchOperations(), fetchAvailability()]);
}
export function openTablePopover(event, table) {
  document.querySelector(".table-popover")?.remove();
  const box = document.createElement("div"),
    canEdit = hasManagerPermission("tables.write"),
    canRelease =
      hasManagerPermission("reservations.write") &&
      table.reservation?.source === "walk_in" &&
      table.reservation?.customerName === "مهمان حضوری";
  box.className = "table-popover";
  box.innerHTML = `<b>${escapeHtml(table.name)}</b><small>${table.reservation ? `${table.reservation.customerName ? escapeHtml(table.reservation.customerName) + " · " : ""}ساعت ${faDigits(table.reservation.time)}` : "بدون رزرو فعال"}</small>${canRelease ? '<button class="quick-release">آزادکردن میز</button>' : ""}${canEdit ? `<div><button data-status="available" class="${table.manualStatus === "available" ? "active" : ""}">آماده</button><button data-status="dirty" class="${table.manualStatus === "dirty" ? "active" : ""}">نظافت</button><button data-status="inactive" class="${table.manualStatus === "inactive" ? "active" : ""}">غیرفعال</button></div>` : "<p>دسترسی شما فقط برای مشاهده است.</p>"}`;
  const floor = document.querySelector("#opsMapViewport"),
    rect = floor.getBoundingClientRect();
  box.style.left = `${floor.scrollLeft + Math.max(8, Math.min(floor.clientWidth - 220, event.clientX - rect.left - 105))}px`;
  box.style.top = `${floor.scrollTop + Math.max(8, Math.min(floor.clientHeight - 170, event.clientY - rect.top + 20))}px`;
  box
    .querySelector(".quick-release")
    ?.addEventListener("click", (event) => quickReleaseTable(table, event.currentTarget));
  box.querySelectorAll("[data-status]").forEach(
    (btn) =>
      (btn.onclick = async () => {
        await updateTableStatus(table.id, btn.dataset.status);
        box.remove();
      }),
  );
  floor.appendChild(box);
}
export async function updateTableStatus(id, status) {
  const response = await fetch(`${operationsUrl("/tables")}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (response.ok) await fetchOperations();
}
export function renderWaitlist() {
  const list = document.querySelector("#opsWaitlist"),
    waiting = store.opsData.waitlist.filter((w) => w.status === "waiting");
  document.querySelector("#waitCount").textContent = waiting.length
    ? `${faDigits(waiting.length)} گروه منتظر`
    : "بدون مشتری منتظر";
  list.innerHTML = "";
  if (!store.opsData.waitlist.length) {
    list.innerHTML = '<div class="ops-empty">لیست انتظار خالی است</div>';
    return;
  }
  store.opsData.waitlist.forEach((w) => {
    const item = document.createElement("div");
    item.className = "wait-row";
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(w.createdAt).getTime()) / 60000));
    item.innerHTML = `<header><b>${escapeHtml(w.customerName)}</b><time>${faDigits(elapsed)} دقیقه</time></header><p>${faDigits(w.partySize)} نفر · انتظار اعلامی ${faDigits(w.quotedMinutes)} دقیقه</p><div class="wait-actions"><button data-status="seated">میز گرفت</button><button data-status="${w.status === "called" ? "waiting" : "called"}">${w.status === "called" ? "بازگشت به انتظار" : "اعلام به مشتری"}</button></div>`;
    item
      .querySelectorAll("button")
      .forEach((btn) => (btn.onclick = () => updateWaitlist(w.id, btn.dataset.status)));
    list.appendChild(item);
  });
}
export async function updateWaitlist(id, status) {
  const response = await fetch(`${operationsUrl("/waitlist")}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (response.ok) await fetchOperations();
}
export function fillOpsTables(selected = "") {
  const select = document.querySelector("#opsTableSelect");
  select.innerHTML = '<option value="">انتخاب میز</option>';
  (store.opsData?.tables || [])
    .filter((t) => t.reservable && t.manualStatus !== "inactive")
    .forEach((t) => {
      const option = document.createElement("option");
      option.value = t.id;
      option.textContent = `${t.name} · ${faDigits(t.capacity)} نفره${t.liveStatus === "available" ? "" : " · " + { occupied: "مشغول", upcoming: "رزرو آینده", awaiting: "منتظر ورود", dirty: "نظافت" }[t.liveStatus]}`;
      option.selected = t.id === selected;
      select.appendChild(option);
    });
}
export function openOpsReservation(reservation = null) {
  document.querySelector("#opsReservationForm").reset();
  document.querySelector("#opsTrackingCode").value = reservation?.trackingCode || "";
  document.querySelector("#opsFormTitle").textContent = reservation
    ? "ویرایش رزرو"
    : "ثبت رزرو تلفنی یا حضوری";
  document.querySelector("#opsCustomerName").value = reservation?.customerName || "";
  document.querySelector("#opsCustomerMobile").value = reservation?.mobile || "";
  document.querySelector("#opsSource").value =
    reservation?.source === "walk_in" ? "walk_in" : "phone";
  document.querySelector("#opsSource").disabled = !!reservation;
  document.querySelector("#opsReservationStatus").value = reservation?.status || "confirmed";
  setJalaliInput(
    document.querySelector("#opsReservationDate"),
    reservation?.date || isoValue(document.querySelector("#opsDate")) || isoDate(new Date()),
  );
  document.querySelector("#opsReservationTime").value =
    reservation?.time ||
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
  document.querySelector("#opsPartySize").value = reservation?.partySize || 2;
  document.querySelector("#opsCustomerNote").value = reservation?.notes || "";
  document.querySelector("#opsInternalNote").value = reservation?.internalNotes || "";
  document.querySelector("#opsFormError").textContent = "";
  fillOpsTables(reservation?.tableIds?.[0] || "");
  opsReservationDialog.showModal();
}
export function tehranClientNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}
export function roundedFloorTime() {
  const now = tehranClientNow(),
    minutes = now.minute;
  return `${String(now.hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
export async function openOperations() {
  adminDialog.close();
  applyManagerAccess();
  opsDialog.classList.toggle(
    "table-only",
    !hasManagerPermission("reservations.read") && !hasManagerPermission("waitlist.read"),
  );
  setJalaliInput(document.querySelector("#opsDate"), tehranClientNow().date);
  document.querySelector("#opsFloorTime").value = roundedFloorTime();
  document.querySelector("#opsBranch").value = store.currentBranch;
  opsDialog.showModal();
  await fetchOperations();
  clearInterval(store.opsRefreshTimer);
  store.opsRefreshTimer = setInterval(() => {
    if (opsDialog.open) fetchOperations();
  }, 45000);
}
export function exitOperations() {
  clearInterval(store.opsRefreshTimer);
  opsDialog.close();
  adminDialog.showModal();
}

export function wireOperations() {
  document.querySelector("#opsReservationForm").onsubmit = async (e) => {
    e.preventDefault();
    const code = document.querySelector("#opsTrackingCode").value,
      button = document.querySelector("#saveOperationalReservation"),
      error = document.querySelector("#opsFormError"),
      payload = {
        customerName: document.querySelector("#opsCustomerName").value,
        mobile: latinDigits(document.querySelector("#opsCustomerMobile").value),
        source: document.querySelector("#opsSource").value,
        status: document.querySelector("#opsReservationStatus").value,
        date: isoValue(document.querySelector("#opsReservationDate")),
        time: document.querySelector("#opsReservationTime").value,
        partySize: Number(document.querySelector("#opsPartySize").value),
        tableIds: [document.querySelector("#opsTableSelect").value],
        notes: document.querySelector("#opsCustomerNote").value,
        internalNotes: document.querySelector("#opsInternalNote").value,
      };
    button.disabled = true;
    error.textContent = "";
    try {
      if (!payload.date) throw new Error("تاریخ رزرو را از تقویم شمسی انتخاب کنید.");
      const response = await fetch(
          code
            ? `${operationsUrl("/reservations")}/${encodeURIComponent(code)}`
            : operationsUrl("/reservations"),
          {
            method: code ? "PATCH" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        ),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ذخیره رزرو انجام نشد");
      opsReservationDialog.close();
      await Promise.all([fetchOperations(), fetchAvailability()]);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
  document.querySelector("#waitlistForm").onsubmit = async (e) => {
    e.preventDefault();
    const error = document.querySelector("#waitFormError"),
      payload = {
        customerName: document.querySelector("#waitCustomerName").value,
        mobile: latinDigits(document.querySelector("#waitCustomerMobile").value),
        partySize: Number(document.querySelector("#waitPartySize").value),
        quotedMinutes: Number(document.querySelector("#waitQuoted").value),
        notes: document.querySelector("#waitNotes").value,
      };
    error.textContent = "";
    try {
      const response = await fetch(operationsUrl("/waitlist"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ثبت لیست انتظار انجام نشد");
      waitlistDialog.close();
      document.querySelector("#waitlistForm").reset();
      await fetchOperations();
    } catch (err) {
      error.textContent = err.message;
    }
  };
  document.querySelector("#openOperations").onclick = openOperations;
  document.querySelector("#opsExit").onclick = exitOperations;
  document.querySelector("#opsMobileExit").onclick = exitOperations;
  document.querySelector("#opsRefresh").onclick = fetchOperations;
  document.querySelector("#opsDate").onchange = fetchOperations;
  document.querySelector("#opsFloorTime").onchange = fetchOperations;
  document.querySelector("#opsFloorNow").onclick = () => {
    document.querySelector("#opsFloorTime").value = roundedFloorTime();
    fetchOperations();
  };
  document.querySelector("#opsBranch").onchange = (e) => switchBranch(e.target.value, true);
  document.querySelector("#opsSearch").oninput = renderOperationalReservations;
  document.querySelector("#opsStatusFilter").onchange = renderOperationalReservations;
  document.querySelector("#addOperationalReservation").onclick = () => openOpsReservation();
  document.querySelector("#opsAddQuick").onclick = () => openOpsReservation();
  document.querySelector("#addWaitlist").onclick = () => {
    document.querySelector("#waitFormError").textContent = "";
    waitlistDialog.showModal();
  };
}
