import { store } from "./state.js";

export const areaKindLabel = (kind) => (kind === "outdoor" ? "بیرونی" : "داخلی");
export function visibleAreas() {
  const mode = store.cafeMap.spaceMode || "indoor";
  return (store.cafeMap.areas || []).filter((area) => mode === "both" || area.kind === mode);
}
export function derivedSpaceMode() {
  const kinds = new Set(store.cafeMap.areas.map((area) => area.kind));
  return kinds.size > 1 ? "both" : kinds.has("outdoor") ? "outdoor" : "indoor";
}
