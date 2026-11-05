// Door, window and counter: the layout each room stores, the geometry the editor and the
// customer's map draw from, and the map API round trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLayout, venueGeometry } from "../web/src/venue-layout.js";
import { fixture } from "./helpers/worker.mjs";

test("door, window and counter follow the owner's layout", () => {
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
