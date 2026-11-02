// Virtual Cafe: the scene built from the real floor map, collision, the feature flag, and the
// bundle boundary that keeps three.js out of the normal booking page.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  belongsToBranch,
  branchIdOf,
  buildVirtualScene,
} from "../web/src/virtual-cafe/scene-model.js";
import {
  BODY_RADIUS,
  moveWithCollisions,
  overlaps,
  tableInFront,
} from "../web/src/virtual-cafe/engine/collision.js";
import { assets, page } from "../dist/server/site-content.js";
import { normalizeLayout, venueGeometry } from "../web/src/venue-layout.js";
import { fixture } from "./helpers/worker.mjs";

const map = {
  spaceMode: "both",
  areas: [
    { id: "main", name: "سالن اصلی", kind: "indoor", width: 820, height: 520 },
    { id: "terrace", name: "تراس", kind: "outdoor", width: 600, height: 400 },
  ],
  tables: [
    {
      id: "t1",
      area: "main",
      name: "میز ۱",
      shape: "round",
      capacity: 2,
      x: 0,
      y: 0,
      reservable: true,
    },
    {
      id: "t2",
      area: "main",
      name: "میز ۲",
      shape: "rect",
      capacity: 6,
      x: 690,
      y: 200,
      reservable: false,
    },
    { id: "t3", area: "terrace", name: "میز ۳", shape: "square", capacity: 4, x: 100, y: 100 },
  ],
};

test("every virtual table is a real table: its full id, branch and fields come from the map", () => {
  const scene = buildVirtualScene(map, { cafeSlug: "cafe-a", branchSlug: "main" }),
    tables = scene.areas.flatMap((area) => area.tables);
  assert.equal(scene.branchId, "branch:cafe-a:main");
  assert.deepEqual(
    tables.map((t) => t.tableId),
    ["branch:cafe-a:main:t1", "branch:cafe-a:main:t2", "branch:cafe-a:main:t3"],
  );
  assert.ok(tables.every((t) => t.branchId === "branch:cafe-a:main"));
  const [t1, t2] = tables;
  assert.equal(t1.label, "میز ۱، سالن اصلی");
  assert.equal(t1.capacity, 2);
  assert.equal(t2.reservable, false);
  // 40 px are a metre, measured from the area's centre: a 76 px table at (0, 0) of an
  // 820 × 520 px room has its centre 0.95 m in from the top-left corner.
  assert.deepEqual(t1.position, { x: -10.25 + 0.95, y: 0, z: -6.5 + 0.95 });
  assert.deepEqual(t2.size, { width: 118 / 40, depth: 70 / 40 });
  // The window runs along the right wall of indoor rooms.
  assert.equal(t1.nearWindow, false);
  assert.equal(t2.nearWindow, true);
  assert.ok(scene.areas[0].counter);
  assert.equal(scene.areas[1].counter, null, "outdoor areas have no counter");
});

test("the scene shows only the areas the branch shows, and nothing of another branch", () => {
  const indoor = buildVirtualScene(
    { ...map, spaceMode: "indoor" },
    { cafeSlug: "c", branchSlug: "b" },
  );
  assert.deepEqual(
    indoor.areas.map((a) => a.id),
    ["main"],
  );
  const id = branchIdOf("cafe-a", "main");
  assert.equal(belongsToBranch("branch:cafe-a:main:t1", id), true);
  assert.equal(belongsToBranch("branch:cafe-a:second:t1", id), false);
  assert.equal(belongsToBranch("branch:cafe-b:main:t1", id), false);
  assert.equal(belongsToBranch("branch:cafe-a:main:", id), false);
  assert.equal(belongsToBranch("branch:cafe-a:main:x:y", id), false);
  assert.equal(belongsToBranch(undefined, id), false);
});

test("the visitor stays inside the room and slides along tables instead of through them", () => {
  const room = { width: 10, depth: 8 },
    table = { x: 0, z: -2, width: 1, depth: 1 };
  const atWall = moveWithCollisions({ x: 4, z: 0 }, { x: 5, z: 0 }, room, []);
  assert.equal(atWall.x, 5 - BODY_RADIUS);
  // Walking straight into the table stops; the sideways part of the step still applies.
  const blocked = moveWithCollisions({ x: 0, z: -1 }, { x: 0.2, z: -0.5 }, room, [table]);
  assert.equal(blocked.z, -1);
  assert.equal(blocked.x, 0.2);
  assert.equal(overlaps(0, -2.5 - BODY_RADIUS + 0.01, table), true);
  assert.equal(overlaps(0, -2.5 - BODY_RADIUS - 0.01, table), false);
});

