import { renderEditor, tableSize } from "../editor.js";
import { fitMap } from "./editor-tools.js";
import { fitFloorZoom } from "./geometry.js";
import { setupFloorGestures } from "./gestures.js";
import { faDigits, latinDigits } from "../format.js";
import { activeTables } from "../map-import.js";
import { markDirty } from "../profile.js";
import { store } from "../state.js";

// Geometry uses 40 coordinate units per metre. Existing maps retain 820 × 520.
export function areaBounds(area = store.cafeMap.areas.find((a) => a.id === store.activeArea)) {
  return { width: Number(area?.width) || 820, height: Number(area?.height) || 520 };
}
export function applyFloorViewport(canvas, stage, bounds, scale) {
  canvas.style.width = `${bounds.width}px`;
  canvas.style.height = `${bounds.height}px`;
  canvas.style.minWidth = "0";
  canvas.style.maxWidth = "none";
  canvas.style.transform = `scale(${scale})`;
  stage.style.width = `${bounds.width * scale}px`;
  stage.style.height = `${bounds.height * scale}px`;
  canvas.classList.toggle("floor-overview", scale < 0.45);
}
export function syncAreaDimensions() {
  const bounds = areaBounds();
  document.querySelector("#areaWidth").value = bounds.width / 40;
  document.querySelector("#areaHeight").value = bounds.height / 40;
  document.querySelector("#studioCounts").dataset.dimensions =
    `${bounds.width / 40} × ${bounds.height / 40} متر`;
}
export function resizeArea(width, height) {
  const area = store.cafeMap.areas.find((a) => a.id === store.activeArea);
  if (!area) return "فضا پیدا نشد.";
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 200 ||
    height < 200 ||
    width > 4000 ||
    height > 4000
  )
    return "عرض و طول باید بین ۵ تا ۱۰۰ متر باشند.";
  if (
    activeTables().some((t) => {
      const size = tableSize(t);
      return t.x + size.w > width || t.y + size.h > height;
    })
  )
    return "این اندازه بعضی میزها را خارج از فضا قرار می‌دهد؛ ابتدا میزها را جابه‌جا کنید.";
  area.width = width;
  area.height = height;
  markDirty();
  renderEditor();
  fitMap();
  return "";
}
export function tableInsertPosition(shape) {
  const wrap = document.querySelector(".canvas-wrap"),
    canvas = document.querySelector("#mapCanvas"),
    rect = canvas.getBoundingClientRect(),
    view = wrap.getBoundingClientRect(),
    bounds = areaBounds(),
    size = tableSize({ shape });
  return {
    x: Math.max(
      0,
      Math.min(
        bounds.width - size.w,
        Math.round((view.left + wrap.clientWidth / 2 - rect.left) / store.zoom - size.w / 2),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        bounds.height - size.h,
        Math.round((view.top + wrap.clientHeight / 2 - rect.top) / store.zoom - size.h / 2),
      ),
    ),
  };
}
export function zoomFloorAt(wrap, canvas, scale, previous, apply, point) {
  const view = wrap.getBoundingClientRect(),
    clientX = point?.x ?? view.left + wrap.clientWidth / 2,
    clientY = point?.y ?? view.top + wrap.clientHeight / 2,
    rect = canvas.getBoundingClientRect(),
    worldX = (clientX - rect.left) / previous,
    worldY = (clientY - rect.top) / previous;
  apply(Math.max(0.02, Math.min(2, scale)));
  const next = canvas.getBoundingClientRect(),
    actual = Number(canvas.dataset.zoom) || scale;
  wrap.scrollLeft += next.left + worldX * actual - clientX;
  wrap.scrollTop += next.top + worldY * actual - clientY;
}
export function zoomEditor(value, point) {
  const wrap = document.querySelector(".canvas-wrap"),
    canvas = document.querySelector("#mapCanvas");
  zoomFloorAt(
    wrap,
    canvas,
    value,
    store.zoom,
    (scale) => {
      store.zoom = scale;
      canvas.dataset.zoom = scale;
      applyFloorViewport(canvas, document.querySelector("#mapStage"), areaBounds(), scale);
      document.querySelector("#zoomValue").textContent = `${faDigits(Math.round(scale * 100))}٪`;
    },
    point,
  );
}
export function navigationFloor(kind) {
  return kind === "customer"
    ? {
        wrap: document.querySelector("#customerMapViewport"),
        canvas: document.querySelector("#customerFloorPlan"),
        stage: document.querySelector("#customerMapStage"),
        bounds: areaBounds(store.cafeMap.areas.find((a) => a.id === store.customerArea)),
        zoom: store.customerMapZoom,
      }
    : {
        wrap: document.querySelector("#opsMapViewport"),
        canvas: document.querySelector("#opsFloor"),
        stage: document.querySelector("#opsMapStage"),
        bounds: areaBounds({
          width: store.opsData?.tables.find((t) => t.areaId === store.opsAreaId)?.areaWidth,
          height: store.opsData?.tables.find((t) => t.areaId === store.opsAreaId)?.areaHeight,
        }),
        zoom: store.opsMapZoom,
      };
}
export function zoomNavigationFloor(kind, value, point) {
  const v = navigationFloor(kind);
  zoomFloorAt(
    v.wrap,
    v.canvas,
    value,
    v.zoom,
    (scale) => {
      if (kind === "customer") store.customerMapZoom = scale;
      else store.opsMapZoom = scale;
      v.canvas.dataset.zoom = scale;
      applyFloorViewport(v.canvas, v.stage, v.bounds, scale);
    },
    point,
  );
}

export function wireFloorZoom() {
  document.querySelector("#areaSizeToggle").onclick = (event) => {
    const panel = document.querySelector("#areaSizePanel");
    panel.hidden = !panel.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!panel.hidden));
    syncAreaDimensions();
    document.querySelector("#areaSizeError").textContent = "";
  };
  document.querySelector("#applyAreaSize").onclick = () => {
    const width = Math.round(Number(latinDigits(document.querySelector("#areaWidth").value)) * 40),
      height = Math.round(Number(latinDigits(document.querySelector("#areaHeight").value)) * 40);
    document.querySelector("#areaSizeError").textContent = resizeArea(width, height);
  };
  setupFloorGestures(
    document.querySelector(".canvas-wrap"),
    document.querySelector("#mapCanvas"),
    () => store.zoom,
    zoomEditor,
    true,
  );
  for (const kind of ["customer", "ops"]) {
    const v = navigationFloor(kind);
    setupFloorGestures(
      v.wrap,
      v.canvas,
      () => (kind === "customer" ? store.customerMapZoom : store.opsMapZoom),
      (value, point) => zoomNavigationFloor(kind, value, point),
    );
    document.querySelector(`[data-floor-controls="${kind}"]`).onclick = (event) => {
      const action = event.target.closest("[data-zoom]")?.dataset.zoom;
      if (!action) return;
      const view = navigationFloor(kind);
      zoomNavigationFloor(
        kind,
        action === "fit"
          ? fitFloorZoom(view.bounds, view.wrap.clientWidth, view.wrap.clientHeight)
          : view.zoom * (action === "in" ? 1.25 : 0.8),
      );
      if (action === "fit") {
        view.wrap.scrollLeft = 0;
        view.wrap.scrollTop = 0;
      }
    };
  }
}
