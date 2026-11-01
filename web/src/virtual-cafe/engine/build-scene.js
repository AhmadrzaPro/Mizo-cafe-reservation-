// Turns a VirtualArea into three.js objects. Low-poly and texture-free: plain coloured materials,
// one canvas-drawn floor pattern, instanced chairs and table parts, two lights, no shadows.
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from "three";

/** @typedef {import("../types").VirtualArea} VirtualArea */
/** @typedef {import("../types").VirtualTable} VirtualTable */
/** @typedef {import("../types").VirtualTableState} VirtualTableState */

export const WALL_HEIGHT = 3;
const TABLE_HEIGHT = 0.75,
  SEAT_HEIGHT = 0.45;

/** The colour of each state on the floor ring under a table. */
export const STATE_COLORS = {
  AVAILABLE: new Color("#3f9d6b"),
  UNAVAILABLE: new Color("#9b8f86"),
  SELECTED: new Color("#c8813f"),
  UNKNOWN: new Color("#d8cfc4"),
};

/** Shared geometry and materials, created once per mount and disposed with it. */
export function createKit() {
  const floorTexture = woodTexture();
  return {
    floorTexture,
    geometries: {
      box: new BoxGeometry(1, 1, 1),
      roundTop: new CylinderGeometry(0.5, 0.5, 0.05, 20),
      leg: new CylinderGeometry(0.04, 0.05, 1, 6),
      seat: new BoxGeometry(0.42, 0.06, 0.42),
      back: new BoxGeometry(0.42, 0.42, 0.05),
      ring: new RingGeometry(0.5, 0.58, 32),
      plane: new PlaneGeometry(1, 1),
    },
    materials: {
      floor: new MeshLambertMaterial({ map: floorTexture }),
      grass: new MeshLambertMaterial({ color: "#8fb07b" }),
      wall: new MeshLambertMaterial({ color: "#efe6da" }),
      // Unlit: facing down, a lit ceiling would take the dark ground colour of the hemisphere.
      ceiling: new MeshBasicMaterial({ color: "#f1e9de", side: DoubleSide }),
      window: new MeshBasicMaterial({ color: "#bcd6dc", transparent: true, opacity: 0.55 }),
      fence: new MeshLambertMaterial({ color: "#7a634f" }),
      counter: new MeshLambertMaterial({ color: "#5a4538" }),
      wood: new MeshLambertMaterial({ color: "#d9b98f" }),
      darkWood: new MeshLambertMaterial({ color: "#6d5241" }),
      chair: new MeshLambertMaterial({ color: "#8a6a52" }),
      door: new MeshLambertMaterial({ color: "#c8b9a9" }),
      ring: new MeshBasicMaterial({ color: "#ffffff", side: DoubleSide }),
    },
  };
}

/**
 * Builds one area. Returns the group, the obstacles for collision, and the instanced meshes that
 * show table state, with a lookup from instance index to table.
 * @param {VirtualArea} area
 * @param {ReturnType<typeof createKit>} kit
 */
