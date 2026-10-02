import { mapViewportPointers } from "../state.js";

export function setupFloorGestures(wrap, canvas, getZoom, setZoom, editorMode = false) {
  const pointers = editorMode ? mapViewportPointers : new Map();
  let pan = null,
    pinch = null,
    ignoreClickUntil = 0,
    suspended = false;
  const values = () => [...pointers.values()],
    pair = () => {
      const [a, b] = values();
      return {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
    };
  wrap.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const p = pair();
        pinch = { ...p, zoom: getZoom() };
        pan = null;
        suspended = true;
        ignoreClickUntil = Date.now() + 600;
        event.preventDefault();
        return;
      }
      if (pointers.size !== 1) return;
      suspended = false;
      const editable = editorMode && event.target.closest(".editor-table");
      if (!editable)
        pan = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: wrap.scrollLeft,
          top: wrap.scrollTop,
        };
    },
    true,
  );
  wrap.addEventListener(
    "pointermove",
    (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2 && pinch) {
        event.preventDefault();
        const p = pair();
        setZoom((pinch.zoom * p.distance) / pinch.distance, { x: p.x, y: p.y });
        wrap.scrollLeft -= p.x - pinch.x;
        wrap.scrollTop -= p.y - pinch.y;
        pinch.x = p.x;
        pinch.y = p.y;
        ignoreClickUntil = Date.now() + 600;
        return;
      }
      if (suspended || !pan || pan.id !== event.pointerId) return;
      const dx = event.clientX - pan.x,
        dy = event.clientY - pan.y;
      if (Math.hypot(dx, dy) < 5) return;
      event.preventDefault();
      if (!wrap.hasPointerCapture(event.pointerId)) wrap.setPointerCapture(event.pointerId);
      wrap.scrollLeft = pan.left - dx;
      wrap.scrollTop = pan.top - dy;
      ignoreClickUntil = Date.now() + 400;
      wrap.classList.add("floor-panning");
    },
    true,
  );
  const finish = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      pan = null;
      suspended = false;
      wrap.classList.remove("floor-panning");
    }
    if (wrap.hasPointerCapture(event.pointerId)) wrap.releasePointerCapture(event.pointerId);
  };
  wrap.addEventListener("pointerup", finish, true);
  wrap.addEventListener("pointercancel", finish, true);
  wrap.addEventListener(
    "lostpointercapture",
    (event) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) {
        pan = null;
        pinch = null;
        wrap.classList.remove("floor-panning");
      }
    },
    true,
  );
  wrap.addEventListener(
    "click",
    (event) => {
      if (Date.now() < ignoreClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  wrap.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(getZoom() * Math.exp(-event.deltaY * 0.008), { x: event.clientX, y: event.clientY });
    },
    { passive: false },
  );
}
