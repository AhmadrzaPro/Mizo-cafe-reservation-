// Loads the 3D engine (/floor3d.js, three.js) on a café's page. Its versioned URL is in
// <meta name="floor3d-src">, so it stays cache-safe and allowed by the page's script-src 'self'.
/** @type {Promise<typeof import("./engine.js").createFloor> | null} */
let pending = null;

/** @returns {Promise<typeof import("./engine.js").createFloor>} */
export function loadEngine() {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const global = /** @type {any} */ (globalThis);
    if (global.MizoFloor) return resolve(global.MizoFloor.createFloor);
    const src = document.querySelector('meta[name="floor3d-src"]')?.getAttribute("content");
    if (!src) return reject(new Error("no engine"));
    const script = document.createElement("script"),
      timer = setTimeout(() => reject(new Error("engine timeout")), 20000);
    script.src = src;
    script.onload = () => {
      clearTimeout(timer);
      if (global.MizoFloor) resolve(global.MizoFloor.createFloor);
      else reject(new Error("engine missing"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("engine failed"));
    };
    document.head.appendChild(script);
  });
  return pending;
}
