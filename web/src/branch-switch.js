// Switching the page to another branch of the café: its floor, settings and availability.
import { fetchOperations } from "./operations.js";
import { applyCafeProfile, fetchSettings, syncBranchSelectors } from "./profile.js";
import { loadFloor, refreshFloor } from "./floor3d/view.js";
import { state, store } from "./state.js";

/** @param {string} slug @param {boolean} [includeOperations] */
export async function switchBranch(slug, includeOperations = false) {
  store.currentBranch = slug;
  state.time = "";
  syncBranchSelectors();
  applyCafeProfile(store.cafeProfile);
  await Promise.all([
    loadFloor(),
    fetchSettings(),
    includeOperations ? fetchOperations() : Promise.resolve(),
  ]);
  await refreshFloor();
  return true;
}

export function wireBranchSwitch() {
  const control = /** @type {HTMLSelectElement} */ (document.getElementById("controlBranch")),
    floor = /** @type {HTMLSelectElement} */ (document.getElementById("floorBranch"));
  control.onchange = () => switchBranch(control.value);
  floor.onchange = () => switchBranch(floor.value);
}