test("the table ahead is the nearest one within reach and in front", () => {
  const tables = [
    { id: "near", x: 0, z: -1.5 },
    { id: "far", x: 0, z: -4 },
    { id: "behind", x: 0, z: 1 },
    { id: "side", x: 1.5, z: 0 },
  ];
  assert.equal(tableInFront({ x: 0, z: 0 }, 0, tables), "near");
  assert.equal(tableInFront({ x: 0, z: 0 }, Math.PI, tables), "behind");
  // Turned to the right (negative yaw looks towards +x).
  assert.equal(tableInFront({ x: 0, z: 0 }, -Math.PI / 2, tables), "side");
  assert.equal(tableInFront({ x: 0, z: 10 }, 0, tables), null);
});

test("the Virtual Cafe is off unless VIRTUAL_CAFE names the café or says all", async () => {
  const settings = async (env) => {
    const f = await fixture(env),
      cafe = await f.setupCafe();
    return { slug: cafe.slug, data: (await f.call(`${cafe.base}/settings`)).data };
  };
  assert.equal((await settings({})).data.virtualCafeOffered, false);
  assert.equal((await settings({ VIRTUAL_CAFE: "all" })).data.virtualCafeOffered, true);
  assert.equal((await settings({ VIRTUAL_CAFE: "cafe-other" })).data.virtualCafeOffered, false);
  const f = await fixture(),
    cafe = await f.setupCafe();
  f.env.VIRTUAL_CAFE = `cafe-other, ${cafe.slug}`;
  assert.equal((await f.call(`${cafe.base}/settings`)).data.virtualCafeOffered, true);
});

test("three.js is only in the Virtual Cafe bundle, which the page does not load by itself", () => {
  const body = (path) => assets[path].body;
  assert.doesNotMatch(body("/app.js"), /WebGLRenderer|three\.js r\d/);
  assert.match(body("/virtual-cafe.js"), /WebGLRenderer|MizoVirtualCafeEngine/);
  // The page names the versioned engine URL for the loader, but has no script tag for it.
  assert.match(page, /<meta name="virtual-cafe-src" content="\/virtual-cafe\.js\?v=[0-9a-f]{12}">/);
  assert.doesNotMatch(page, /<script[^>]+virtual-cafe/);
  assert.doesNotMatch(page, /rel="(?:preload|modulepreload|prefetch)"[^>]+virtual-cafe/);
});

test("door, window and counter follow the owner's layout, in 2D geometry and in the 3D scene", () => {
  const room = { id: "main", name: "سالن", kind: "indoor", width: 820, height: 520 };
  // The classic layout, unchanged for maps saved before layouts existed.
  const classic = venueGeometry(room);
  assert.deepEqual(classic.layout, { door: "bottom", window: "right", counter: "left" });
  assert.deepEqual(classic.counter, { x: 24, y: 135, width: 88, height: 245, side: "left" });
  assert.deepEqual(classic.door, { x: 160, y: 492, width: 92, height: 28, side: "bottom" });
  assert.equal(classic.window?.side, "right");
  // Outdoors there is no window or counter unless the owner adds one.
  assert.deepEqual(normalizeLayout(null, "outdoor"), {
    door: "bottom",
    window: "none",
    counter: "none",
  });
  // Unknown values fall back; a window on the door's wall gives way to the door.
  assert.deepEqual(normalizeLayout({ door: "up", window: "x", counter: 7 }), classic.layout);
  const shared = venueGeometry({
    ...room,
    layout: { door: "left", window: "left", counter: "left" },
  });
  assert.equal(shared.window, null);
  // The counter on the door's wall starts past the door, keeping the entrance clear.
  assert.ok(shared.counter && shared.counter.y >= shared.door.y + shared.door.height);

  const scene = buildVirtualScene(
    {
      spaceMode: "indoor",
      areas: [{ ...room, layout: { door: "top", window: "left", counter: "none" } }],
      tables: [{ id: "t1", area: "main", name: "میز", shape: "round", capacity: 2, x: 0, y: 200 }],
    },
    { cafeSlug: "c", branchSlug: "b" },
  ).areas[0];
  assert.equal(scene.entrance.side, "top");
  assert.equal(scene.entrance.z, -6.5);
  assert.equal(scene.windowSide, "left");
  assert.equal(scene.counter, null);
  assert.equal(scene.tables[0].nearWindow, true, "a table against the left wall is by the window");
});

test("the map saves each room's layout and reads back a clean one", async () => {
  const f = await fixture(),
    cafe = await f.setupCafe(),
    owner = await f.login(cafe),
    map = (await f.call(`${cafe.base}/map`)).data;
  assert.deepEqual(map.areas[0].layout, { door: "bottom", window: "right", counter: "left" });
  map.areas[0].layout = { door: "right", window: "top", counter: "nonsense" };
  const saved = await f.call(`${cafe.base}/map`, { method: "PUT", cookie: owner, body: { map } });
  assert.equal(saved.status, 200);
  const again = (await f.call(`${cafe.base}/map`)).data;
  assert.deepEqual(again.areas[0].layout, { door: "right", window: "top", counter: "left" });
});
