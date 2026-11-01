// The Virtual Cafe engine: a separate bundle (/virtual-cafe.js) that the booking page loads only
// when a customer opens the Virtual Cafe. It renders the scene, moves the visitor and reports which
// table they face or pick. It knows nothing about booking: states come in, table ids go out.
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from "three";
import { buildArea, createKit, inwardOf } from "./build-scene.js";
import { moveWithCollisions, tableInFront } from "./collision.js";
import { createControls } from "./controls.js";

/** @typedef {import("../types").EngineOptions} EngineOptions */
/** @typedef {import("../types").EngineController} EngineController */

const EYE_HEIGHT = 1.6,
  WALK_SPEED = 1.6,
  TURN_SPEED = 1.9;

/**
 * @param {HTMLElement} container
 * @param {EngineOptions} options
 * @returns {EngineController}
 */
function mount(container, options) {
  const renderer = new WebGLRenderer({
    antialias: window.devicePixelRatio < 2,
    powerPreference: "default",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.className = "virtual-cafe-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    "کافه مجازی؛ با کلیدهای جهت حرکت کنید و Enter میز روبه‌رو را انتخاب می‌کند",
  );
  container.append(canvas);

  const scene = new Scene(),
    camera = new PerspectiveCamera(70, 1, 0.05, 60),
    kit = createKit();
  scene.add(new HemisphereLight("#fff6ea", "#8a7766", 2.2));
  const sun = new DirectionalLight("#ffffff", 1.1);
  sun.position.set(4, 8, 3);
  scene.add(sun);

  let states = options.states,
    current = /** @type {ReturnType<typeof buildArea> | null} */ (null),
    currentArea = /** @type {import("../types").VirtualArea | null} */ (null),
    focused = /** @type {string | null} */ (null),
    position = { x: 0, z: 0 },
    yaw = 0,
    pitch = -0.08,
    dirty = true,
    frame = 0,
    disposed = false;

  function showArea(areaId) {
    const area = options.scene.areas.find((a) => a.id === areaId) || options.scene.areas[0];
    if (!area) throw new Error("virtual_cafe_empty_scene");
    if (current) {
      scene.remove(current.group);
      current.dispose();
    }
    current = buildArea(area, kit);
    currentArea = area;
    scene.add(current.group);
    const outdoor = area.kind === "outdoor";
    scene.background = new Color(outdoor ? "#cfe3ec" : "#efe6da");
    scene.fog = new Fog(scene.background, 12, Math.max(area.width, area.depth) * 1.6);
    // Start just inside the door, looking into the room.
    const inward = inwardOf(area.entrance.side);
    position = {
      x: area.entrance.x + inward.x * 0.9,
      z: area.entrance.z + inward.z * 0.9,
    };
    for (let step = 0; step < 20 && current.obstacles.some((o) => near(position, o)); step++)
      position = { x: position.x + inward.x * 0.3, z: position.z + inward.z * 0.3 };
    // Face the middle of the tables, so the first view shows them rather than a wall.
    let centreX = 0,
      centreZ = 0;
    for (const table of area.tables) {
      centreX += table.position.x / area.tables.length;
      centreZ += table.position.z / area.tables.length;
    }
    yaw = Math.atan2(-(centreX - position.x), -(centreZ - position.z));
    pitch = -0.08;
    focused = null;
    options.onFocus(null);
    current.paint(states, focused);
    dirty = true;
  }

  const controls = createControls(container, canvas, {
    reducedMotion: options.reducedMotion,
    onLook(dx, dy) {
      yaw -= dx * 0.005;
      pitch = Math.max(-0.9, Math.min(0.6, pitch - dy * 0.004));
      dirty = true;
    },
    onTap(x, y) {
      const table = pickAt(x, y);
      if (table) options.onSelect(table);
    },
    onActivate() {
      if (focused) options.onSelect(focused);
    },
  });

  const raycaster = new Raycaster(),
    pointer = new Vector2();
  /** The table under a point of the canvas, if any. */
  function pickAt(x, y) {
    if (!current) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(current.pickable, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    return current.pick.get(`${hit.object.userData.kind}:${hit.instanceId}`)?.tableId || null;
  }

  function resize() {
    const width = container.clientWidth || 1,
      height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // A portrait phone needs a taller field of view to show as much of the room across.
    camera.fov = camera.aspect < 1 ? 82 : 65;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  // Adaptive resolution: while the visitor moves, if frames keep taking longer than ~30 FPS, draw
  // fewer pixels (down to 1×) rather than stutter. Phones are usually limited by pixels, not by
  // this scene's few draw calls.
  let pixelRatio = Math.min(window.devicePixelRatio, 2),
    slowFrames = 0,
    previousFrame = 0;
  function adaptResolution(now) {
    const frameMs = now - previousFrame;
    previousFrame = now;
    if (frameMs > 200) return; // The first frame after a pause says nothing about speed.
    slowFrames = frameMs > 34 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames < 30 || pixelRatio <= 1) return;
    pixelRatio = Math.max(1, pixelRatio - 0.5);
    renderer.setPixelRatio(pixelRatio);
    resize();
    slowFrames = 0;
  }

  // Frame loop. It renders only when something changed, unless the debug panel is measuring.
  let last = performance.now(),
    fpsFrames = 0,
    fpsSince = last;
  function tick(now) {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    try {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const input = controls.read();
      if (input.turn) {
        yaw -= input.turn * TURN_SPEED * dt;
        dirty = true;
      }
      if ((input.forward || input.strafe) && current && currentArea) {
        const speed = WALK_SPEED * dt,
          sin = Math.sin(yaw),
          cos = Math.cos(yaw),
          step = {
            x: (-sin * input.forward + cos * input.strafe) * speed,
            z: (-cos * input.forward - sin * input.strafe) * speed,
          };
        position = moveWithCollisions(position, step, currentArea, current.obstacles);
        dirty = true;
      }
      if (!dirty && !options.debug) return;
      camera.position.set(position.x, EYE_HEIGHT, position.z);
      camera.rotation.set(pitch, yaw, 0, "YXZ");
      if (current && currentArea) {
        const ahead = tableInFront(
          position,
          yaw,
          currentArea.tables.map((t) => ({ id: t.tableId, x: t.position.x, z: t.position.z })),
        );
        if (ahead !== focused) {
          focused = ahead;
          current.paint(states, focused);
          options.onFocus(focused);
        }
      }
      renderer.render(scene, camera);
      dirty = false;
      adaptResolution(now);
      fpsFrames++;
      if (options.onStats && now - fpsSince >= 1000) {
        options.onStats({
          fps: Math.round((fpsFrames * 1000) / (now - fpsSince)),
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        });
        fpsFrames = 0;
        fpsSince = now;
      }
    } catch (error) {
      dispose();
      options.onError(error);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    controls.dispose();
    current?.dispose();
    kit.floorTexture.dispose();
    for (const geometry of Object.values(kit.geometries)) geometry.dispose();
    for (const material of Object.values(kit.materials)) material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    if (!disposed) {
      dispose();
      options.onError(new Error("webgl_context_lost"));
    }
  });

  resize();
  showArea(options.areaId);
  frame = requestAnimationFrame(tick);
  canvas.focus({ preventScroll: true });

  return {
    setStates(next) {
      states = next;
      current?.paint(states, focused);
      dirty = true;
    },
    setArea(areaId) {
      showArea(areaId);
    },
    dispose,
  };
}

/** Whether a point is inside an obstacle, with a little room to stand. */
const near = (p, o) =>
  Math.abs(p.x - o.x) < o.width / 2 + 0.35 && Math.abs(p.z - o.z) < o.depth / 2 + 0.35;

/** @type {import("../types").VirtualCafeEngine} */
const engine = { mount };
/** @type {any} */ (globalThis).MizoVirtualCafeEngine = engine;
