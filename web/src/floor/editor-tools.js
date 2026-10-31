import { editor } from "../dialogs.js";
import { byId, required } from "../dom.js";
import { renderEditor, renderMapCanvas, renderProperties, selectedTable } from "../editor.js";
import { fitFloorZoom } from "./geometry.js";
import { travelMapHistory } from "./history.js";
import { areaBounds } from "./zoom.js";
import { formatPersianDate } from "../format.js";
import { store } from "../state.js";

export function fitMap() {
  const wrap = required(".canvas-wrap"),
    bounds = areaBounds();
  store.zoom = fitFloorZoom(bounds, wrap.clientWidth, wrap.clientHeight);
  renderMapCanvas();
  wrap.scrollLeft = 0;
  wrap.scrollTop = 0;
}
export function openTableInspector() {
  if (!selectedTable()) return;
  byId("propertyPanel").classList.add("inspector-open");
  renderProperties();
}

export function wireFloorEditorTools() {
  byId("editSelectedTable").onclick = openTableInspector;
  byId("closeInspector").onclick = () => byId("propertyPanel").classList.remove("inspector-open");
  byId("fitMap").onclick = fitMap;
  byId("mapUndo").onclick = () => travelMapHistory(-1, renderEditor);
  byId("mapRedo").onclick = () => travelMapHistory(1, renderEditor);
  byId("snapMap").onclick = (event) => {
    store.mapSnap = !store.mapSnap;
    /** @type {HTMLElement} */ (event.currentTarget).setAttribute(
      "aria-pressed",
      String(store.mapSnap),
    );
  };
  byId("materialMap").onclick = (event) => {
    store.mapMaterial = !store.mapMaterial;
    /** @type {HTMLElement} */ (event.currentTarget).setAttribute(
      "aria-pressed",
      String(store.mapMaterial),
    );
    renderMapCanvas();
  };
  document.addEventListener("keydown", (event) => {
    if (
      !editor.open ||
      document.querySelector("dialog[open]:not(#mapEditorDialog)") ||
      /** @type {HTMLElement} */ (event.target).closest("input,textarea,select")
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      travelMapHistory(event.shiftKey ? 1 : -1, renderEditor);
    }
  });
  required(".dash-top span").textContent = `امروز، ${formatPersianDate(new Date())}`;
}
