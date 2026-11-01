// Loads the engine bundle on demand: a same-origin <script> added only when a customer opens the
// Virtual Cafe, so the booking page never downloads three.js on its own.
import { VIRTUAL_CAFE } from "./config.js";

/** @typedef {import("./types").VirtualCafeEngine} VirtualCafeEngine */

/** Why the Virtual Cafe could not open; `reason` names the case for the fallback and telemetry. */
export class VirtualCafeError extends Error {
  /** @param {"webgl_unavailable" | "load_failed" | "load_timeout" | "no_tables" | "runtime"} reason */
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/** Whether this browser can draw WebGL at all; checked before downloading anything. */
export function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

/** @type {Promise<VirtualCafeEngine> | null} */
let loading = null;

/**
 * The engine, loading its bundle the first time. Rejects with a VirtualCafeError when the script
 * fails or takes longer than the timeout.
 * @returns {Promise<VirtualCafeEngine>}
 */
export function loadEngine(timeoutMs = VIRTUAL_CAFE.loadTimeoutMs) {
  const ready = /** @type {any} */ (globalThis)[VIRTUAL_CAFE.globalName];
  if (ready) return Promise.resolve(ready);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const src = document
        .querySelector(`meta[name="${VIRTUAL_CAFE.scriptMeta}"]`)
        ?.getAttribute("content");
      if (!src) {
        reject(new VirtualCafeError("load_failed"));
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => {
        const engine = /** @type {any} */ (globalThis)[VIRTUAL_CAFE.globalName];
        engine ? resolve(engine) : reject(new VirtualCafeError("load_failed"));
      };
      script.onerror = () => {
        script.remove();
        reject(new VirtualCafeError("load_failed"));
      };
      document.head.append(script);
    });
    // A failed download can be retried.
    loading.catch(() => (loading = null));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new VirtualCafeError("load_timeout")), timeoutMs);
    /** @type {Promise<VirtualCafeEngine>} */ (loading).then(
      (engine) => {
        clearTimeout(timer);
        resolve(engine);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
