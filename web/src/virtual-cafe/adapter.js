// The booking adapter: the only part of the Virtual Cafe that talks to the existing booking flow.
// Availability always comes from the backend through fetchAvailability(); booking goes through the
// same chooseTable()/continueWithTable() steps as the 2D map, so the backend validates it again.
import { chooseTable, continueWithTable, fetchAvailability } from "../booking.js";
import { state, store } from "../state.js";
import { belongsToBranch, branchIdOf, buildVirtualScene } from "./scene-model.js";

/** @typedef {import("./types").VirtualTableState} VirtualTableState */
/** @typedef {import("./types").VirtualScene} VirtualScene */

/** The branch the page is showing. */
export function currentBranch() {
  return {
    cafeSlug: store.currentCafeSlug,
    branchSlug: store.currentBranch,
    branchId: branchIdOf(store.currentCafeSlug, store.currentBranch),
  };
}

/** The 3D scene of the current branch, built from its published floor map. */
export function virtualScene() {
  return buildVirtualScene(store.cafeMap, currentBranch());
}

/**
 * Each table's state for the chosen date, time and party size, from the latest availability the
 * page fetched. UNKNOWN when no time is chosen or availability could not be read.
 * @param {VirtualScene} scene
 * @returns {Map<string, VirtualTableState>}
 */
export function tableStates(scene) {
  const known = Boolean(state.availability && state.time),
    states = new Map();
  for (const area of scene.areas)
    for (const table of area.tables)
      states.set(
        table.tableId,
        !known
          ? "UNKNOWN"
          : state.availableTableIds.has(table.tableId)
            ? "AVAILABLE"
            : "UNAVAILABLE",
      );
  return states;
}

/** Reads availability for the chosen date, time and party size from the backend again. */
export async function refreshAvailability() {
  await fetchAvailability();
}

/**
 * Reads availability from the backend again and returns the table's state now. A table of another
 * branch is UNKNOWN: it is never shown or booked from this scene.
 * @param {string} tableId
 * @returns {Promise<VirtualTableState>}
 */
export async function getTableAvailability(tableId) {
  if (!belongsToBranch(tableId, currentBranch().branchId)) return "UNKNOWN";
  await fetchAvailability();
  if (!state.availability || !state.time) return "UNKNOWN";
  return state.availableTableIds.has(tableId) ? "AVAILABLE" : "UNAVAILABLE";
}

/**
 * Hands the table to the existing booking flow: the same step as choosing it on the 2D map and
 * confirming. Returns false, changing nothing, when the table is not free right now. The backend
 * checks again when the customer submits, and refuses a table someone else took meanwhile.
 * @param {import("./types").VirtualTable} table
 * @param {() => void} [beforeHandoff] Runs just before the booking dialog opens.
 */
export async function startBooking(table, beforeHandoff) {
  if ((await getTableAvailability(table.tableId)) !== "AVAILABLE") return false;
  beforeHandoff?.();
  chooseTable(table.tableId, table.label);
  continueWithTable();
  return true;
}
