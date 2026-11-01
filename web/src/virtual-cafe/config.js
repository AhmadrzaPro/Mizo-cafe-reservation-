// Fixed settings of the Virtual Cafe module.
export const VIRTUAL_CAFE = {
  /** The engine bundle. Its versioned URL comes from <meta name="virtual-cafe-src">. */
  scriptMeta: "virtual-cafe-src",
  /** The global the engine bundle registers itself on. */
  globalName: "MizoVirtualCafeEngine",
  /** Give up loading the engine after this long and offer standard booking. */
  loadTimeoutMs: 20000,
  /** The map's scale: 40 pixels of the 2D floor map are one metre. */
  pxPerMeter: 40,
  /** A table within this distance of the window wall is "by the window". */
  windowReachMeters: 1.6,
};
