// The Virtual Cafe on the booking page: the entry button, the full-screen dialog, loading and
// fallback, the table card, and the hand-off to standard booking. It loads the 3D engine only when
// opened and degrades to the 2D map on any failure.
import { byId, html, setHtml } from "../dom.js";
import { faDigits } from "../format.js";
import { state, store } from "../state.js";
import {
  currentBranch,
  getTableAvailability,
  refreshAvailability,
  startBooking,
  tableStates,
  virtualScene,
} from "./adapter.js";
import { loadEngine, VirtualCafeError, webglAvailable } from "./loader.js";
import { track } from "./telemetry.js";

/** @typedef {import("./types").VirtualTableState} VirtualTableState */
/** @typedef {import("./types").VirtualTable} VirtualTable */
/** @typedef {import("./types").VirtualScene} VirtualScene */

const dialog = byId("virtualCafeDialog"),
  debugEnabled = new URLSearchParams(globalThis.location?.search).get("vcdebug") === "1";

/**
 * The open Virtual Cafe, if any.
 * @type {{ cancelled: boolean, scene: VirtualScene, areaId: string,
 *   states: Map<string, VirtualTableState>, selected: VirtualTable | null,
 *   controller: import("./types").EngineController | null, openedAt: number } | null}
 */
let session = null;

const STATE_TEXT = {
  AVAILABLE: "آزاد برای ساعت انتخابی",
  UNAVAILABLE: "در این ساعت آزاد نیست",
  SELECTED: "انتخاب شما",
  UNKNOWN: "وضعیت نامشخص",
};
const FAILURE_TEXT = {
  webgl_unavailable: "مرورگر یا دستگاه شما نمایش سه‌بعدی را پشتیبانی نمی‌کند.",
  load_failed: "بارگیری کافه مجازی انجام نشد.",
  load_timeout: "بارگیری کافه مجازی بیش از حد طول کشید.",
  no_tables: "هنوز میزی برای نمایش سه‌بعدی این شعبه ثبت نشده است.",
  runtime: "نمایش سه‌بعدی متوقف شد.",
};

/** Shows the entry button when the café offers the Virtual Cafe. */
export function applyVirtualCafeSetting() {
  byId("openVirtualCafe").hidden = !store.cafeSettings.virtualCafeEnabled;
}

export function wireVirtualCafe() {
  byId("openVirtualCafe").addEventListener("click", openVirtualCafe);
  byId("virtualCafeBack").addEventListener("click", () => closeVirtualCafe("back"));
  byId("virtualCafeStandard").addEventListener("click", () => closeVirtualCafe("standard"));
  byId("virtualCafeRetry").addEventListener("click", async () => {
    closeVirtualCafe("retry");
    await openVirtualCafe();
  });
  byId("virtualTableClose").addEventListener("click", hideCard);
  byId("virtualTableReserve").addEventListener("click", reserveSelected);
  byId("virtualTableListToggle").addEventListener("click", () => {
    const list = byId("virtualTableList"),
      open = list.hidden;
    list.hidden = !open;
    byId("virtualTableListToggle").setAttribute("aria-expanded", String(open));
  });
  // Escape closes the dialog; tidy up the same way as the back button.
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeVirtualCafe("back");
  });
}

export async function openVirtualCafe() {
  if (session) return;
  const scene = virtualScene(),
    tables = scene.areas.flatMap((area) => area.tables);
  session = {
    cancelled: false,
    scene,
    areaId:
      scene.areas.find((a) => a.id === store.customerArea && a.tables.length)?.id ||
      scene.areas.find((a) => a.tables.length)?.id ||
      scene.areas[0]?.id ||
      "",
    states: new Map(),
    selected: null,
    controller: null,
    openedAt: performance.now(),
  };
  const opened = session;
  track("virtual_cafe_opened", { branchId: scene.branchId });
  byId("virtualCafeSummary").textContent = state.time
    ? `${state.dateLabel}، ساعت ${faDigits(state.time)} · ${faDigits(state.guests)} نفر`
    : "";
  hideCard();
  showStatus("loading");
  dialog.showModal();
  try {
    if (!tables.length) throw new VirtualCafeError("no_tables");
    if (!webglAvailable()) throw new VirtualCafeError("webgl_unavailable");
    const [engine] = await Promise.all([loadEngine(), refreshStates(opened)]);
    if (opened.cancelled) return;
    renderAreaTabs();
    renderTableList();
    opened.controller = engine.mount(byId("virtualCafeStage"), {
      scene,
      areaId: opened.areaId,
      states: opened.states,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      debug: debugEnabled,
      onFocus: showFocusHint,
      onSelect: (tableId) => selectTable(tableId),
      onStats: debugEnabled ? renderDebug : undefined,
      onError: (error) => fail(opened, error),
    });
    hideStatus();
    track("virtual_cafe_loaded", {
      branchId: scene.branchId,
      ms: Math.round(performance.now() - opened.openedAt),
    });
  } catch (error) {
    fail(opened, error);
  }
}

