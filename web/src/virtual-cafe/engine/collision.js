// Keeps the visitor inside the room and out of tables and the counter. Pure 2D geometry on the
// floor plane (x, z), so it runs in unit tests without three.js.

/** Visitor radius in metres. */
export const BODY_RADIUS = 0.3;

/**
 * Moves from `from` by `step`, stopping at walls and sliding along obstacles.
 * @param {{ x: number, z: number }} from
 * @param {{ x: number, z: number }} step
 * @param {{ width: number, depth: number }} room
 * @param {{ x: number, z: number, width: number, depth: number }[]} obstacles Axis-aligned boxes.
 */
export function moveWithCollisions(from, step, room, obstacles) {
  const limitX = room.width / 2 - BODY_RADIUS,
    limitZ = room.depth / 2 - BODY_RADIUS;
  let x = clamp(from.x + step.x, -limitX, limitX),
    z = clamp(from.z, -limitZ, limitZ);
  if (obstacles.some((box) => overlaps(x, z, box))) x = from.x;
  z = clamp(from.z + step.z, -limitZ, limitZ);
  if (obstacles.some((box) => overlaps(x, z, box))) z = from.z;
  return { x, z };
}

/** Whether a body at (x, z) overlaps the box. */
export function overlaps(x, z, box) {
  const nearestX = clamp(x, box.x - box.width / 2, box.x + box.width / 2),
    nearestZ = clamp(z, box.z - box.depth / 2, box.z + box.depth / 2);
  return (x - nearestX) ** 2 + (z - nearestZ) ** 2 < BODY_RADIUS ** 2;
}

/**
 * The table the visitor faces within reach, if any: the nearest whose centre is within `reach`
 * metres and roughly ahead (within 45 degrees of the view direction).
 * @param {{ x: number, z: number }} at
 * @param {number} yaw View direction around the vertical axis; 0 looks towards -z.
 * @param {{ id: string, x: number, z: number }[]} tables
 */
export function tableInFront(at, yaw, tables, reach = 2.2) {
  const dirX = -Math.sin(yaw),
    dirZ = -Math.cos(yaw);
  /** @type {string | null} */
  let best = null,
    bestDistance = Infinity;
  for (const table of tables) {
    const dx = table.x - at.x,
      dz = table.z - at.z,
      distance = Math.hypot(dx, dz);
    if (distance > reach || distance < 0.01) continue;
    if ((dx * dirX + dz * dirZ) / distance < Math.SQRT1_2) continue;
    if (distance < bestDistance) {
      best = table.id;
      bestDistance = distance;
    }
  }
  return best;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
