import { test } from "node:test";
import assert from "node:assert/strict";
import { tableFurniture } from "../web/src/floor/furniture.js";
import {
  recordMapHistory,
  resetMapHistory,
  syncHistoryButtons,
  travelMapHistory,
} from "../web/src/floor/history.js";
import { fitFloorZoom } from "../web/src/floor/geometry.js";
import { setupFloorGestures } from "../web/src/floor/gestures.js";
import { store } from "../web/src/state.js";

test("furniture has exactly one visual seat per capacity for every supported shape", () => {
  for (const shape of ["round", "square", "rect"])
    for (const capacity of [1, 2, 4, 6, 8, 20]) {
      const markup = tableFurniture({ shape, capacity });
      assert.equal((markup.match(/class="furniture-chair"/g) || []).length, capacity);
      assert.ok(!markup.includes("NaN"));
    }
});

test("undo restores table identity, coordinates and areas; a new edit drops redo", () => {
  const controls = {};
  const root = { querySelector: (key) => (controls[key] ??= {}) };
  const render = () => {};
  Object.assign(store, {
    mapHistory: [],
    mapHistoryIndex: -1,
    cafeMap: {
      areas: [{ id: "main", kind: "indoor" }],
      tables: [{ id: "existing-booked-table", x: 20, y: 30 }],
    },
    activeArea: "main",
    selectedId: null,
    dirty: false,
  });
  resetMapHistory(root);
  store.cafeMap.tables[0].x = 300;
  recordMapHistory(root);
  travelMapHistory(-1, render, root);
  assert.equal(store.cafeMap.tables[0].x, 20);
  assert.equal(store.cafeMap.tables[0].id, "existing-booked-table");
  travelMapHistory(1, render, root);
  assert.equal(store.cafeMap.tables[0].x, 300);
  travelMapHistory(-1, render, root);
  store.cafeMap.tables[0].y = 90;
  recordMapHistory(root);
  assert.equal(store.mapHistory.length, 2);
  assert.equal(controls["#mapRedo"].disabled, true);
  syncHistoryButtons(root);
  assert.equal(controls["#mapRedo"].disabled, true);
});

test("a large room fits mobile without changing its world dimensions", () => {
  const z = fitFloorZoom({ width: 4000, height: 3000 }, 320, 360);
  assert.ok(4000 * z <= 320 - 64);
  assert.ok(3000 * z <= 360 - 64);
  assert.ok(z > 0);
});

test("gesture pan suppresses table activation, but a tap does not", () => {
  const handlers = {},
    wrap = {
      scrollLeft: 100,
      scrollTop: 80,
      classList: { add() {}, remove() {} },
      addEventListener(name, fn) {
        handlers[name] = fn;
      },
      hasPointerCapture() {
        return false;
      },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
  setupFloorGestures(
    wrap,
    {},
    () => 1,
    () => {},
  );
  const e = (x, y) => ({
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    target: {
      closest() {
        return null;
      },
    },
    preventDefault() {},
    stopImmediatePropagation() {},
  });
  handlers.pointerdown(e(100, 100));
  handlers.pointerup(e(100, 100));
  let blocked = false;
  handlers.click({
    ...e(100, 100),
    stopImmediatePropagation() {
      blocked = true;
    },
  });
  assert.equal(blocked, false);
  handlers.pointerdown(e(100, 100));
  handlers.pointermove(e(150, 130));
  handlers.pointerup(e(150, 130));
  handlers.click({
    ...e(150, 130),
    stopImmediatePropagation() {
      blocked = true;
    },
  });
  assert.equal(blocked, true);
  assert.equal(wrap.scrollLeft, 50);
  assert.equal(wrap.scrollTop, 50);
});
