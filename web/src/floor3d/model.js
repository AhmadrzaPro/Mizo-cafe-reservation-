// The 3D floor's data rules, without three.js: table types, zones, overlaps and the layout the
// server stores (worker/src/map.js keeps the same lists). Pure, so unit tests can import it.

/** @typedef {{ w: number, d: number, terrace: number }} Room */
/**
 * @typedef {object} FloorItem
 * @property {"table" | "decor"} kind
 * @property {string} type
 * @property {number} x
 * @property {number} z
 * @property {number} rot
 * @property {string} [id]
 * @property {string} [name]
 * @property {string[]} [tags]
 * @property {boolean} [reservable]
 * @property {string} [operationalStatus]
 * @property {number} [w] VIP area only
 * @property {number} [d] VIP area only
 */
/** @typedef {{ room: Room, items: FloorItem[] }} FloorLayout */

/** @type {Record<string, { seats: number, label: string, r: number }>} */
export const TYPES = {
  round2: { seats: 2, label: "گرد ۲ نفره", r: 1.35 },
  round4: { seats: 4, label: "گرد ۴ نفره", r: 1.7 },
  square4: { seats: 4, label: "مربع ۴ نفره", r: 1.6 },
  long6: { seats: 6, label: "بلند ۶ نفره", r: 2.0 },
  booth4: { seats: 4, label: "مبل ۴ نفره", r: 1.7 },
  booth6: { seats: 6, label: "مبل ۶ نفره", r: 2.0 },
};
/** @type {Record<string, string>} */
export const DECOR = { bar: "بار", plant: "گلدان", vip: "محدوده VIP" };
export const TAGS = [
  "کنار پنجره",
  "دنج",
  "مناسب جمع",
  "نزدیک بار",
  "مبل راحتی",
  "فضای خصوصی",
  "مناسب تولد",
  "سیگار آزاد",
  "سایبان",
];
/** @type {Record<string, string>} */
export const ZONES = { hall: "سالن اصلی", vip: "VIP", terrace: "تراس" };
export const ROOM_LIMITS = { w: [8, 40], d: [6, 30], terrace: [0, 12] };

/** @param {FloorItem} item */
export const seatsOf = (item) => TYPES[item.type]?.seats || 0;
/** @param {FloorLayout} layout */
export const tablesOf = (layout) => layout.items.filter((item) => item.kind === "table");

/**
 * The zone a table is in, from where it stands: on the terrace, inside a VIP area, or the hall.
 * @param {FloorLayout} layout @param {FloorItem} item
 */
export function zoneOf(layout, item) {
  const { d, terrace } = layout.room;
  if (terrace > 0 && item.z > d / 2) return "terrace";
  for (const v of layout.items)
    if (v.kind === "decor" && v.type === "vip") {
      const turned = Math.round(v.rot / 90) % 2 !== 0,
        sw = turned ? v.d || 6 : v.w || 6,
        sd = turned ? v.w || 6 : v.d || 6;
      if (Math.abs(item.x - v.x) < sw / 2 && Math.abs(item.z - v.z) < sd / 2) return "vip";
    }
  return "hall";
}

/** Whether a table stands too close to another. @param {FloorLayout} layout @param {FloorItem} t */
export function overlaps(layout, t) {
  const r1 = (TYPES[t.type]?.r || 1.5) * 0.85;
  return tablesOf(layout).some(
    (o) => o !== t && Math.hypot(o.x - t.x, o.z - t.z) < r1 + (TYPES[o.type]?.r || 1.5) * 0.85,
  );
}

/** Snaps to a quarter metre. @param {number} v */
export const snap = (v) => Math.round(v * 4) / 4;

/** Keeps an item inside the room and its terrace. @param {FloorLayout} layout @param {FloorItem} it */
export function clampPos(layout, it) {
  const { w, d, terrace } = layout.room,
    m = it.kind === "decor" && it.type === "vip" ? Math.min(it.w || 6, it.d || 6) / 2 : 0.9;
  it.x = Math.max(-w / 2 + m, Math.min(w / 2 - m, it.x));
  it.z = Math.max(-d / 2 + m, Math.min(d / 2 + terrace - m, it.z));
}

/** The next free table label with a prefix, such as T6. @param {FloorLayout} layout */
export function nextName(layout, prefix = "T") {
  const names = new Set(tablesOf(layout).map((t) => t.name));
  let n = 1;
  while (names.has(prefix + n)) n++;
  return prefix + n;
}
/** A new table's stable id; its label is separate and can change. */
export const newTableId = () => `t${Math.random().toString(36).slice(2, 10)}`;

/**
 * Whether a table suits a party: enough seats, not more than three spare, in the chosen zone.
 * @param {FloorLayout} layout @param {FloorItem} t @param {number} party @param {string} zone
 */
export function fits(layout, t, party, zone = "all") {
  const seats = seatsOf(t);
  return seats >= party && seats <= party + 3 && (zone === "all" || zoneOf(layout, t) === zone);
}

/**
 * The layout as the server stores it: plain data, without anything the scene added.
 * @param {FloorLayout} layout
 * @returns {FloorLayout}
 */
export function exportLayout(layout) {
  return {
    room: { ...layout.room },
    items: layout.items.map((it) =>
      it.kind === "table"
        ? {
            kind: "table",
            id: it.id,
            name: it.name,
            type: it.type,
            x: it.x,
            z: it.z,
            rot: it.rot || 0,
            tags: [...(it.tags || [])],
            reservable: it.reservable !== false,
          }
        : {
            kind: "decor",
            type: it.type,
            x: it.x,
            z: it.z,
            rot: it.rot || 0,
            ...(it.type === "vip" ? { w: it.w, d: it.d } : {}),
          },
    ),
  };
}
