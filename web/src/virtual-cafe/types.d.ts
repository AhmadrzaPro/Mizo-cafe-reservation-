// Contracts between the booking page and the Virtual Cafe. The engine (a separate bundle) sees only
// these shapes; it never imports booking or state modules.

/** Availability of a table, always taken from the backend. */
export type VirtualTableState = "AVAILABLE" | "UNAVAILABLE" | "SELECTED" | "UNKNOWN";

/** A real Mizo table placed in the 3D scene. Units are metres; y is up. */
export interface VirtualTable {
  /** The real table's full id, `branch:<cafe>:<branch>:<table>`, as availability and booking use it. */
  tableId: string;
  branchId: string;
  areaId: string;
  /** "میز ۳، سالن اصلی": what the booking flow shows for the chosen table. */
  label: string;
  name: string;
  areaName: string;
  capacity: number;
  shape: "round" | "square" | "rect";
  /** Centre of the table top on the floor. */
  position: { x: number; y: number; z: number };
  rotation: number;
  /** Footprint in metres. */
  size: { width: number; depth: number };
  reservable: boolean;
  /** Within reach of the window wall. */
  nearWindow: boolean;
}

export interface VirtualArea {
  id: string;
  name: string;
  kind: "indoor" | "outdoor";
  width: number;
  depth: number;
  tables: VirtualTable[];
  /** Counter footprint (indoor only), metres from the area centre. */
  counter: { x: number; z: number; width: number; depth: number } | null;
  /** Where the door is on the near wall, and where a visitor starts. */
  entrance: { x: number; z: number; width: number };
}

export interface VirtualScene {
  branchId: string;
  areas: VirtualArea[];
}

/** What the engine reports and needs from the page. */
export interface EngineOptions {
  scene: VirtualScene;
  areaId: string;
  states: Map<string, VirtualTableState>;
  reducedMotion: boolean;
  debug: boolean;
  /** The table in front of the visitor, or null. */
  onFocus: (tableId: string | null) => void;
  /** The visitor tapped or clicked a table, or pressed Enter in front of one. */
  onSelect: (tableId: string) => void;
  onStats?: (stats: { fps: number; drawCalls: number; triangles: number }) => void;
  onError: (error: unknown) => void;
}

export interface EngineController {
  setStates(states: Map<string, VirtualTableState>): void;
  setArea(areaId: string): void;
  dispose(): void;
}

export interface VirtualCafeEngine {
  mount(container: HTMLElement, options: EngineOptions): EngineController;
}