/** Closes the Virtual Cafe and frees the engine; the 2D map underneath is unchanged. */
export function closeVirtualCafe(why = "back") {
  const closing = session;
  session = null;
  if (closing) {
    closing.cancelled = true;
    closing.controller?.dispose();
    track("virtual_cafe_exited", { reason: why });
  }
  byId("virtualCafeStage").replaceChildren();
  if (dialog.open) dialog.close();
}

/** Any failure lands here: the engine is freed and standard booking is offered. */
function fail(opened, error) {
  if (opened.cancelled || session !== opened) return;
  opened.controller?.dispose();
  opened.controller = null;
  byId("virtualCafeStage").replaceChildren();
  const reason = error instanceof VirtualCafeError ? error.reason : "runtime";
  if (!(error instanceof VirtualCafeError)) console.error("virtual_cafe_failed", error);
  track("virtual_cafe_load_failed", { reason });
  showStatus("failed", FAILURE_TEXT[reason]);
}

/** Reads availability from the backend and repaints the tables. */
async function refreshStates(opened = session) {
  if (!opened) return;
  await refreshAvailability();
  if (opened.cancelled) return;
  opened.states = tableStates(opened.scene);
  if (opened.selected && opened.states.get(opened.selected.tableId) === "AVAILABLE")
    opened.states.set(opened.selected.tableId, "SELECTED");
  opened.controller?.setStates(opened.states);
  renderTableList();
}

/** @param {"loading" | "failed"} kind @param {string} [text] */
function showStatus(kind, text = "") {
  const box = byId("virtualCafeStatus");
  box.hidden = false;
  box.dataset.kind = kind;
  byId("virtualCafeStatusTitle").textContent =
    kind === "loading" ? "در حال آماده‌سازی کافه مجازی…" : "کافه مجازی در دسترس نیست";
  byId("virtualCafeStatusText").textContent =
    kind === "loading"
      ? "چند لحظه صبر کنید. هر زمان خواستید می‌توانید با نقشه معمولی ادامه دهید."
      : `${text} رزرو شما با نقشه معمولی ادامه پیدا می‌کند.`;
  byId("virtualCafeRetry").hidden = kind !== "failed";
}
function hideStatus() {
  byId("virtualCafeStatus").hidden = true;
}

function renderAreaTabs() {
  const opened = session,
    tabs = byId("virtualAreaTabs");
  if (!opened) return;
  tabs.replaceChildren();
  tabs.hidden = opened.scene.areas.length < 2;
  for (const area of opened.scene.areas) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = area.id === opened.areaId ? "active" : "";
    setHtml(
      button,
      html`<span>${area.kind === "outdoor" ? "☀" : "⌂"}</span><b>${area.name}</b
        ><small>${faDigits(area.tables.length)} میز</small>`,
    );
    button.addEventListener("click", () => {
      opened.areaId = area.id;
      opened.controller?.setArea(area.id);
      hideCard();
      renderAreaTabs();
      renderTableList();
    });
    tabs.append(button);
  }
}

/** The same tables as a list: for screen readers, keyboards, and anyone who prefers it. */
function renderTableList() {
  const opened = session,
    list = byId("virtualTableList");
  if (!opened) return;
  const area = opened.scene.areas.find((a) => a.id === opened.areaId);
  list.replaceChildren();
  for (const table of area?.tables || []) {
    const tableState = opened.states.get(table.tableId) || "UNKNOWN",
      button = document.createElement("button");
    button.type = "button";
    button.dataset.tableId = table.tableId;
    button.dataset.state = tableState;
    setHtml(
      button,
      html`<b>${table.name}</b
        ><small>${faDigits(table.capacity)} نفره · ${STATE_TEXT[tableState]}</small>`,
    );
    button.addEventListener("click", () => {
      list.hidden = true;
      byId("virtualTableListToggle").setAttribute("aria-expanded", "false");
      selectTable(table.tableId);
    });
    list.append(button);
  }
}

