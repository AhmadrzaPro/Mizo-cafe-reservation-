import { editor } from "../dialogs.js";
import { renderEditor, renderMapCanvas, renderProperties, selectedTable } from "../editor.js";
import { fitFloorZoom } from "./geometry.js";
import { travelMapHistory } from "./history.js";
import { areaBounds } from "./zoom.js";
import { formatPersianDate } from "../format.js";
import { store } from "../state.js";

export function fitMap() {
  const wrap = document.querySelector(".canvas-wrap"),
    bounds = areaBounds();
  store.zoom = fitFloorZoom(bounds, wrap.clientWidth, wrap.clientHeight);
  renderMapCanvas();
  wrap.scrollLeft = 0;
  wrap.scrollTop = 0;
}
export function openTableInspector() {
  if (!selectedTable()) return;
  document.querySelector("#propertyPanel").classList.add("inspector-open");
  renderProperties();
}

export function wireFloorEditorTools() {
  document.querySelector("#editSelectedTable").onclick = openTableInspector;
  document.querySelector("#closeInspector").onclick = () =>
    document.querySelector("#propertyPanel").classList.remove("inspector-open");
  document.querySelector("#fitMap").onclick = fitMap;
  document.querySelector("#mapUndo").onclick = () => travelMapHistory(-1, renderEditor);
  document.querySelector("#mapRedo").onclick = () => travelMapHistory(1, renderEditor);
  document.querySelector("#snapMap").onclick = (event) => {
    store.mapSnap = !store.mapSnap;
    event.currentTarget.setAttribute("aria-pressed", String(store.mapSnap));
  };
  document.querySelector("#materialMap").onclick = (event) => {
    store.mapMaterial = !store.mapMaterial;
    event.currentTarget.setAttribute("aria-pressed", String(store.mapMaterial));
    renderMapCanvas();
  };
  document.addEventListener("keydown", (event) => {
    if (
      !editor.open ||
      document.querySelector("dialog[open]:not(#mapEditorDialog)") ||
      event.target.closest("input,textarea,select")
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      travelMapHistory(event.shiftKey ? 1 : -1, renderEditor);
    }
  });
  document.querySelector(".dash-top span").textContent = `امروز، ${formatPersianDate(new Date())}`;
}
