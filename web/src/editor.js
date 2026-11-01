import { renderCustomerMap, tableDialog } from "./booking.js";
import { editor } from "./dialogs.js";
import { byId, html, setHtml, required } from "./dom.js";
import { fitMap, openTableInspector } from "./floor/editor-tools.js";
import { placeVenueFeatures } from "./floor/venue-features.js";
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
import { markDirty, saveMap } from "./profile.js";
import { mapViewportPointers, store } from "./state.js";

export function syncSpaceModeUI() {
  store.cafeMap.spaceMode = store.cafeMap.spaceMode || derivedSpaceMode();
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-space-mode]")).forEach(
    (button) =>
      button.classList.toggle("active", button.dataset.spaceMode === store.cafeMap.spaceMode),
  );
}
export function selectArea(id) {
  if (id === store.activeArea) return;
  closeImageImport();
  store.activeArea = id;
  store.selectedId = null;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".area-row")).forEach((row) =>
    row.classList.toggle("active", row.dataset.areaId === id),
  );
  renderMapCanvas();
  renderProperties();
  fitMap();
}
export function renderAreas() {
  const list = byId("areaList"),
    fragment = document.createDocumentFragment();
  list.replaceChildren();
  visibleAreas().forEach((area) => {
    const row = document.createElement("div"),
      main = document.createElement("button"),
      remove = document.createElement("button");
    row.className = "area-row" + (area.id === store.activeArea ? " active" : "");
    row.dataset.areaId = area.id;
    main.type = "button";
    main.className = "area-main";
    setHtml(
      main,
      html`<span class="area-symbol">${area.kind === "outdoor" ? "☀" : "⌂"}</span
        ><span
          ><b>${area.name}</b
          ><small
            >${areaKindLabel(area.kind)} ·
            ${faDigits(store.cafeMap.tables.filter((table) => table.area === area.id).length)}
            میز</small
          ></span
        >`,
    );
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
  const canvas = byId("mapCanvas"),
    area = store.cafeMap.areas.find((item) => item.id === store.activeArea) || visibleAreas()[0],
    fragment = document.createDocumentFragment();
  canvas.querySelectorAll(".editor-table").forEach((x) => x.remove());
  canvas.classList.toggle("outdoor", area?.kind === "outdoor");
  if (area) placeVenueFeatures(canvas, area);
  canvas.dataset.areaName = area?.name || "";
  canvas.style.transform = `scale(${store.zoom})`;
  canvas.classList.toggle("material-view", store.mapMaterial);
  applyFloorViewport(canvas, byId("mapStage"), areaBounds(area), store.zoom);
  syncAreaDimensions();
  byId("studioAreaName").textContent = area?.name || "نقشه سالن";
  byId("studioCounts").textContent =
    `${faDigits(activeTables().length)} میز · ${faDigits(activeTables().reduce((n, t) => n + Number(t.capacity), 0))} صندلی`;
  byId("zoomValue").textContent = `${faDigits(Math.round(store.zoom * 100))}٪`;
  activeTables().forEach((t) => {
    const el = document.createElement("button");
    el.className = `editor-table ${t.shape}${t.reservable ? "" : " off"}${t.id === store.selectedId ? " selected" : ""}`;
    el.style.left = `${t.x}px`;
    el.style.top = `${t.y}px`;
    el.dataset.id = t.id;
    setHtml(
      el,
      html`${tableFurniture(t)}<span class="table-surface"
          ><b>${t.name}</b><small>${faDigits(t.capacity)} صندلی</small></span
        >`,
    );
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
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".editor-table")).forEach(
    (el) => el.classList.toggle("selected", el.dataset.id === id),
  );
  renderProperties();
}
export function selectedTable() {
  return store.cafeMap.tables.find((t) => t.id === store.selectedId);
}
export function renderProperties() {
  byId("editSelectedTable").disabled = !selectedTable();
  const empty = /** @type {HTMLElement} */ (document.querySelector(".empty-properties")),
    form = /** @type {HTMLElement} */ (document.querySelector(".table-properties")),
    t = selectedTable();
  empty.hidden = !!t;
  form.hidden = !t;
  if (!t) return;
  byId("tableName").value = t.name;
  byId("capacityValue").textContent = faDigits(t.capacity);
  byId("tableShape").value = t.shape;
  byId("tableReservable").checked = t.reservable;
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
export const areaAddPanel = byId("areaAddPanel"),
  areaAddToggle = byId("areaAddToggle"),
  areaPreset = byId("areaPreset"),
  customAreaFields = byId("customAreaFields");
export function setAreaAddPanel(open) {
  areaAddPanel.hidden = !open;
  areaAddToggle.setAttribute("aria-expanded", String(open));
  areaAddToggle.textContent = open ? "× بستن" : "+ بخش جدید";
}
export function setMapTools(open) {
  required(".editor-sidebar").classList.toggle("mobile-open", open);
  required(".editor-shell").classList.toggle("tools-open", open);
}
export function changeCapacity(delta) {
  const t = selectedTable();
  if (!t) return;
  t.capacity = Math.max(1, Math.min(20, t.capacity + delta));
  markDirty();
  renderEditor();
}
export function showPublishedToast(message = "نقشه با موفقیت منتشر شد") {
  const toast = byId("editorToast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

export function wireEditor() {
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-add-shape]")).forEach(
    (b) => (b.onclick = () => addTable(b.dataset.addShape)),
  );
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-space-mode]")).forEach(
    (button) => (button.onclick = () => setSpaceMode(button.dataset.spaceMode)),
  );
  areaAddToggle.onclick = () => setAreaAddPanel(areaAddPanel.hidden);
  areaPreset.onchange = () => {
    const custom = areaPreset.value.startsWith("custom|");
    customAreaFields.hidden = !custom;
    if (custom) byId("customAreaName").focus();
  };
  byId("addArea").onclick = () => {
    const [presetName, presetKind] = areaPreset.value.split("|"),
      custom = presetName === "custom",
      input = byId("customAreaName"),
      name = custom ? input.value : presetName,
      kind = custom ? byId("customAreaKind").value : presetKind;
    if (!String(name || "").trim()) {
      input.focus();
      return;
    }
    addArea(name, kind);
    input.value = "";
    setAreaAddPanel(false);
  };
  byId("customAreaName").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      byId("addArea").click();
    }
  };
  byId("mapToolsToggle").onclick = () => setMapTools(true);
  byId("closeMapTools").onclick = () => setMapTools(false);
  byId("tableName").oninput = (e) => {
    const t = selectedTable();
    if (!t) return;
    t.name = /** @type {HTMLInputElement} */ (e.target).value || "بدون نام";
    markDirty();
    renderEditor();
  };
  byId("capacityMinus").onclick = () => changeCapacity(-1);
  byId("capacityPlus").onclick = () => changeCapacity(1);
  byId("tableShape").onchange = (e) => {
    const t = selectedTable();
    if (!t) return;
    t.shape = /** @type {HTMLSelectElement} */ (e.target).value;
    markDirty();
    renderEditor();
  };
  byId("tableReservable").onchange = (e) => {
    const t = selectedTable();
    if (!t) return;
    t.reservable = /** @type {HTMLInputElement} */ (e.target).checked;
    markDirty();
    renderEditor();
  };
  byId("deleteTable").onclick = () => {
    store.cafeMap.tables = store.cafeMap.tables.filter((t) => t.id !== store.selectedId);
    store.selectedId = null;
    markDirty();
    renderEditor();
  };
  byId("duplicateTable").onclick = () => {
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
  byId("zoomIn").onclick = () => zoomEditor(store.zoom * 1.25);
  byId("zoomOut").onclick = () => zoomEditor(store.zoom / 1.25);
  byId("resetMap").onclick = () => {
    if (!confirm("چیدمان این بخش به حالت پیش‌فرض برگردد؟")) return;
    store.cafeMap = cloneDefault();
    store.activeArea = "main";
    store.customerArea = "main";
    store.selectedId = null;
    markDirty();
    renderEditor();
  };
  byId("publishMap").onclick = async () => {
    if (await saveMap()) {
      renderCustomerMap();
      showPublishedToast();
    }
  };
  byId("previewMap").onclick = () => {
    store.mapPreviewMode = true;
    byId("selectionSummary").textContent =
      "پیش‌نمایش چیدمان این شعبه · تغییرات هنوز منتشر نشده‌اند";
    byId("confirmBtn").hidden = true;
    editor.close();
    tableDialog.showModal();
    renderCustomerMap();
  };
  tableDialog.addEventListener("close", () => {
    if (!store.mapPreviewMode) return;
    store.mapPreviewMode = false;
    byId("confirmBtn").hidden = false;
    renderCustomerMap();
    if (!editor.open) editor.showModal();
  });
}
