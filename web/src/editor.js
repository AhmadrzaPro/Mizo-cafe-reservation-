import { renderCustomerMap, tableDialog } from "./booking.js";
import { editor } from "./dialogs.js";
import { fitMap, openTableInspector } from "./floor/editor-tools.js";
import { tableFurniture } from "./floor/furniture.js";
import {
  applyFloorViewport,
  areaBounds,
  syncAreaDimensions,
  tableInsertPosition,
  zoomEditor,
} from "./floor/zoom.js";
import { faDigits } from "./format.js";
import { cloneDefault } from "./map-defaults.js";
import { activeTables, closeImageImport } from "./map-import.js";
import { areaKindLabel, derivedSpaceMode, visibleAreas } from "./map-model.js";
import { escapeHtml } from "./operations.js";
import { markDirty, saveMap } from "./profile.js";
import { mapViewportPointers, store } from "./state.js";

export function syncSpaceModeUI() {
  store.cafeMap.spaceMode = store.cafeMap.spaceMode || derivedSpaceMode();
  document
    .querySelectorAll("[data-space-mode]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.spaceMode === store.cafeMap.spaceMode),
    );
}
export function selectArea(id) {
  if (id === store.activeArea) return;
  closeImageImport();
  store.activeArea = id;
  store.selectedId = null;
  document
    .querySelectorAll(".area-row")
    .forEach((row) => row.classList.toggle("active", row.dataset.areaId === id));
  renderMapCanvas();
  renderProperties();
  fitMap();
}
export function renderAreas() {
  const list = document.querySelector("#areaList"),
    fragment = document.createDocumentFragment();
  list.innerHTML = "";
  visibleAreas().forEach((area) => {
    const row = document.createElement("div"),
      main = document.createElement("button"),
      remove = document.createElement("button");
    row.className = "area-row" + (area.id === store.activeArea ? " active" : "");
    row.dataset.areaId = area.id;
    main.type = "button";
    main.className = "area-main";
    main.innerHTML = `<span class="area-symbol">${area.kind === "outdoor" ? "☀" : "⌂"}</span><span><b>${escapeHtml(area.name)}</b><small>${areaKindLabel(area.kind)} · ${faDigits(store.cafeMap.tables.filter((table) => table.area === area.id).length)} میز</small></span>`;
    main.onpointerdown = (event) => {
      if (event.pointerType === "touch") selectArea(area.id);
    };
    main.onclick = () => selectArea(area.id);
    remove.type = "button";
    remove.className = "area-delete";
    remove.title = `حذف ${area.name}`;
    remove.setAttribute("aria-label", `حذف ${area.name}`);
    remove.textContent = "×";
    remove.disabled = visibleAreas().length === 1;
    remove.onclick = () => removeArea(area.id);
    row.append(main, remove);
    fragment.appendChild(row);
  });
  list.appendChild(fragment);
  syncSpaceModeUI();
}
export function renderMapCanvas() {
  const canvas = document.querySelector("#mapCanvas"),
    area = store.cafeMap.areas.find((item) => item.id === store.activeArea) || visibleAreas()[0],
    fragment = document.createDocumentFragment();
  canvas.querySelectorAll(".editor-table").forEach((x) => x.remove());
  canvas.classList.toggle("outdoor", area?.kind === "outdoor");
  canvas.dataset.areaName = area?.name || "";
  canvas.style.transform = `scale(${store.zoom})`;
  canvas.classList.toggle("material-view", store.mapMaterial);
  applyFloorViewport(canvas, document.querySelector("#mapStage"), areaBounds(area), store.zoom);
  syncAreaDimensions();
  document.querySelector("#studioAreaName").textContent = area?.name || "نقشه سالن";
  document.querySelector("#studioCounts").textContent =
    `${faDigits(activeTables().length)} میز · ${faDigits(activeTables().reduce((n, t) => n + Number(t.capacity), 0))} صندلی`;
  document.querySelector("#zoomValue").textContent = `${faDigits(Math.round(store.zoom * 100))}٪`;
  activeTables().forEach((t) => {
    const el = document.createElement("button");
    el.className = `editor-table ${t.shape}${t.reservable ? "" : " off"}${t.id === store.selectedId ? " selected" : ""}`;
    el.style.left = `${t.x}px`;
    el.style.top = `${t.y}px`;
    el.dataset.id = t.id;
    el.innerHTML =
      tableFurniture(t) +
      `<span class="table-surface"><b>${escapeHtml(t.name)}</b><small>${faDigits(t.capacity)} صندلی</small></span>`;
    el.setAttribute("aria-label", `${t.name}، ${faDigits(t.capacity)} صندلی`);
    el.onclick = (event) => {
      event.stopPropagation();
      selectTable(t.id);
    };
    el.ondblclick = () => openTableInspector();
    el.onpointerdown = startDrag;
    fragment.appendChild(el);
  });
  canvas.appendChild(fragment);
  canvas.onclick = () => selectTable(null);
}
export function renderEditor() {
  renderAreas();
  renderMapCanvas();
  renderProperties();
}
export function selectTable(id) {
  store.selectedId = id;
  document
    .querySelectorAll(".editor-table")
    .forEach((el) => el.classList.toggle("selected", el.dataset.id === id));
  renderProperties();
}
export function selectedTable() {
  return store.cafeMap.tables.find((t) => t.id === store.selectedId);
}
export function renderProperties() {
  document.querySelector("#editSelectedTable").disabled = !selectedTable();
  const empty = document.querySelector(".empty-properties"),
    form = document.querySelector(".table-properties"),
    t = selectedTable();
  empty.hidden = !!t;
  form.hidden = !t;
  if (!t) return;
  document.querySelector("#tableName").value = t.name;
  document.querySelector("#capacityValue").textContent = faDigits(t.capacity);
  document.querySelector("#tableShape").value = t.shape;
  document.querySelector("#tableReservable").checked = t.reservable;
}
export function tableSize(t) {
  return t.shape === "rect" ? { w: 118, h: 70 } : { w: 76, h: 76 };
}
export function startDrag(e) {
  if (e.button !== 0 || mapViewportPointers.size > 1) return;
  e.stopPropagation();
  const el = e.currentTarget,
    t = store.cafeMap.tables.find((x) => x.id === el.dataset.id);
  if (!t) return;
  const startX = e.clientX,
    startY = e.clientY,
    originX = t.x,
    originY = t.y;
  let moved = false,
    cancelledForGesture = false;
  store.selectedId = t.id;
  document
    .querySelectorAll(".editor-table")
    .forEach((item) => item.classList.toggle("selected", item === el));
  el.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (mapViewportPointers.size > 1 || cancelledForGesture) {
      cancelledForGesture = true;
      moved = false;
      t.x = originX;
      t.y = originY;
      el.style.left = `${t.x}px`;
      el.style.top = `${t.y}px`;
      return;
    }
    const dx = ev.clientX - startX,
      dy = ev.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true;
    el.classList.add("dragging");
    const size = tableSize(t),
      bounds = areaBounds(),
      snap = (v) => (store.mapSnap ? Math.round(v / 12) * 12 : v);
    t.x = Math.max(0, Math.min(bounds.width - size.w, snap(originX + dx / store.zoom)));
    t.y = Math.max(0, Math.min(bounds.height - size.h, snap(originY + dy / store.zoom)));
    el.style.left = `${t.x}px`;
    el.style.top = `${t.y}px`;
  };
  const finish = (ev) => {
    el.classList.remove("dragging");
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", finish);
    el.removeEventListener("pointercancel", finish);
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (ev.type === "pointercancel") {
      t.x = originX;
      t.y = originY;
      el.style.left = `${t.x}px`;
      el.style.top = `${t.y}px`;
    } else if (moved) markDirty();
    renderProperties();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
}
export function addTable(shape) {
  const n = store.cafeMap.tables.length + 1,
    t = {
      id: `t${Date.now()}`,
      area: store.activeArea,
      name: `میز ${faDigits(n)}`,
      shape,
      capacity: shape === "rect" ? 6 : 2,
      ...tableInsertPosition(shape),
      reservable: true,
    };
  store.cafeMap.tables.push(t);
  store.selectedId = t.id;
  markDirty();
  renderEditor();
}
export function addArea(name, kind) {
  const clean = String(name || "").trim(),
    existing = store.cafeMap.areas.find((area) => area.name === clean);
  if (!clean) return;
  if (existing) {
    if (store.cafeMap.spaceMode !== "both" && existing.kind !== store.cafeMap.spaceMode)
      store.cafeMap.spaceMode = "both";
    store.activeArea = existing.id;
    store.selectedId = null;
    markDirty();
    renderEditor();
    return;
  }
  const id = `area-${Date.now()}`;
  store.cafeMap.areas.push({ id, name: clean, kind: kind === "outdoor" ? "outdoor" : "indoor" });
  store.cafeMap.spaceMode = derivedSpaceMode();
  store.activeArea = id;
  store.selectedId = null;
  markDirty();
  renderEditor();
}
export function removeArea(id) {
  const area = store.cafeMap.areas.find((item) => item.id === id),
    tableCount = store.cafeMap.tables.filter((table) => table.area === id).length;
  if (!area || store.cafeMap.areas.length === 1) return;
  if (
    !confirm(`بخش «${area.name}»${tableCount ? ` و ${faDigits(tableCount)} میز آن` : ""} حذف شود؟`)
  )
    return;
  store.cafeMap.areas = store.cafeMap.areas.filter((item) => item.id !== id);
  store.cafeMap.tables = store.cafeMap.tables.filter((table) => table.area !== id);
  store.cafeMap.spaceMode = derivedSpaceMode();
  if (store.activeArea === id) store.activeArea = store.cafeMap.areas[0].id;
  store.selectedId = null;
  markDirty();
  renderEditor();
}
export function setSpaceMode(mode) {
  if (!["indoor", "outdoor", "both"].includes(mode) || mode === store.cafeMap.spaceMode) return;
  if (mode === "both") {
    if (!store.cafeMap.areas.some((area) => area.kind === "indoor"))
      store.cafeMap.areas.push({ id: `area-${Date.now()}-in`, name: "سالن اصلی", kind: "indoor" });
    if (!store.cafeMap.areas.some((area) => area.kind === "outdoor"))
      store.cafeMap.areas.push({ id: `area-${Date.now()}-out`, name: "تراس", kind: "outdoor" });
  } else if (!store.cafeMap.areas.some((area) => area.kind === mode))
    store.cafeMap.areas.push({
      id: `area-${Date.now()}`,
      name: mode === "outdoor" ? "تراس" : "سالن اصلی",
      kind: mode,
    });
  store.cafeMap.spaceMode = mode;
  store.activeArea = visibleAreas()[0].id;
  store.customerArea = store.activeArea;
  store.selectedId = null;
  markDirty();
  renderEditor();
}
export const areaAddPanel = document.querySelector("#areaAddPanel"),
  areaAddToggle = document.querySelector("#areaAddToggle"),
  areaPreset = document.querySelector("#areaPreset"),
  customAreaFields = document.querySelector("#customAreaFields");