/** @param {string | null} tableId */
function showFocusHint(tableId) {
  const table = tableId ? findTable(tableId) : null,
    hint = byId("virtualCafeHint");
  if (!table || !session) {
    hint.textContent = "با حرکت در کافه به میزی نزدیک شوید یا روی آن بزنید.";
    return;
  }
  hint.textContent = `${table.name} · ${faDigits(table.capacity)} نفره · ${STATE_TEXT[session.states.get(table.tableId) || "UNKNOWN"]}. برای جزئیات روی میز بزنید.`;
}

/** Opens the card for a table, after reading its latest availability from the backend. */
async function selectTable(tableId) {
  const opened = session,
    table = findTable(tableId);
  if (!opened || !table) return;
  opened.selected = table;
  track("virtual_table_selected", { tableId });
  renderCard(table, "UNKNOWN", true);
  const now = await getTableAvailability(tableId);
  if (opened.cancelled || opened.selected !== table) return;
  opened.states = tableStates(opened.scene);
  if (now === "AVAILABLE") opened.states.set(tableId, "SELECTED");
  opened.controller?.setStates(opened.states);
  renderTableList();
  renderCard(table, now, false);
  if (now === "UNAVAILABLE") track("virtual_table_unavailable", { tableId });
}

/** @param {VirtualTable} table @param {VirtualTableState} tableState @param {boolean} checking */
function renderCard(table, tableState, checking) {
  const card = byId("virtualTableCard"),
    reserve = byId("virtualTableReserve");
  card.hidden = false;
  card.dataset.state = checking ? "checking" : tableState;
  byId("virtualTableName").textContent = table.name;
  byId("virtualTableMeta").textContent = [
    `${faDigits(table.capacity)} نفره`,
    table.areaName,
    table.nearWindow ? "کنار پنجره" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  byId("virtualTableState").textContent = checking
    ? "در حال بررسی آخرین وضعیت…"
    : !state.time
      ? "ساعت انتخابی دیگر آزاد نیست؛ با نقشه معمولی ساعت دیگری انتخاب کنید."
      : STATE_TEXT[tableState];
  reserve.disabled = checking || tableState !== "AVAILABLE" || store.mapPreviewMode;
  reserve.textContent = "رزرو این میز";
}
function hideCard() {
  byId("virtualTableCard").hidden = true;
  if (session) session.selected = null;
}

/** Hands the selected table to the standard booking flow, which the backend validates again. */
async function reserveSelected() {
  const opened = session,
    table = opened?.selected;
  if (!opened || !table) return;
  const reserve = byId("virtualTableReserve");
  reserve.disabled = true;
  reserve.textContent = "در حال بررسی…";
  track("virtual_booking_started", { tableId: table.tableId });
  const started = await startBooking(table, () => closeVirtualCafe("booking"));
  if (started || opened.cancelled) return;
  // Taken meanwhile: show it, and the fresh state of every table.
  track("virtual_table_unavailable", { tableId: table.tableId });
  await refreshStates(opened);
  renderCard(table, "UNAVAILABLE", false);
}

/** @param {string} tableId */
function findTable(tableId) {
  if (!session || !tableId.startsWith(`${currentBranch().branchId}:`)) return null;
  for (const area of session.scene.areas)
    for (const table of area.tables) if (table.tableId === tableId) return table;
  return null;
}

/** Development panel: only with ?vcdebug=1, never in the normal customer page. */
function renderDebug(stats) {
  const panel = byId("virtualCafeDebug");
  panel.hidden = false;
  const selected = session?.selected;
  panel.textContent = [
    `FPS ${stats.fps}`,
    `draw calls ${stats.drawCalls}`,
    `triangles ${stats.triangles}`,
    `scene ${session?.scene.branchId}`,
    `area ${session?.areaId}`,
    `table ${selected?.tableId || "—"}`,
    `state ${selected ? session?.states.get(selected.tableId) : "—"}`,
  ].join("\n");
}
