// Entry of the separate /floor3d.js bundle: exposes the scene to the booking page's loader.
import { createFloor } from "./engine.js";

/** @type {any} */ (globalThis).MizoFloor = { createFloor };