export function setAreaAddPanel(open) {
  areaAddPanel.hidden = !open;
  areaAddToggle.setAttribute("aria-expanded", String(open));
  areaAddToggle.textContent = open ? "× بستن" : "+ بخش جدید";
}
export function setMapTools(open) {
  document.querySelector(".editor-sidebar").classList.toggle("mobile-open", open);
  document.querySelector(".editor-shell").classList.toggle("tools-open", open);
}
export function changeCapacity(delta) {
  const t = selectedTable();
  if (!t) return;
  t.capacity = Math.max(1, Math.min(20, t.capacity + delta));
  markDirty();
  renderEditor();
}
export function showPublishedToast(message = "نقشه با موفقیت منتشر شد") {
  const toast = document.querySelector("#editorToast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

export function wireEditor() {
  document
    .querySelectorAll("[data-add-shape]")
    .forEach((b) => (b.onclick = () => addTable(b.dataset.addShape)));
  document
    .querySelectorAll("[data-space-mode]")
    .forEach((button) => (button.onclick = () => setSpaceMode(button.dataset.spaceMode)));
  areaAddToggle.onclick = () => setAreaAddPanel(areaAddPanel.hidden);
  areaPreset.onchange = () => {
    const custom = areaPreset.value.startsWith("custom|");
    customAreaFields.hidden = !custom;
    if (custom) document.querySelector("#customAreaName").focus();
  };
  document.querySelector("#addArea").onclick = () => {
    const [presetName, presetKind] = areaPreset.value.split("|"),
      custom = presetName === "custom",
      input = document.querySelector("#customAreaName"),
      name = custom ? input.value : presetName,
      kind = custom ? document.querySelector("#customAreaKind").value : presetKind;
    if (!String(name || "").trim()) {
      input.focus();
      return;
    }
    addArea(name, kind);
    input.value = "";
    setAreaAddPanel(false);
  };
  document.querySelector("#customAreaName").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.querySelector("#addArea").click();
    }
  };
  document.querySelector("#mapToolsToggle").onclick = () => setMapTools(true);
  document.querySelector("#closeMapTools").onclick = () => setMapTools(false);
  document.querySelector("#tableName").oninput = (e) => {
    const t = selectedTable();
    if (!t) return;
    t.name = e.target.value || "بدون نام";
    markDirty();
    renderEditor();
  };
  document.querySelector("#capacityMinus").onclick = () => changeCapacity(-1);
  document.querySelector("#capacityPlus").onclick = () => changeCapacity(1);
  document.querySelector("#tableShape").onchange = (e) => {
    const t = selectedTable();
    if (!t) return;
    t.shape = e.target.value;
    markDirty();
    renderEditor();
  };
  document.querySelector("#tableReservable").onchange = (e) => {
    const t = selectedTable();
    if (!t) return;
    t.reservable = e.target.checked;
    markDirty();
    renderEditor();
  };
  document.querySelector("#deleteTable").onclick = () => {
    store.cafeMap.tables = store.cafeMap.tables.filter((t) => t.id !== store.selectedId);
    store.selectedId = null;
    markDirty();
    renderEditor();
  };
  document.querySelector("#duplicateTable").onclick = () => {
    const t = selectedTable();
    if (!t) return;
    const copy = {
      ...t,
      id: `t${Date.now()}`,
      name: `${t.name} کپی`,
      x: Math.min(areaBounds().width - tableSize(t).w, t.x + 28),
      y: Math.min(areaBounds().height - tableSize(t).h, t.y + 28),
    };
    store.cafeMap.tables.push(copy);
    store.selectedId = copy.id;
    markDirty();
    renderEditor();
  };
  document.querySelector("#zoomIn").onclick = () => zoomEditor(store.zoom * 1.25);
  document.querySelector("#zoomOut").onclick = () => zoomEditor(store.zoom / 1.25);
  document.querySelector("#resetMap").onclick = () => {
    if (!confirm("چیدمان دمو بازنشانی شود؟")) return;
    store.cafeMap = cloneDefault();
    store.activeArea = "main";
    store.customerArea = "main";
    store.selectedId = null;
    markDirty();
    renderEditor();
  };
  document.querySelector("#publishMap").onclick = async () => {
    if (await saveMap()) {
      renderCustomerMap();
      showPublishedToast();
    }
  };
  document.querySelector("#previewMap").onclick = () => {
    store.mapPreviewMode = true;
    document.querySelector("#selectionSummary").textContent =
      "پیش‌نمایش چیدمان این شعبه · تغییرات هنوز منتشر نشده‌اند";
    document.querySelector("#confirmBtn").hidden = true;
    editor.close();
    tableDialog.showModal();
    renderCustomerMap();
  };
  tableDialog.addEventListener("close", () => {
    if (!store.mapPreviewMode) return;
    store.mapPreviewMode = false;
    document.querySelector("#confirmBtn").hidden = false;
    renderCustomerMap();
    if (!editor.open) editor.showModal();
  });
}
