// Input for walking: keyboard on desktop, a thumb joystick on touch screens, and dragging to look
// around. A short tap or click picks a table. Every listener is removed by dispose().

/**
 * @param {HTMLElement} container Holds the canvas and the joystick.
 * @param {HTMLCanvasElement} canvas
 * @param {{ reducedMotion: boolean, onLook: (dx: number, dy: number) => void,
 *   onTap: (x: number, y: number) => void, onActivate: () => void }} handlers
 */
export function createControls(container, canvas, handlers) {
  const keys = new Set(),
    stick = { x: 0, y: 0 },
    cleanups = /** @type {(() => void)[]} */ ([]);
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  // Keyboard: W/S or ↑/↓ walk, A/D step sideways, ←/→ turn, Enter or Space picks the table ahead.
  const KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  listen(canvas, "keydown", (/** @type {KeyboardEvent} */ event) => {
    if (KEYS.includes(event.code)) {
      keys.add(event.code);
      event.preventDefault();
    } else if (event.code === "Enter" || event.code === "Space") {
      handlers.onActivate();
      event.preventDefault();
    }
  });
  listen(canvas, "keyup", (/** @type {KeyboardEvent} */ event) => keys.delete(event.code));
  listen(canvas, "blur", () => keys.clear());

  // Dragging on the canvas looks around; a short, still press is a tap.
  /** @type {Map<number, { x: number, y: number, startX: number, startY: number, at: number }>} */
  const looks = new Map();
  listen(canvas, "pointerdown", (/** @type {PointerEvent} */ event) => {
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    looks.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      at: performance.now(),
    });
  });
  listen(canvas, "pointermove", (/** @type {PointerEvent} */ event) => {
    const look = looks.get(event.pointerId);
    if (!look) return;
    handlers.onLook(event.clientX - look.x, event.clientY - look.y);
    look.x = event.clientX;
    look.y = event.clientY;
  });
  const endLook = (/** @type {PointerEvent} */ event) => {
    const look = looks.get(event.pointerId);
    looks.delete(event.pointerId);
    if (
      look &&
      event.type === "pointerup" &&
      Math.hypot(event.clientX - look.startX, event.clientY - look.startY) < 8 &&
      performance.now() - look.at < 400
    )
      handlers.onTap(event.clientX, event.clientY);
  };
  listen(canvas, "pointerup", endLook);
  listen(canvas, "pointercancel", endLook);

  // The joystick: shown on touch screens, bottom corner, inside the safe area.
  const joystick = document.createElement("div"),
    knob = document.createElement("span");
  joystick.className = "virtual-joystick";
  joystick.setAttribute("aria-hidden", "true");
  joystick.append(knob);
  container.append(joystick);
  cleanups.push(() => joystick.remove());
  let stickPointer = -1;
  const moveStick = (/** @type {PointerEvent} */ event) => {
    const rect = joystick.getBoundingClientRect(),
      radius = rect.width / 2,
      dx = event.clientX - (rect.left + radius),
      dy = event.clientY - (rect.top + radius),
      length = Math.min(1, Math.hypot(dx, dy) / radius) || 0,
      angle = Math.atan2(dy, dx);
    stick.x = Math.cos(angle) * length;
    stick.y = Math.sin(angle) * length;
    knob.style.transform = `translate(${stick.x * radius * 0.6}px, ${stick.y * radius * 0.6}px)`;
  };
  listen(joystick, "pointerdown", (/** @type {PointerEvent} */ event) => {
    stickPointer = event.pointerId;
    joystick.setPointerCapture(event.pointerId);
    moveStick(event);
    event.preventDefault();
  });
  listen(joystick, "pointermove", (/** @type {PointerEvent} */ event) => {
    if (event.pointerId === stickPointer) moveStick(event);
  });
  const releaseStick = (/** @type {PointerEvent} */ event) => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = -1;
    stick.x = stick.y = 0;
    knob.style.transform = "";
  };
  listen(joystick, "pointerup", releaseStick);
  listen(joystick, "pointercancel", releaseStick);

  return {
    /** The walking input now: forward/backward, sideways, and turning, each from -1 to 1. */
    read() {
      const has = (...codes) => codes.some((code) => keys.has(code));
      // A slight dead zone so a resting thumb does not drift.
      const deadZone = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      return {
        forward:
          (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0) - deadZone(stick.y),
        strafe: (has("KeyD") ? 1 : 0) - (has("KeyA") ? 1 : 0) + deadZone(stick.x),
        turn: (has("ArrowRight") ? 1 : 0) - (has("ArrowLeft") ? 1 : 0),
      };
    },
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      keys.clear();
    },
  };
}
