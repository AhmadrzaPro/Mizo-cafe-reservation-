// The 3D floor scene (three.js): the room, tables and decor of a FloorLayout, an isometric camera,
// picking and, in edit mode, dragging. Bundled on its own as /floor3d.js and loaded only on a
// café's page; the booking logic lives in view.js and talks to it through createFloor().
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { TYPES, clampPos, seatsOf, snap, zoneOf } from "./model.js";

const fa = (n) => Number(n).toLocaleString("fa-IR");
const ISO = new THREE.Vector3(26, 26, 26),
  TOP = new THREE.Vector3(0, 45, 0.01);

/**
 * @typedef {import("./model.js").FloorItem & { group?: THREE.Group, mats?: THREE.Material[],
 *   ringMat?: THREE.MeshBasicMaterial, glowMat?: THREE.MeshBasicMaterial, label?: HTMLElement,
 *   y0?: number, pulse?: boolean }} SceneItem
 */

/**
 * @param {HTMLElement} container
 * @param {{ onPick: (item: SceneItem) => void, onEmpty: () => void,
 *   onDragEnd: (item: SceneItem, moved: boolean) => void }} hooks
 */
export function createFloor(container, hooks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Without a GPU (a software renderer), shadows and a high pixel ratio cost too much: drop them.
  const gl = renderer.getContext(),
    info = gl.getExtension("WEBGL_debug_renderer_info"),
    software = /swiftshader|llvmpipe|software/i.test(
      String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ""),
    );
  if (software) {
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(1);
  }
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", top: "0", left: "0" });
  labels.domElement.className = "floor-labels";
  labels.domElement.dir = "ltr";
  container.appendChild(labels.domElement);

  /** @type {import("./model.js").FloorLayout} */
  let layout = { room: { w: 16, d: 11, terrace: 0 }, items: [] };
  let mode = "book";
  const size = () => ({
    w: container.clientWidth || innerWidth,
    h: container.clientHeight || innerHeight,
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f3ede6");
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 400);
  const frust = () => {
    const { w, h } = size(),
      span = Math.max(layout.room.w, layout.room.d + layout.room.terrace) + 6;
    return w < h ? ((span * 0.9) / (w / h)) * 0.62 : span;
  };
  function fitCam() {
    const { w, h } = size(),
      f = frust(),
      a = w / h;
    Object.assign(camera, { left: (-f * a) / 2, right: (f * a) / 2, top: f / 2, bottom: -f / 2 });
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
  }
  const homeTarget = () => new THREE.Vector3(0, 0, layout.room.terrace / 2);
  camera.position.copy(homeTarget()).add(ISO);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(homeTarget());
  Object.assign(controls, {
    enableDamping: true,
    dampingFactor: 0.08,
    minZoom: 0.6,
    maxZoom: 4,
    minPolarAngle: 0,
    maxPolarAngle: 1.2,
    screenSpacePanning: true,
  });

  scene.add(new THREE.HemisphereLight("#fff8f0", "#d9c8b5", 1.5));
  const sun = new THREE.DirectionalLight("#fff3e3", 2.0);
  sun.position.set(14, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -26,
    right: 26,
    top: 26,
    bottom: -26,
    near: 1,
    far: 90,
  });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: "#ebe2d8", roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  /** @param {THREE.ColorRepresentation} c @param {object} [o] */
  const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
  /** @param {THREE.Group | null} g */
  function disposeGroup(g) {
    if (!g) return;
    /** @type {THREE.Object3D[]} */
    const css = [];
    g.traverse((o) => {
      if (/** @type {any} */ (o).isCSS2DObject) css.push(o);
      const mesh = /** @type {THREE.Mesh} */ (o);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) [mesh.material].flat().forEach((m) => m.dispose());
    });
    css.forEach((o) => o.parent?.remove(o));
    scene.remove(g);
  }
  /** @param {THREE.Group} g @param {THREE.Material} mat */
  function box(g, w, h, d, x, y, z, mat, cast = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    g.add(m);
    return m;
  }
  /** @param {THREE.Group} g @param {string} text */
  function zlabel(g, text, x, z) {
    const el = document.createElement("div");
    el.className = "zlabel";
    el.dir = "rtl";
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.set(x, 0.3, z);
    g.add(o);
  }

  /** @type {THREE.Group | null} */
  let roomG = null;
  /** @type {THREE.GridHelper | null} */
  let grid = null;
  function buildRoom() {
    disposeGroup(roomG);
    const g = (roomG = new THREE.Group());
    scene.add(g);
    const { w, d, terrace } = layout.room;
    box(g, w + 0.4, 0.2, d + 0.4, 0, 0.1, 0, M("#d9b48c"), false);
    for (let x = -w / 2; x < w / 2; x += 1.2)
      box(g, 0.03, 0.01, d + 0.2, x, 0.205, 0, M("#c49a6f"), false);
    const wallM = M("#f7f1ea");
    box(g, w + 0.4, 3.2, 0.3, 0, 1.7, -d / 2 - 0.2, wallM);
    box(g, 0.3, 3.2, d + 0.6, -w / 2 - 0.2, 1.7, 0, wallM);
    const glass = new THREE.MeshStandardMaterial({
      color: "#bcd7e6",
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.75,
    });
    const nWin = Math.max(1, Math.floor(w / 6));
    for (let i = 0; i < nWin; i++) {
      const x = -w / 2 + (i + 0.5) * (w / nWin) - 1;
      box(g, 3, 1.6, 0.05, x, 1.9, -d / 2 - 0.03, glass, false);
      box(g, 3.2, 0.12, 0.2, x, 1.05, -d / 2 + 0.02, M("#8a5a36"));
    }
    if (terrace > 0) {
      box(g, w + 0.4, 0.14, terrace + 0.6, 0, 0.07, d / 2 + terrace / 2 + 0.3, M("#e3dbd1"), false);
      for (let x = -w / 2; x <= w / 2; x += 2)
        box(g, 0.04, 0.01, terrace + 0.4, x, 0.145, d / 2 + terrace / 2 + 0.3, M("#d3c8bb"), false);
      const half = (w - 3) / 2,
        lowM = M("#efe6dc"),
        gl = new THREE.MeshStandardMaterial({
          color: "#d6e6ee",
          transparent: true,
          opacity: 0.28,
          roughness: 0.1,
        });
      [-1, 1].forEach((s) => {
        const cx = s * (1.5 + half / 2);
        box(g, half, 0.6, 0.25, cx, 0.5, d / 2 + 0.2, lowM);
        box(g, half, 1.6, 0.05, cx, 1.6, d / 2 + 0.2, gl, false);
      });
      for (let x = -w / 2 + 1; x <= w / 2 - 1; x += 2.2) {
        box(g, 1.6, 0.5, 0.5, x, 0.4, d / 2 + terrace + 0.3, M("#a07a58"));
        const hedge = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), M("#5aa66e"));
        hedge.position.set(x, 0.8, d / 2 + terrace + 0.3);
        hedge.scale.set(1.6, 0.7, 0.9);
        g.add(hedge);
      }
      zlabel(g, "تراس", -w / 2 + 1.5, d / 2 + 1);
    }
    zlabel(g, "سالن اصلی", w / 2 - 3, d / 2 - 1.2);
    const span = Math.max(w, d + terrace) + 4;
    grid = new THREE.GridHelper(span, span * 2, "#c9a988", "#e2cdb6");
    grid.position.set(0, 0.23, terrace / 2);
    grid.visible = mode === "edit";
    const gridMat = /** @type {THREE.Material} */ (grid.material);
    gridMat.transparent = true;
    gridMat.opacity = 0.45;
    g.add(grid);
  }

  /** @type {THREE.Group | null} */
  let itemsG = null;
  /** @type {THREE.Object3D[]} */
  const pickables = [];
  /** @param {SceneItem} it @param {THREE.Group} g @param {THREE.BufferGeometry} geo @param {THREE.Material} m */
  function part(it, g, geo, m, x, y, z, ry = 0) {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.castShadow = true;
    o.receiveShadow = true;
    o.userData.item = it;
    g.add(o);
    pickables.push(o);
    return o;
  }
  /** @param {SceneItem} it */
  function addDecor(it) {
    const g = new THREE.Group();
    g.position.set(it.x, 0, it.z);
    g.rotation.y = (-it.rot * Math.PI) / 180;
    it.group = g;
    it.mats = [];
    const mat = (c) => {
      const m = M(c, { transparent: true });
      it.mats?.push(m);
      return m;
    };
    if (it.type === "vip") {
      const w = it.w || 6,
        d = it.d || 6;
      part(it, g, new THREE.BoxGeometry(w, 0.14, d), mat("#7d5236"), 0, 0.27, 0);
      part(it, g, new THREE.BoxGeometry(w - 1, 0.02, d - 1.2), mat("#b0473f"), 0, 0.35, 0);
      zlabel(g, "VIP", 0, d / 2 + 0.5);
    } else if (it.type === "bar") {
      part(it, g, new THREE.BoxGeometry(6.4, 1.1, 1.1), mat("#5b3a26"), 0, 0.75, 0);
      part(it, g, new THREE.BoxGeometry(6.6, 0.08, 1.3), mat("#e8e0d6"), 0, 1.34, 0);
      part(it, g, new THREE.BoxGeometry(1, 0.7, 0.6), mat("#c9ccd1"), 1.6, 1.73, -0.1);
      for (let i = 0; i < 4; i++) {
        part(
          it,
          g,
          new THREE.CylinderGeometry(0.25, 0.25, 0.1, 16),
          mat("#3a2a20"),
          -2.2 + i * 1.5,
          0.95,
          1,
        );
        part(
          it,
          g,
          new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8),
          mat("#3a2a20"),
          -2.2 + i * 1.5,
          0.55,
          1,
        );
      }
    } else {
      part(it, g, new THREE.CylinderGeometry(0.32, 0.25, 0.5, 14), mat("#c8a27c"), 0, 0.45, 0);
      part(it, g, new THREE.SphereGeometry(0.55, 12, 10), mat("#4f9a62"), 0, 1.05, 0).scale.y = 1.3;
    }
    const r =
      it.type === "vip" ? Math.max(it.w || 6, it.d || 6) / 2 + 0.3 : it.type === "bar" ? 3.6 : 0.8;
    it.ringMat = new THREE.MeshBasicMaterial({ color: "#7a4b2a", transparent: true, opacity: 0 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48), it.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    g.add(ring);
    itemsG?.add(g);
  }
  /** @param {SceneItem} t */
  function addTable(t) {
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.rotation.y = (-t.rot * Math.PI) / 180;
    t.mats = [];
    const zn = zoneOf(layout, t),
      seats = seatsOf(t);
    const mat = (c) => {
      const m = M(c, { transparent: true });
      t.mats?.push(m);
      return m;
    };
    const y0 = zn === "vip" ? 0.35 : zn === "terrace" ? 0.14 : 0.21;
    const wood = mat("#a8714a"),
      dark = mat("#3d2c22"),
      seat = mat(zn === "vip" ? "#5a3d6b" : zn === "terrace" ? "#e9e2d6" : "#d7c3ad");
    const shape = t.type.replace(/\d/g, "");
    let ringGeo, glowGeo;
    if (shape === "round") {
      const r = seats > 2 ? 1.55 : 1.25;
      ringGeo = new THREE.RingGeometry(r, r + 0.2, 40);
      glowGeo = new THREE.CircleGeometry(r, 40);
    } else {
      const w = shape === "long" ? 3.9 : shape === "booth" ? 3.4 : 2.7,
        d = shape === "long" ? 2.6 : shape === "booth" ? (seats > 4 ? 3.8 : 3) : 2.7,
        s = new THREE.Shape(),
        hole = new THREE.Path(),
        i = 0.18;
      s.moveTo(-w / 2, -d / 2);
      s.lineTo(w / 2, -d / 2);
      s.lineTo(w / 2, d / 2);
      s.lineTo(-w / 2, d / 2);
      s.lineTo(-w / 2, -d / 2);
      hole.moveTo(-w / 2 + i, -d / 2 + i);
      hole.lineTo(-w / 2 + i, d / 2 - i);
      hole.lineTo(w / 2 - i, d / 2 - i);
      hole.lineTo(w / 2 - i, -d / 2 + i);
      hole.lineTo(-w / 2 + i, -d / 2 + i);
      s.holes.push(hole);
      ringGeo = new THREE.ShapeGeometry(s);
      glowGeo = new THREE.PlaneGeometry(w - 0.2, d - 0.2);
    }
    t.ringMat = new THREE.MeshBasicMaterial({ color: "#2fb87b", transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(ringGeo, t.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y0 + 0.02;
    g.add(ring);
    t.glowMat = new THREE.MeshBasicMaterial({ color: "#2fb87b", transparent: true, opacity: 0.12 });
    const glow = new THREE.Mesh(glowGeo, t.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = y0 + 0.015;
    g.add(glow);
    /** @param {THREE.BufferGeometry} geo @param {THREE.Material} m */
    const P = (geo, m, x, y, z, ry = 0) => part(t, g, geo, m, x, y0 + y, z, ry);
    const chair = (x, z, ry) => {
      P(new THREE.BoxGeometry(0.55, 0.08, 0.55), seat, x, 0.48, z, ry);
      const b = new THREE.Vector3(0, 0, -0.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      P(new THREE.BoxGeometry(0.55, 0.55, 0.07), seat, x + b.x, 0.78, z + b.z, ry);
      P(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 6), dark, x, 0.23, z, 0);
    };
    if (shape === "round") {
      const r = seats > 2 ? 0.75 : 0.55;
      P(new THREE.CylinderGeometry(r, r, 0.07, 32), wood, 0, 0.78, 0);
      P(new THREE.CylinderGeometry(0.07, 0.2, 0.75, 10), dark, 0, 0.38, 0);
      for (let i = 0; i < seats; i++) {
        const a = (i / seats) * Math.PI * 2 + (seats === 2 ? Math.PI / 2 : Math.PI / 4),
          cr = r + 0.45;
        chair(Math.cos(a) * cr, Math.sin(a) * cr, -a - Math.PI / 2);
      }
      if (zn === "terrace" && seats > 2) {
        P(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8), dark, 0, 1.6, 0);
        P(new THREE.ConeGeometry(1.7, 0.6, 8), mat("#f2e8d8"), 0, 2.8, 0);
      }
    } else if (shape === "square") {
      P(new THREE.BoxGeometry(1.3, 0.07, 1.3), wood, 0, 0.78, 0);
      [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ].forEach(([a, b]) => P(new THREE.BoxGeometry(0.06, 0.75, 0.06), dark, a, 0.38, b));
      chair(0, -1.05, 0);
      chair(0, 1.05, Math.PI);
      chair(-1.05, 0, Math.PI / 2);
      chair(1.05, 0, -Math.PI / 2);
    } else if (shape === "long") {
      P(new THREE.BoxGeometry(2.8, 0.07, 1.2), wood, 0, 0.78, 0);
      [
        [-1.3, -0.5],
        [1.3, -0.5],
        [-1.3, 0.5],
        [1.3, 0.5],
      ].forEach(([a, b]) => P(new THREE.BoxGeometry(0.06, 0.75, 0.06), dark, a, 0.38, b));
      [-0.9, 0, 0.9].forEach((x) => {
        chair(x, -1, 0);
        chair(x, 1, Math.PI);
      });
    } else {
      const len = seats > 4 ? 2.8 : 2,
        off = (len + 0.6) / 2 + 0.1;
      P(new THREE.BoxGeometry(1.1, 0.07, len - 0.3), wood, 0.2, 0.74, 0);
      P(new THREE.BoxGeometry(0.08, 0.7, 0.08), dark, 0.2, 0.37, 0);
      P(new THREE.BoxGeometry(0.8, 0.45, len + 0.6), seat, -0.95, 0.23, 0);
      P(new THREE.BoxGeometry(0.25, 0.9, len + 0.6), seat, -1.35, 0.55, 0);
      P(new THREE.BoxGeometry(len > 2 ? 2.3 : 1.7, 0.45, 0.7), seat, 0, 0.23, off);
      if (seats > 4) P(new THREE.BoxGeometry(2.3, 0.45, 0.7), seat, 0, 0.23, -off);
    }
    // The label is a real button: customers can tap it as well as the table.
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tlabel";
    el.dir = "rtl";
    el.dataset.table = t.id;
    const dot = document.createElement("i"),
      name = document.createElement("span");
    name.textContent = t.name || "";
    el.append(dot, name, `، ${fa(seats)} نفره`);
    el.setAttribute(
      "aria-label",
      `${/^میز/.test(t.name || "") ? t.name : `میز ${t.name}`}، ${fa(seats)} نفره`,
    );
    el.addEventListener("click", () => hooks.onPick(t));
    const lo = new CSS2DObject(el);
    lo.position.set(0, y0 + 2.1 + (zn === "terrace" && seats > 2 ? 1.3 : 0), 0);
    g.add(lo);
    t.label = el;
    t.group = g;
    t.y0 = y0;
    itemsG?.add(g);
  }
  function buildItems() {
    disposeGroup(itemsG);
    itemsG = new THREE.Group();
    scene.add(itemsG);
    pickables.length = 0;
    layout.items.forEach((it) => (it.kind === "table" ? addTable(it) : addDecor(it)));
  }

  // The pin over the chosen table.
  const pin = new THREE.Group(),
    pinM = M("#7a4b2a", { roughness: 0.4 });
  const pc = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.7, 16), pinM);
  pc.rotation.x = Math.PI;
  pc.position.y = 0.35;
  const ps = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), pinM);
  ps.position.y = 0.85;
  const pd = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 12, 10),
    new THREE.MeshBasicMaterial({ color: "#fff" }),
  );
  pd.position.set(0, 0.85, 0.25);
  pin.add(pc, ps, pd);
  pin.visible = false;
  scene.add(pin);

  /** @type {{ target: THREE.Vector3, off: THREE.Vector3, zoom: number } | null} */
  let fly = null;
  const isMobile = () => size().w <= 760;

  // Picking and dragging.
  const ray = new THREE.Raycaster(),
    mv = new THREE.Vector2(),
    floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** @type {number[] | null} */
  let down = null;
  /** @type {{ it: SceneItem, ox: number, oz: number, moved: boolean } | null} */
  let drag = null;
  const setMv = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    mv.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mv, camera);
  };
  /** @returns {SceneItem | undefined} */
  const hitItem = () => ray.intersectObjects(pickables, false)[0]?.object.userData.item;
  const el = renderer.domElement;
  // Capture: runs before OrbitControls, so the camera stays put while an item is dragged.
  el.addEventListener(
    "pointerdown",
    (e) => {
      down = [e.clientX, e.clientY];
      if (mode !== "edit") return;
      setMv(e);
      const it = hitItem();
      if (!it) return;
      const p = new THREE.Vector3();
      ray.ray.intersectPlane(floorPlane, p);
      drag = { it, ox: it.x - p.x, oz: it.z - p.z, moved: false };
      controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    },
    { capture: true },
  );
  el.addEventListener("pointermove", (e) => {
    setMv(e);
    if (drag && down) {
      const p = new THREE.Vector3();
      if (!ray.ray.intersectPlane(floorPlane, p)) return;
      drag.it.x = snap(p.x + drag.ox);
      drag.it.z = snap(p.z + drag.oz);
      clampPos(layout, drag.it);
      drag.it.group?.position.set(drag.it.x, 0, drag.it.z);
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) drag.moved = true;
      return;
    }
    if (e.pointerType === "mouse")
      el.style.cursor = hitItem() ? (mode === "edit" ? "move" : "pointer") : "grab";
  });
  el.addEventListener("pointerup", (e) => {
    if (drag) {
      const { it, moved } = drag;
      drag = null;
      controls.enabled = true;
      hooks.onDragEnd(it, moved);
      return;
    }
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    setMv(e);
    const it = hitItem();
    if (it && (mode === "edit" || it.kind === "table")) hooks.onPick(it);
    else hooks.onEmpty();
  });
  controls.addEventListener("start", () => (fly = null));
  const onResize = () => {
    fitCam();
    invalid = true;
  };
  addEventListener("resize", onResize);

  let frame = 0,
    stopped = false;
  const clock = new THREE.Clock();
  // Drawn on demand: on camera moves, flights, drags and changes; the pulse of free tables and the
  // turning pin are drawn about ten times a second. An idle floor costs little battery or CPU.
  let invalid = true,
    lastAmbient = 0;
  const invalidate = () => (invalid = true);
  controls.addEventListener("change", invalidate);
  function tick() {
    if (stopped) return;
    frame = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();
    if (fly) {
      controls.target.lerp(fly.target, 0.09);
      camera.position.lerp(fly.target.clone().add(fly.off), 0.09);
      camera.zoom += (fly.zoom - camera.zoom) * 0.09;
      camera.updateProjectionMatrix();
      if (
        controls.target.distanceTo(fly.target) < 0.02 &&
        camera.position.distanceTo(fly.target.clone().add(fly.off)) < 0.05 &&
        Math.abs(camera.zoom - fly.zoom) < 0.01
      )
        fly = null;
      invalid = true;
    }
    const pulsing = /** @type {SceneItem[]} */ (layout.items).some((it) => it.pulse);
    if ((pulsing || pin.visible) && t - lastAmbient > 0.1) {
      lastAmbient = t;
      const glow = 0.1 + (0.12 * (1 + Math.sin(t * 3.2))) / 2;
      /** @type {SceneItem[]} */ (layout.items).forEach((it) => {
        if (it.pulse && it.glowMat) it.glowMat.opacity = glow;
      });
      if (pin.visible) pin.rotation.y = t * 1.2;
      invalid = true;
    }
    if (controls.update()) invalid = true;
    if (drag) invalid = true;
    if (!invalid) return;
    invalid = false;
    renderer.render(scene, camera);
    labels.render(scene, camera);
  }

  const api = {
    /** Draws a new layout; the view keeps the objects and reads back positions after drags. */
    setLayout(/** @type {import("./model.js").FloorLayout} */ next) {
      layout = next;
      buildRoom();
      buildItems();
      fitCam();
    },
    rebuildItems: buildItems,
    rebuildRoom() {
      buildRoom();
      fitCam();
    },
    /** @param {"book" | "edit"} next */
    setMode(next) {
      mode = next;
      if (grid) grid.visible = next === "edit";
      container.dataset.mode = next;
    },
    /**
     * Colours each item: the view decides, the scene only draws.
     * @param {(item: SceneItem) => { color: string, off?: boolean, pulse?: boolean, warn?: boolean, selected?: boolean }} styleOf
     */
    paint(styleOf) {
      /** @type {SceneItem[]} */ (layout.items).forEach((it) => {
        const s = styleOf(it);
        if (it.kind === "decor") {
          if (it.ringMat) it.ringMat.opacity = s.selected ? 0.95 : 0;
          return;
        }
        if (!it.ringMat || !it.glowMat || !it.label) return;
        it.pulse = Boolean(s.pulse);
        it.ringMat.color.set(s.color);
        it.glowMat.color.set(s.color);
        it.glowMat.opacity = s.off ? 0 : mode === "edit" ? (s.selected ? 0.2 : 0.06) : 0.16;
        it.ringMat.opacity = s.off ? 0.35 : 0.95;
        it.mats?.forEach((m) => {
          m.opacity = s.off ? 0.28 : 1;
          m.depthWrite = !s.off;
        });
        it.label.classList.toggle("warn", Boolean(s.warn));
        it.label.classList.toggle("off", Boolean(s.off));
        it.label.dataset.state = s.off ? "off" : s.color === "#2fb87b" ? "free" : "busy";
        /** @type {HTMLElement} */ (it.label.querySelector("i")).style.background = s.color;
      });
    },
    /** @param {SceneItem | null} it */
    showPin(it) {
      pin.visible = Boolean(it);
      if (it)
        pin.position.set(
          it.x,
          (it.y0 || 0.2) + 2.4 + (zoneOf(layout, it) === "terrace" && seatsOf(it) > 2 ? 1.4 : 0),
          it.z,
        );
    },
    /** Brings an item into view, beside the panel on wide screens. @param {SceneItem} it */
    flyTo(it) {
      const pos = new THREE.Vector3(it.x, 0.8, it.z),
        off = camera.position.clone().sub(controls.target),
        { h } = size(),
        zoom = 2.1,
        wpp = (camera.top - camera.bottom) / zoom / h,
        right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
        up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
        dx = isMobile() ? 0 : -190,
        dy = isMobile() ? h * 0.2 : -10;
      fly = {
        target: pos.addScaledVector(right, -dx * wpp).addScaledVector(up, -dy * wpp),
        off,
        zoom,
      };
    },
    /** @param {boolean} [top] */
    home(top = false) {
      fly = { target: homeTarget(), off: (top ? TOP : ISO).clone(), zoom: 1 };
    },
    /** @param {number} factor */
    zoom(factor) {
      fly = null;
      camera.zoom = Math.max(0.6, Math.min(4, camera.zoom * factor));
      camera.updateProjectionMatrix();
    },
    toggleRotate() {
      controls.autoRotate = !controls.autoRotate;
      controls.autoRotateSpeed = 1.2;
      return controls.autoRotate;
    },
    /** Where the camera looks, for placing new items. */
    centre: () => ({ x: controls.target.x, z: controls.target.z }),
    /** Turns one item in place after a rotation change. @param {SceneItem} it */
    turn(it) {
      if (it.group) it.group.rotation.y = (-it.rot * Math.PI) / 180;
    },
    dispose() {
      stopped = true;
      cancelAnimationFrame(frame);
      removeEventListener("resize", onResize);
      disposeGroup(roomG);
      disposeGroup(itemsG);
      controls.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
  };
  for (const name of [
    "setLayout",
    "rebuildItems",
    "rebuildRoom",
    "setMode",
    "paint",
    "showPin",
    "zoom",
    "turn",
  ]) {
    const method = /** @type {any} */ (api)[name];
    /** @type {any} */ (api)[name] = (...args) => {
      const result = method(...args);
      invalid = true;
      return result;
    };
  }
  fitCam();
  tick();
  return api;
}
/** @typedef {ReturnType<typeof createFloor>} FloorScene */
export { TYPES };
