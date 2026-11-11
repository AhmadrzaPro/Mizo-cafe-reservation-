// A branch's floor: one room in metres, with an optional terrace, tables and decor, drawn in 3D
// on the booking page. Tables live in cafe_tables (their ids are what availability, holds and
// reservations use); the room and the decor live as JSON in the branch's single area row.
import { branchRow } from "./branches.js";
import { reply } from "./http.js";
import { idPart } from "./util/ids.js";

/** Table types and their seats; the same list as web/src/floor3d/model.js. */
export const TABLE_TYPES = { round2: 2, round4: 4, square4: 4, long6: 6, booth4: 4, booth6: 6 };
const DECOR_TYPES = ["bar", "plant", "vip"];
/** Features the owner can give a table; customers see them. */
export const TABLE_TAGS = [
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
const ROOM_LIMITS = { w: [8, 40], d: [6, 30], terrace: [0, 12] };
const LIMITS = { tables: 200, decor: 60 };
/** Pixels per metre in the old 2D maps, and in the area row's width and height. */
const PX = 40;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const quarter = (value) => Math.round(value * 4) / 4;

/** @param {any} room */
function normalizeRoom(room) {
  /** @param {"w" | "d" | "terrace"} key @param {number} fallback */
  const side = (key, fallback) =>
    clamp(Math.round(num(room?.[key], fallback)), ROOM_LIMITS[key][0], ROOM_LIMITS[key][1]);
  return { w: side("w", 18), d: side("d", 12), terrace: side("terrace", 0) };
}
/** Keeps a position inside the room and its terrace. */
function inside(room, x, z, margin = 0.9) {
  return {
    x: quarter(clamp(num(x), -room.w / 2 + margin, room.w / 2 - margin)),
    z: quarter(clamp(num(z), -room.d / 2 + margin, room.d / 2 + room.terrace - margin)),
  };
}
const rotation = (value) => {
  const r = ((Math.round(num(value)) % 360) + 360) % 360;
  return r > 180 ? r - 360 : r;
};

/**
 * Cleans a layout from the editor. Returns the layout, or an error code and message.
 * @param {any} input
 * @returns {{ layout: { room: { w: number, d: number, terrace: number }, tables: any[], decor: any[] } } | { error: string, message: string }}
 */
export function normalizeLayout(input) {
  const room = normalizeRoom(input?.room),
    items = Array.isArray(input?.items) ? input.items : [],
    tableItems = items.filter((item) => item?.kind === "table"),
    decorItems = items.filter((item) => item?.kind === "decor");
  if (tableItems.length > LIMITS.tables || decorItems.length > LIMITS.decor)
    return { error: "map_limit", message: "هر شعبه حداکثر ۲۰۰ میز و ۶۰ وسیله‌ی دکور دارد." };
  const tables = tableItems.map((item, index) => {
    const type = Object.hasOwn(TABLE_TYPES, item.type) ? item.type : "square4";
    return {
      id: idPart(item.id) || `t${index + 1}`,
      name:
        String(item.name ?? "")
          .trim()
          .slice(0, 12) || `T${index + 1}`,
      type,
      ...inside(room, item.x, item.z),
      rot: rotation(item.rot),
      tags: [...new Set(Array.isArray(item.tags) ? item.tags : [])]
        .filter((tag) => TABLE_TAGS.includes(tag))
        .slice(0, 6),
      reservable: item.reservable !== false,
    };
  });
  const ids = new Set(tables.map((table) => table.id)),
    names = new Set(tables.map((table) => table.name));
  if (ids.size !== tables.length)
    return {
      error: "invalid_map",
      message: "شناسه‌ی میز تکراری است؛ چینش را دوباره بارگذاری کنید.",
    };
  if (names.size !== tables.length)
    return {
      error: "duplicate_table_name",
      message: "دو میز یک نام دارند؛ نام‌ها باید یکتا باشند.",
    };
  const decor = decorItems
    .filter((item) => DECOR_TYPES.includes(item.type))
    .map((item) => ({
      kind: "decor",
      type: item.type,
      ...inside(room, item.x, item.z, 0),
      rot: rotation(item.rot),
      ...(item.type === "vip"
        ? {
            w: clamp(Math.round(num(item.w, 6)), 3, 14),
            d: clamp(Math.round(num(item.d, 6)), 3, 14),
          }
        : {}),
    }));
  return { layout: { room, tables, decor } };
}

/** The stored area layout column, which may be NULL, malformed or an old 2D door/window note. */
function storedLayout(text) {
  try {
    const value = text ? JSON.parse(text) : null;
    return value?.version === 2 ? value : null;
  } catch {
    return null;
  }
}
/** The closest new table type to an old 2D table. */
function legacyType(shape, capacity) {
  if (capacity > 4) return shape === "round" ? "booth6" : "long6";
  if (capacity > 2) return shape === "round" ? "round4" : "square4";
  return shape === "round" ? "round2" : "square4";
}
/**
 * Turns an old 2D map (areas in pixels, 40 px a metre) into one room: indoor areas side by side
 * make the hall, outdoor areas become the terrace in front of it. Table ids stay the same, so
 * their reservations stay theirs.
 */
function legacyLayout(areas, tables, spaceMode) {
  const shown = areas.filter((a) => spaceMode === "both" || a.kind === spaceMode),
    indoor = shown.filter((a) => a.kind !== "outdoor"),
    outdoor = shown.filter((a) => a.kind === "outdoor"),
    hall = indoor.length ? indoor : outdoor,
    yard = indoor.length ? outdoor : [],
    widthOf = (list) => list.reduce((sum, a) => sum + num(a.width, 820), 0) / PX,
    depthOf = (list) => Math.max(0, ...list.map((a) => num(a.height, 520) / PX)),
    room = normalizeRoom({
      w: Math.max(widthOf(hall), widthOf(yard)),
      d: depthOf(hall),
      terrace: depthOf(yard),
    });
  /** Where each area's top-left corner falls in the room, in metres. */
  const origin = new Map();
  const lay = (list, top) => {
    let left = -widthOf(list) / 2;
    for (const area of list) {
      origin.set(area.id, { x: left, z: top });
      left += num(area.width, 820) / PX;
    }
  };
  lay(hall, -room.d / 2);
  lay(yard, room.d / 2);
  const placed = tables
    .filter((t) => origin.has(t.area_id))
    .map((t) => {
      const o = origin.get(t.area_id),
        w = t.shape === "rect" ? 118 : 76,
        h = t.shape === "rect" ? 70 : 76;
      return {
        id: t.id,
        name: String(t.name || "").slice(0, 12),
        type: legacyType(t.shape, Number(t.capacity)),
        ...inside(
          room,
          o.x + (num(t.position_x) + w / 2) / PX,
          o.z + (num(t.position_y) + h / 2) / PX,
        ),
        rot: 0,
        tags: [],
        reservable: Boolean(t.reservable),
        operational_status: t.operational_status,
      };
    });
  return { room, decor: [], tables: placed };
}

/** A new branch's floor: a small hall with a bar and five tables. */
export const starterLayout = {
  room: { w: 16, d: 11, terrace: 0 },
  decor: [
    { kind: "decor", type: "bar", x: 3.5, z: -4.2, rot: 0 },
    { kind: "decor", type: "plant", x: -7, z: 4.6, rot: 0 },
    { kind: "decor", type: "plant", x: 7, z: 4.6, rot: 0 },
  ],
  tables: [
    { id: "t1", name: "میز ۱", type: "round2", x: -5, z: -3, rot: 0, tags: ["کنار پنجره"] },
    { id: "t2", name: "میز ۲", type: "round2", x: -1.5, z: -3, rot: 0, tags: ["کنار پنجره"] },
    { id: "t3", name: "میز ۳", type: "square4", x: -4, z: 1.5, rot: 0, tags: [] },
    { id: "t4", name: "میز ۴", type: "square4", x: 0.5, z: 1.5, rot: 0, tags: [] },
    { id: "t5", name: "میز ۵", type: "round2", x: 4.5, z: 1.5, rot: 0, tags: ["دنج"] },
  ],
};

/**
 * The statements that store a layout: the branch's one area, and every table in it. Tables
 * missing from the layout, and other areas, are removed by the caller.
 * @param {D1Database} db @param {string} branchId
 * @param {{ room: any, decor: any[], tables: any[] }} layout @param {string} now
 */
export function layoutStatements(db, branchId, layout, now) {
  const areaId = `${branchId}:main`,
    { room } = layout;
  return [
    db
      .prepare(
        "INSERT INTO areas (id,branch_id,name,kind,sort_order,width,height,layout) VALUES (?,?,'سالن اصلی','indoor',0,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,sort_order=0,width=excluded.width,height=excluded.height,layout=excluded.layout",
      )
      .bind(
        areaId,
        branchId,
        room.w * PX,
        (room.d + room.terrace) * PX,
        JSON.stringify({ version: 2, room, decor: layout.decor }),
      ),
    db.prepare("UPDATE branches SET space_mode='indoor' WHERE id=?").bind(branchId),
    ...layout.tables.map((t) =>
      db
        .prepare(
          "INSERT INTO cafe_tables (id,area_id,name,shape,capacity,position_x,position_y,rotation,tags,reservable,operational_status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'available',?) ON CONFLICT(id) DO UPDATE SET area_id=excluded.area_id,name=excluded.name,shape=excluded.shape,capacity=excluded.capacity,position_x=excluded.position_x,position_y=excluded.position_y,rotation=excluded.rotation,tags=excluded.tags,reservable=excluded.reservable,updated_at=excluded.updated_at",
        )
        .bind(
          `${branchId}:${t.id}`,
          areaId,
          t.name,
          t.type,
          TABLE_TYPES[t.type],
          t.x,
          t.z,
          t.rot,
          JSON.stringify(t.tags),
          t.reservable === false ? 0 : 1,
          now,
        ),
    ),
  ];
}

const parseTags = (text) => {
  try {
    const tags = JSON.parse(text || "[]");
    return Array.isArray(tags) ? tags.filter((tag) => TABLE_TAGS.includes(tag)) : [];
  } catch {
    return [];
  }
};

export async function readMap(db, cafeSlug, branchSlug) {
  const branch = await branchRow(db, cafeSlug, branchSlug);
  if (!branch) return null;
  const [areasResult, tablesResult] = await db.batch([
    db
      .prepare(
        "SELECT id,name,kind,width,height,sort_order,layout FROM areas WHERE branch_id=? ORDER BY sort_order,id",
      )
      .bind(branch.id),
    db
      .prepare(
        "SELECT t.id,t.area_id,t.name,t.shape,t.capacity,t.position_x,t.position_y,t.rotation,t.tags,t.reservable,t.operational_status FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=? ORDER BY t.name",
      )
      .bind(branch.id),
  ]);
  const prefix = `${branch.id}:`,
    areas = areasResult.results || [],
    rows = (tablesResult.results || []).map((row) => ({
      ...row,
      id: String(row.id).replace(prefix, ""),
    })),
    stored = areas.length === 1 ? storedLayout(areas[0].layout) : null;
  // A floor saved by the 3D editor reads as it is; an old 2D one is converted until it is saved.
  const layout = stored
    ? {
        room: normalizeRoom(stored.room),
        decor: Array.isArray(stored.decor) ? stored.decor : [],
        tables: rows.map((row) => ({
          id: row.id,
          name: row.name,
          type: Object.hasOwn(TABLE_TYPES, row.shape)
            ? row.shape
            : legacyType(row.shape, row.capacity),
          x: num(row.position_x),
          z: num(row.position_y),
          rot: num(row.rotation),
          tags: parseTags(row.tags),
          reservable: Boolean(row.reservable),
          operational_status: row.operational_status,
        })),
      }
    : legacyLayout(
        areas.map((a) => ({
          ...a,
          kind: a.kind === "outdoor" ? "outdoor" : "indoor",
        })),
        rows,
        ["indoor", "outdoor", "both"].includes(branch.space_mode) ? branch.space_mode : "both",
      );
  return {
    branch: { slug: branchSlug, name: branch.name, city: branch.city, address: branch.address },
    room: layout.room,
    items: [
      ...layout.decor,
      ...layout.tables.map((t) => ({
        kind: "table",
        id: t.id,
        name: t.name,
        type: t.type,
        seats: TABLE_TYPES[t.type],
        x: t.x,
        z: t.z,
        rot: t.rot,
        tags: t.tags,
        reservable: t.reservable,
        operationalStatus: t.operational_status || "available",
      })),
    ],
  };
}

/**
 * Saves the floor the owner arranged, and publishes it at once.
 * @param {D1Database} db @param {string} cafeSlug @param {string} branchSlug @param {any} body
 */
export async function writeMap(db, cafeSlug, branchSlug, body) {
  const normalized = normalizeLayout(body?.layout);
  if ("error" in normalized) return reply(normalized, 400);
  const { layout } = normalized,
    branchId = `branch:${cafeSlug}:${branchSlug}`,
    branch = await branchRow(db, cafeSlug, branchSlug);
  if (!branch) return reply({ error: "branch_not_found" }, 404);
  const keep = new Set(layout.tables.map((t) => `${branchId}:${t.id}`));
  const existing = await db
    .prepare(
      "SELECT t.id,t.name,COUNT(rt.reservation_id) AS reservation_count FROM cafe_tables t JOIN areas a ON a.id=t.area_id LEFT JOIN reservation_tables rt ON rt.table_id=t.id WHERE a.branch_id=? GROUP BY t.id",
    )
    .bind(branchId)
    .all();
  const removed = (existing.results || []).filter((row) => !keep.has(String(row.id))),
    protectedTable = removed.find((row) => Number(row.reservation_count) > 0);
  if (protectedTable)
    return reply(
      {
        error: "table_has_reservations",
        message: `میز «${protectedTable.name}» سابقه‌ی رزرو دارد و حذفش اطلاعات رزرو را از بین می‌برد. به‌جای حذف، آن را غیرقابل رزرو کنید.`,
      },
      409,
    );
  const now = new Date().toISOString(),
    statements = layoutStatements(db, branchId, layout, now);
  for (const row of removed)
    statements.push(db.prepare("DELETE FROM cafe_tables WHERE id=?").bind(row.id));
  // Old 2D areas go once their tables have moved into the one room.
  statements.push(
    db.prepare("DELETE FROM areas WHERE branch_id=? AND id<>?").bind(branchId, `${branchId}:main`),
  );
  await db.batch(statements);
  return readMap(db, cafeSlug, branchSlug);
}
