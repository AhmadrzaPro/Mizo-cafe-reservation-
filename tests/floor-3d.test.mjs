// The 3D floor's rules: zones from where a table stands, overlaps, fitting a party, the layout the
// server stores, and the server's checks on what the editor sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampPos,
  exportLayout,
  fits,
  nextName,
  overlaps,
  zoneOf,
} from "../web/src/floor3d/model.js";
import { normalizeLayout, starterLayout, TABLE_TYPES } from "../worker/src/map.js";
import { TYPES } from "../web/src/floor3d/model.js";
import { assets, page } from "../dist/server/site-content.js";

const room = { w: 24, d: 16, terrace: 6 };
const table = (id, type, x, z) => ({ kind: "table", id, name: id, type, x, z, rot: 0, tags: [] });

test("a table's zone follows where it stands: terrace, inside a VIP area, or the hall", () => {
  const vip = { kind: "decor", type: "vip", x: -9, z: -3, rot: 0, w: 6, d: 9 },
    layout = {
      room,
      items: [
        vip,
        table("a", "round2", 0, 0),
        table("b", "booth4", -9, -4),
        table("c", "round4", 0, 10),
      ],
    };
  assert.deepEqual(
    layout.items.slice(1).map((t) => zoneOf(layout, t)),
    ["hall", "vip", "terrace"],
  );
  // Turned a quarter, the VIP area's width and depth swap.
  const edge = table("d", "round2", -13, -3);
  assert.equal(zoneOf(layout, edge), "hall");
  vip.rot = 90;
  assert.equal(zoneOf(layout, edge), "vip");
});

test("tables too close overlap; a party fits tables with enough seats and at most three spare", () => {
  const a = table("a", "round2", 0, 0),
    layout = { room, items: [a, table("b", "round2", 1.5, 0)] };
  assert.equal(overlaps(layout, a), true);
  layout.items[1].x = 5;
  assert.equal(overlaps(layout, a), false);
  assert.equal(fits(layout, table("s", "square4", 0, 0), 2), true);
  assert.equal(fits(layout, table("s", "square4", 0, 0), 5), false, "too small");
  assert.equal(fits(layout, table("l", "long6", 0, 0), 2), false, "too big");
  assert.equal(fits(layout, a, 2, "terrace"), false, "another zone");
});

test("positions stay inside the room and terrace; new tables get the next free label", () => {
  const layout = { room, items: [table("T1", "round2", 0, 0)] },
    far = table("x", "round2", 99, -99);
  clampPos(layout, far);
  assert.deepEqual([far.x, far.z], [12 - 0.9, -8 + 0.9]);
  assert.equal(nextName(layout), "T2");
  const out = exportLayout({
    room,
    items: [{ ...table("T1", "round2", 1, 2), group: {}, mats: [] }],
  });
  assert.deepEqual(Object.keys(out.items[0]).sort(), [
    "id",
    "kind",
    "name",
    "reservable",
    "rot",
    "tags",
    "type",
    "x",
    "z",
  ]);
});

test("the server keeps the editor's types, cleans what it sends and refuses twin labels", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.seats])),
    TABLE_TYPES,
  );
  const ok = normalizeLayout({
    room: { w: 100, d: 2, terrace: -3 },
    items: [
      { ...table("t1", "nonsense", 500, 0), tags: ["دنج", "made up"] },
      { kind: "decor", type: "vip", x: 0, z: 0, w: 99 },
      { kind: "decor", type: "rocket", x: 0, z: 0 },
    ],
  });
  assert.ok("layout" in ok);
  const { layout } = /** @type {any} */ (ok);
  assert.deepEqual(layout.room, { w: 40, d: 6, terrace: 0 });
  assert.equal(layout.tables[0].type, "square4");
  assert.equal(layout.tables[0].x, 19, "inside the room, on the quarter-metre grid");
  assert.deepEqual(layout.tables[0].tags, ["دنج"]);
  assert.equal(layout.decor.length, 1);
  assert.equal(layout.decor[0].w, 14);
  const twins = normalizeLayout({
    room,
    items: [table("a", "round2", 0, 0), { ...table("b", "round2", 5, 0), name: "a" }],
  });
  assert.equal(/** @type {any} */ (twins).error, "duplicate_table_name");
  assert.equal(starterLayout.tables.length, 5);
});

test("three.js is only in the floor bundle, which the page loads by itself only on a café", () => {
  assert.doesNotMatch(assets["/app.js"].body, /WebGLRenderer/);
  assert.match(assets["/floor3d.js"].body, /WebGLRenderer/);
  assert.match(page, /<meta name="floor3d-src" content="\/floor3d\.js\?v=[0-9a-f]{12}">/);
  assert.doesNotMatch(page, /<script[^>]+floor3d/);
});
