import { visibleAreas } from "../map-model.js";
import { store } from "../state.js";

// DOM access goes through `root` and `render` so the history can be exercised without a browser.
export function resetMapHistory(root = document) {
  store.mapHistory = [JSON.stringify(store.cafeMap)];
  store.mapHistoryIndex = 0;
  syncHistoryButtons(root);
}
export function recordMapHistory(root = document) {
  const snapshot = JSON.stringify(store.cafeMap);
  if (store.mapHistory[store.mapHistoryIndex] === snapshot) return;
  store.mapHistory = store.mapHistory.slice(0, store.mapHistoryIndex + 1);
  store.mapHistory.push(snapshot);
  if (store.mapHistory.length > 60) store.mapHistory.shift();
  store.mapHistoryIndex = store.mapHistory.length - 1;
  syncHistoryButtons(root);
}
export function syncHistoryButtons(root = document) {
  root.querySelector("#mapUndo").disabled = store.mapHistoryIndex <= 0;
  root.querySelector("#mapRedo").disabled = store.mapHistoryIndex >= store.mapHistory.length - 1;
}
export function travelMapHistory(delta, render, root = document) {
  const index = store.mapHistoryIndex + delta;
  if (index < 0 || index >= store.mapHistory.length) return;
  store.mapHistoryIndex = index;
  store.cafeMap = JSON.parse(store.mapHistory[index]);
  if (!visibleAreas().some((a) => a.id === store.activeArea))
    store.activeArea = visibleAreas()[0]?.id;
  store.selectedId = null;
  store.dirty = true;
  root.querySelector("#saveStatus").textContent = "تغییرات منتشر نشده";
  syncHistoryButtons(root);
  render();
}
