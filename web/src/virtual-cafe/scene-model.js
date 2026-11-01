// Builds the Virtual Cafe scene from the branch's published floor map, the same map the 2D page
// draws. Pure: no DOM, no three.js, so it runs in unit tests. Every virtual table is a real table,
// identified by its full id; nothing here decides availability.
import { venueGeometry } from "../venue-layout.js";
import { VIRTUAL_CAFE } from "./config.js";

/** @typedef {import("./types").VirtualTable} VirtualTable */
/** @typedef {import("./types").VirtualArea} VirtualArea */
/** @typedef {import("./types").VirtualScene} VirtualScene */

const px = (value) => Number(value) / VIRTUAL_CAFE.pxPerMeter;
// Footprints of the 2D map's tables (web/src/editor.js, tableSize), in pixels.
const footprint = (shape) => (shape === "rect" ? { w: 118, h: 70 } : { w: 76, h: 76 });

/** The branch id the backend uses: `branch:<cafeSlug>:<branchSlug>`. */
export const branchIdOf = (cafeSlug, branchSlug) => `branch:${cafeSlug}:${branchSlug}`;

/** The full id of a table on the branch's map. */
export const fullTableId = (branchId, localId) => `${branchId}:${localId}`;

/** Whether a full table id belongs to this branch; tables never cross branches. */
export const belongsToBranch = (tableId, branchId) =>
  typeof tableId === "string" &&
  tableId.startsWith(`${branchId}:`) &&
  tableId.length > branchId.length + 1 &&
  !tableId.slice(branchId.length + 1).includes(":");

/**
 * @param {{ spaceMode?: string, areas?: any[], tables?: any[] }} map The published map, as
 *   GET …/map returns it and the page keeps in store.cafeMap.
 * @param {{ cafeSlug: string, branchSlug: string }} branch
 * @returns {VirtualScene}
 */
export function buildVirtualScene(map, { cafeSlug, branchSlug }) {
  const branchId = branchIdOf(cafeSlug, branchSlug),
    mode = map.spaceMode || "indoor",
    areas = (map.areas || []).filter((area) => mode === "both" || area.kind === mode);
  return {
    branchId,
    areas: areas.map((area) => buildArea(area, map.tables || [], branchId)),
  };
}

/** @returns {VirtualArea} */
function buildArea(area, tables, branchId) {
  const kind = area.kind === "outdoor" ? "outdoor" : "indoor",
    width = Math.max(5, px(area.width || 820)),
    depth = Math.max(5, px(area.height || 520)),
    // Map pixels are measured from the top-left corner; the scene is centred on the area.
    toX = (value) => px(value) - width / 2,
    toZ = (value) => px(value) - depth / 2,
    // Door, window and counter where the owner put them (the same geometry as the 2D maps).
    venue = venueGeometry(area),
    door = venue.door,
    along = door.side === "top" || door.side === "bottom" ? door.width : door.height,
    /** @param {{ x: number, y: number, width: number, height: number }} rect */
    box = (rect) => ({
      x: toX(rect.x + rect.width / 2),
      z: toZ(rect.y + rect.height / 2),
      width: px(rect.width),
      depth: px(rect.height),
    }),
    // Distance from a table's edge to the window wall, in metres.
    toWindow = (centreX, centreZ, half) => {
      const side = venue.window?.side;
      if (!side) return Infinity;
      if (side === "right") return width / 2 - (centreX + half.x);
      if (side === "left") return centreX - half.x + width / 2;
      if (side === "bottom") return depth / 2 - (centreZ + half.z);
      return centreZ - half.z + depth / 2;
    };
  return {
    id: String(area.id),
    name: String(area.name || ""),
    kind,
    width,
    depth,
    counter: venue.counter ? box(venue.counter) : null,
    // The door's centre on its wall.
    entrance: {
      side: door.side,
      width: px(along),
      x: door.side === "left" ? -width / 2 : door.side === "right" ? width / 2 : box(door).x,
      z: door.side === "top" ? -depth / 2 : door.side === "bottom" ? depth / 2 : box(door).z,
    },
    windowSide: venue.window?.side || null,
    tables: tables
      .filter((table) => table.area === area.id)
      .map((table) => {
        const size = footprint(table.shape),
          centreX = toX(Number(table.x) + size.w / 2),
          centreZ = toZ(Number(table.y) + size.h / 2);
        return /** @type {VirtualTable} */ ({
          tableId: fullTableId(branchId, table.id),
          branchId,
          areaId: String(area.id),
          label: `${table.name}، ${area.name || "فضای کافه"}`,
          name: String(table.name),
          areaName: String(area.name || ""),
          capacity: Math.max(1, Number(table.capacity) || 1),
          shape: ["round", "square", "rect"].includes(table.shape) ? table.shape : "round",
          position: { x: centreX, y: 0, z: centreZ },
          rotation: 0,
          size: { width: px(size.w), depth: px(size.h) },
          reservable: table.reservable !== false,
          nearWindow:
            toWindow(centreX, centreZ, { x: px(size.w) / 2, z: px(size.h) / 2 }) <=
            VIRTUAL_CAFE.windowReachMeters,
        });
      }),
  };
}
