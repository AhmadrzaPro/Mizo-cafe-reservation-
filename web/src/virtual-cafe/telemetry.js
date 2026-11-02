// Vendor-neutral analytics hooks. Each event is dispatched on window as "mizo:telemetry"; an
// analytics script, if one is ever added, listens there. Events carry ids only, never personal data.

/**
 * @typedef {"virtual_cafe_opened" | "virtual_cafe_loaded" | "virtual_cafe_load_failed"
 *   | "virtual_table_selected" | "virtual_table_unavailable" | "virtual_booking_started"
 *   | "virtual_cafe_exited"} VirtualCafeEvent
 */

/** @param {VirtualCafeEvent} name @param {Record<string, string | number | boolean>} [detail] */
export function track(name, detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent("mizo:telemetry", { detail: { name, ...detail } }));
  } catch {
    // Telemetry never affects the visitor.
  }
}