export function buildArea(area, kit) {
  const group = new Group(),
    { geometries: g, materials: m } = kit,
    outdoor = area.kind === "outdoor";
  group.name = `area:${area.id}`;

  // Floor.
  const floor = new Mesh(g.plane, outdoor ? m.grass : m.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.scale.set(area.width, area.depth, 1);
  if (!outdoor) kit.floorTexture.repeat.set(area.width / 2, area.depth / 2);
  group.add(floor);

  // Walls (indoor) or a low fence (outdoor), with a door gap on the near side.
  const height = outdoor ? 1 : WALL_HEIGHT,
    material = outdoor ? m.fence : m.wall,
    thickness = 0.12,
    wall = (x, z, width, depth, mat = material, h = height, y = h / 2) => {
      const mesh = new Mesh(g.box, mat);
      mesh.scale.set(width, h, depth);
      mesh.position.set(x, y, z);
      group.add(mesh);
    };
  const halfW = area.width / 2,
    halfD = area.depth / 2,
    door = area.entrance;
  // Each wall runs along x (top, bottom) or z (left, right). The door's wall has a gap; the
  // window's wall is a low sill with glass above; the rest are solid.
  for (const side of /** @type {const} */ (["top", "right", "bottom", "left"])) {
    const alongX = side === "top" || side === "bottom",
      length = alongX ? area.width : area.depth,
      at = side === "top" ? -halfD : side === "bottom" ? halfD : side === "left" ? -halfW : halfW,
      // A stretch of this wall from `from` to `to` (metres along it, centred on the room).
      piece = (from, to, mat = material, h = height, y = h / 2) =>
        to - from > 0.01 &&
        (alongX
          ? wall((from + to) / 2, at, to - from, thickness, mat, h, y)
          : wall(at, (from + to) / 2, thickness, to - from, mat, h, y));
    if (side === door.side) {
      const centre = alongX ? door.x : door.z;
      piece(-length / 2, centre - door.width / 2);
      piece(centre + door.width / 2, length / 2);
    } else if (side === area.windowSide && !outdoor) {
      piece(-length / 2, length / 2, m.wall, 0.6);
      piece(-length / 2, length / 2, m.window, WALL_HEIGHT - 0.6, 0.6 + (WALL_HEIGHT - 0.6) / 2);
    } else piece(-length / 2, length / 2);
  }
  if (!outdoor) {
    const ceiling = new Mesh(g.plane, m.ceiling);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT;
    ceiling.scale.set(area.width, area.depth, 1);
    group.add(ceiling);
    // A mat just inside the door.
    const inward = inwardOf(door.side),
      mat = new Mesh(g.plane, m.door);
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(door.x + inward.x * 0.6, 0.005, door.z + inward.z * 0.6);
    mat.scale.set(inward.x ? 1.1 : door.width, inward.x ? door.width : 1.1, 1);
    group.add(mat);
  }

  /** @type {{ x: number, z: number, width: number, depth: number }[]} */
  const obstacles = [];
  if (area.counter) {
    const c = area.counter;
    wall(c.x, c.z, c.width, c.depth, m.counter, 1.1);
    obstacles.push({ x: c.x, z: c.z, width: c.width, depth: c.depth });
  }

  const tables = buildTables(area.tables, kit);
  group.add(tables.group);
  for (const table of area.tables)
    obstacles.push({
      x: table.position.x,
      z: table.position.z,
      // Chairs stand around the table; keep visitors just outside them.
      width: table.size.width + 0.5,
      depth: table.size.depth + 0.5,
    });
  return {
    group,
    obstacles,
    pickable: tables.pickable,
    pick: tables.pick,
    paint: tables.paint,
    dispose: tables.dispose,
  };
}

/**
 * Tables, chairs, state rings and number labels. Table parts, chairs and rings are instanced: one
 * draw call each, however many tables there are.
 * @param {VirtualTable[]} tables
 * @param {ReturnType<typeof createKit>} kit
 */
function buildTables(tables, kit) {
  const group = new Group(),
    { geometries: g, materials: m } = kit,
    holder = new Object3D(),
    matrix = new Matrix4(),
    round = tables.filter((t) => t.shape === "round"),
    boxy = tables.filter((t) => t.shape !== "round"),
    chairCount = tables.reduce((sum, t) => sum + t.capacity, 0);

  const roundTops = new InstancedMesh(g.roundTop, m.wood, Math.max(1, round.length)),
    boxTops = new InstancedMesh(g.box, m.wood, Math.max(1, boxy.length)),
    legs = new InstancedMesh(g.leg, m.darkWood, Math.max(1, tables.length)),
    seats = new InstancedMesh(g.seat, m.chair, Math.max(1, chairCount)),
    backs = new InstancedMesh(g.back, m.chair, Math.max(1, chairCount)),
    rings = new InstancedMesh(g.ring, m.ring, Math.max(1, tables.length));
  roundTops.count = round.length;
  boxTops.count = boxy.length;
  legs.count = tables.length;
  seats.count = backs.count = chairCount;
  rings.count = tables.length;

  /** Instance index → table, for picking. */
  const pick = new Map();
  round.forEach((t, i) => {
    holder.position.set(t.position.x, TABLE_HEIGHT, t.position.z);
    holder.rotation.set(0, t.rotation, 0);
    holder.scale.set(t.size.width, 1, t.size.depth);
    holder.updateMatrix();
    roundTops.setMatrixAt(i, holder.matrix);
  });
  boxy.forEach((t, i) => {
    holder.position.set(t.position.x, TABLE_HEIGHT, t.position.z);
    holder.rotation.set(0, t.rotation, 0);
    holder.scale.set(t.size.width, 0.05, t.size.depth);
    holder.updateMatrix();
    boxTops.setMatrixAt(i, holder.matrix);
  });
  let chair = 0;
  tables.forEach((t, i) => {
    matrix.makeScale(1, TABLE_HEIGHT, 1).setPosition(t.position.x, TABLE_HEIGHT / 2, t.position.z);
    legs.setMatrixAt(i, matrix);
    holder.position.set(t.position.x, 0.01, t.position.z);
    holder.rotation.set(-Math.PI / 2, 0, 0);
    const reach = Math.max(t.size.width, t.size.depth) * 0.75 + 0.45;
    holder.scale.set(reach, reach, 1);
    holder.updateMatrix();
    rings.setMatrixAt(i, holder.matrix);
    pick.set(`ring:${i}`, t);
    for (const place of chairPlaces(t)) {
      holder.position.set(place.x, SEAT_HEIGHT, place.z);
      holder.rotation.set(0, place.facing, 0);
      holder.scale.set(1, 1, 1);
      holder.updateMatrix();
      seats.setMatrixAt(chair, holder.matrix);
      // The back sits on the far side of the seat from the table.
      holder.position.set(
        place.x + Math.sin(place.facing) * 0.21,
        SEAT_HEIGHT + 0.24,
        place.z + Math.cos(place.facing) * 0.21,
      );
      holder.updateMatrix();
      backs.setMatrixAt(chair, holder.matrix);
      chair++;
    }
  });
  round.forEach((t, i) => pick.set(`round:${i}`, t));
  boxy.forEach((t, i) => pick.set(`box:${i}`, t));
  roundTops.userData.kind = "round";
  boxTops.userData.kind = "box";
  rings.userData.kind = "ring";
  for (const mesh of [roundTops, boxTops, legs, seats, backs, rings]) {
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  // Number labels above each table: one small canvas each, drawn once.
  const labels = tables.map((t) => {
    const sprite = new Sprite(new SpriteMaterial({ map: labelTexture(t), depthTest: false }));
    sprite.position.set(t.position.x, TABLE_HEIGHT + 0.65, t.position.z);
    sprite.scale.set(0.9, 0.45, 1);
    sprite.renderOrder = 10;
    group.add(sprite);
    return sprite;
  });

  return {
    group,
    pickable: [roundTops, boxTops, rings],
    pick,
    /** @param {Map<string, VirtualTableState>} states @param {string | null} focused */
    paint(states, focused) {
      tables.forEach((t, i) => {
        const color = STATE_COLORS[states.get(t.tableId) || "UNKNOWN"].clone();
        if (t.tableId === focused) color.offsetHSL(0, 0.05, 0.12);
        rings.setColorAt(i, color);
      });
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
    },
    dispose() {
      for (const sprite of labels) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      for (const mesh of [roundTops, boxTops, legs, seats, backs, rings]) mesh.dispose();
    },
  };
}

/** The unit step from a wall into the room. @param {"top" | "right" | "bottom" | "left"} side */
export function inwardOf(side) {
  return side === "top"
    ? { x: 0, z: 1 }
    : side === "bottom"
      ? { x: 0, z: -1 }
      : side === "left"
        ? { x: 1, z: 0 }
        : { x: -1, z: 0 };
}

/** Chair positions around a table, each facing the table. @param {VirtualTable} t */
export function chairPlaces(t) {
  const places = [],
    n = t.capacity;
  if (t.shape === "round") {
    const radius = t.size.width / 2 + 0.32;
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      places.push({
        x: t.position.x + Math.sin(angle) * radius,
        z: t.position.z + Math.cos(angle) * radius,
        facing: angle,
      });
    }
    return places;
  }
  // Square and long tables: chairs along the two long sides, alternating.
  const along = t.size.width >= t.size.depth,
    long = along ? t.size.width : t.size.depth,
    short = along ? t.size.depth : t.size.width,
    perSide = [Math.ceil(n / 2), Math.floor(n / 2)];
  perSide.forEach((count, side) => {
    for (let i = 0; i < count; i++) {
      const offset = ((i + 0.5) / count - 0.5) * long,
        out = (side ? -1 : 1) * (short / 2 + 0.32);
      places.push(
        along
          ? { x: t.position.x + offset, z: t.position.z + out, facing: side ? Math.PI : 0 }
          : {
              x: t.position.x + out,
              z: t.position.z + offset,
              facing: side ? -Math.PI / 2 : Math.PI / 2,
            },
      );
    }
  });
  return places;
}

/** Light wooden planks, drawn on a 256 px canvas: no image download. */
function woodTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  const tones = ["#e8d6bd", "#e3cfb3", "#ecdcc5", "#dfc9ab"];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = tones[i];
    ctx.fillRect(0, i * 64, 256, 64);
    ctx.fillStyle = "rgba(120, 86, 52, 0.18)";
    ctx.fillRect(0, i * 64, 256, 2);
    ctx.fillRect(((i * 97) % 256) | 0, i * 64, 2, 64);
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The table's number and size on a small label. @param {VirtualTable} t */
function labelTexture(t) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  ctx.fillStyle = "rgba(23, 18, 16, 0.82)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 112, 28);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.font = "700 46px Vazirmatn, Tahoma, sans-serif";
  ctx.fillText(t.name, 128, 62);
  ctx.font = "400 30px Vazirmatn, Tahoma, sans-serif";
  ctx.fillStyle = "#e7ad78";
  ctx.fillText(`${new Intl.NumberFormat("fa-IR").format(t.capacity)} نفره`, 128, 104);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
