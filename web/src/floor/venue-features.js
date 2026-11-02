// Draws a room's door, window and counter where its layout puts them (venue-layout.js), on the
// editor canvas and on the customer's 2D map.
import { venueGeometry } from "../venue-layout.js";

/**
 * Inline position of a feature: a rectangle in map pixels, with text running along a side wall.
 * @param {{ x: number, y: number, width: number, height: number }} rect
 */
export function featureStyle(rect) {
  return `left:${rect.x}px;top:${rect.y}px;right:auto;bottom:auto;width:${rect.width}px;height:${rect.height}px;writing-mode:${rect.height > rect.width ? "vertical-rl" : "horizontal-tb"}`;
}

/**
 * Moves the editor canvas's window, counter and door into place, or hides those the room lacks.
 * @param {HTMLElement} canvas
 * @param {Parameters<typeof venueGeometry>[0]} area
 */
export function placeVenueFeatures(canvas, area) {
  const geometry = venueGeometry(area);
  for (const [selector, rect] of /** @type {const} */ ([
    [".canvas-window", geometry.window],
    [".canvas-bar", geometry.counter],
    [".canvas-door", geometry.door],
  ])) {
    const element = /** @type {HTMLElement | null} */ (canvas.querySelector(selector));
    if (!element) continue;
    element.hidden = !rect;
    if (rect) element.setAttribute("style", featureStyle(rect));
    element.dataset.side = rect?.side || "";
  }
}
