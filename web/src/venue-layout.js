// Where a room's door, full-height window and counter are. The owner picks a wall for each in the
// map editor; this module turns that choice into rectangles in map pixels (40 px = 1 m), which the
// editor, the customer's 2D map and the Virtual Cafe all draw from. Pure: no DOM.

/** @typedef {"top" | "right" | "bottom" | "left"} Side */
/** @typedef {{ door: Side, window: Side | "none", counter: Side | "none" }} VenueLayout */
/** @typedef {{ x: number, y: number, width: number, height: number, side: Side }} SideRect */

export const SIDES = /** @type {const} */ (["top", "right", "bottom", "left"]);

/**
 * A complete layout from whatever is stored. Missing or unknown values keep the layout the 2D map
 * has always drawn: door at the bottom, window on the right and counter on the left indoors;
 * no window or counter outdoors.
 * @param {any} layout
 * @param {string} [kind]
 * @returns {VenueLayout}
 */
export function normalizeLayout(layout, kind = "indoor") {
  const outdoor = kind === "outdoor",
    pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  return {
    door: pick(layout?.door, SIDES, "bottom"),
    window: pick(layout?.window, [...SIDES, "none"], outdoor ? "none" : "right"),
    counter: pick(layout?.counter, [...SIDES, "none"], outdoor ? "none" : "left"),
  };
}

const DOOR = { length: 92, depth: 28, offset: 160 },
  WINDOW_DEPTH = 34,
  COUNTER = { length: 245, depth: 88, offset: 135, gap: 24 };

/**
 * The rectangles of a room's door, window and counter, in map pixels from its top-left corner.
 * @param {{ width?: number, height?: number, kind?: string, layout?: any }} area
 */
export function venueGeometry(area) {
  const width = Number(area.width) || 820,
    height = Number(area.height) || 520,
    layout = normalizeLayout(area.layout, area.kind),
    wallLength = (/** @type {Side} */ side) =>
      side === "top" || side === "bottom" ? width : height;

  /**
   * A rectangle lying along a wall: `along` from the wall's start (left or top end), `inset` from
   * the wall itself, `length` along it and `depth` into the room.
   * @param {Side} side @param {number} along @param {number} inset
   * @param {number} length @param {number} depth @returns {SideRect}
   */
  const onWall = (side, along, inset, length, depth) =>
    side === "top"
      ? { x: along, y: inset, width: length, height: depth, side }
      : side === "bottom"
        ? { x: along, y: height - inset - depth, width: length, height: depth, side }
        : side === "left"
          ? { x: inset, y: along, width: depth, height: length, side }
          : { x: width - inset - depth, y: along, width: depth, height: length, side };

  const doorLength = Math.min(DOOR.length, wallLength(layout.door) - 20),
    door = onWall(
      layout.door,
      Math.min(DOOR.offset, wallLength(layout.door) - doorLength - 10),
      0,
      doorLength,
      DOOR.depth,
    );
  // The door wins its wall: a window on the same wall is left out.
  const window =
    layout.window === "none" || layout.window === layout.door
      ? null
      : onWall(layout.window, 0, 0, wallLength(layout.window), WINDOW_DEPTH);

  /** @type {SideRect | null} */
  let counter = null;
  if (layout.counter !== "none") {
    const side = layout.counter,
      wall = wallLength(side),
      inset = COUNTER.gap + (window && window.side === side ? WINDOW_DEPTH : 0),
      // On the door's wall the counter starts past the door, so the entrance stays clear.
      doorEnd =
        side === layout.door
          ? side === "top" || side === "bottom"
            ? door.x + door.width
            : door.y + door.height
          : 0,
      start = side === layout.door ? doorEnd + COUNTER.gap : COUNTER.offset,
      length = Math.max(0, Math.min(COUNTER.length, wall - COUNTER.gap - start)),
      along = start;
    if (length >= 80) counter = onWall(side, along, inset, length, COUNTER.depth);
  }
  return { layout, door, window, counter };
}
