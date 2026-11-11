// The café's booking page: a 3D floor with the day, time and party on top, and a panel to pick a
// table and book it. Staff with map rights switch the same view to "چینش کافه" to arrange the
// floor. Real data throughout: the branch's floor, availability, holds, bookings and deposits.
import { apiUrl, cafeBaseUrl, reservationsUrl } from "../api.js";
import { adminDialog } from "../dialogs.js";
import { byId, html, setHtml } from "../dom.js";
import { faDigits, formatTehranTime, formatToman, latinDigits } from "../format.js";
import { hasManagerPermission } from "../manager.js";
import { tehranClientNow } from "../operations.js";
import { followGatewayRedirect, payButtonLabel, payingLabel } from "../payment-flow.js";
import { state, store } from "../state.js";
import { forgetHold, holdTable, releaseHold, startCountdown } from "../table-hold.js";
import { loadEngine } from "./loader.js";
import {
  DECOR,
  TAGS,
  TYPES,
  ZONES,
  clampPos,
  exportLayout,
  fits,
  newTableId,
  nextName,
  overlaps,
  seatsOf,
  snap,
  tablesOf,
  zoneOf,
} from "./model.js";

/** @typedef {import("./engine.js").SceneItem} Item */
const COL = {
  free: "#2fb87b",
  busy: "#f0a33a",
  off: "#cfc5bb",
  sel: "#7a4b2a",
  edit: "#b9a999",
  warn: "#e03131",
};
const app = () => byId("floorApp");
/** @type {import("./engine.js").FloorScene | null} */
let scene = null;
let engineState = "idle"; // idle | loading | ready | failed
/** @type {import("./model.js").FloorLayout & { items: Item[] }} */
let layout = { room: { w: 16, d: 11, terrace: 0 }, items: [] };
let savedJSON = "";
/** A refusal from the server, kept so it survives the panel being redrawn with fresh data. */
let panelNote = "";
let mode = "book",
  zone = "all",
  topView = false,
  /** @type {Item | null} */ selected = null,
  /** @type {Item | null} */ eSel = null,
  /** @type {string | null} */ panelMode = null,
  listOpen = false;
const form = { name: "", phone: "", note: "" };
/** @type {{ item: Item, data: any, mobile: string, time: string, date: string, party: number } | null} */
let lastBooking = null;

const fullId = (t) => `branch:${store.currentCafeSlug}:${store.currentBranch}:${t.id}`;
const dirty = () => JSON.stringify(exportLayout(layout)) !== savedJSON;
const canEdit = () => hasManagerPermission("map.write");
const tables = () => /** @type {Item[]} */ (tablesOf(layout));
const timeLabel = (time) => faDigits(time || "");
/** "میز ۵" or "میز T5": a label is shown with the word table once. */
const titleOf = (t) => (/^میز/.test(t.name || "") ? t.name : `میز ${t.name}`);
const party = () => state.guests;
const bookingOpen = () =>
  store.cafeSettings.reservationsEnabled && !store.cafeSettings.onlineBookingPaused;

/* ------------------------------------------------------------------ data */

/** The next seven days on Tehran's calendar. */
function days() {
  const today = tehranClientNow().date;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const fmt = (o) =>
      new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "UTC", ...o }).format(d);
    return {
      date: d.toISOString().slice(0, 10),
      label: i === 0 ? "امروز" : i === 1 ? "فردا" : fmt({ weekday: "long" }),
      sub: fmt({ day: "numeric", month: "long" }),
    };
  });
}
const dayOf = (date) => days().find((d) => d.date === date) || { label: date, sub: "" };
/** @returns {{ time: string, available: boolean, tableIds: string[], remaining: number }[]} */
const slots = () => state.availability?.slots || [];
const slotAt = (time) => slots().find((s) => s.time === time);
const freeAt = (t, time) => Boolean(slotAt(time)?.tableIds.includes(fullId(t)));
const suits = (t) => fits(layout, t, party(), zone);
/** @param {Item} t */
function stateOf(t) {
  if (t.reservable === false || (t.operationalStatus || "available") !== "available") return "off";
  if (!suits(t)) return "off";
  return freeAt(t, state.time) ? "free" : "busy";
}

/** Loads the branch's floor and draws it. */
export async function loadFloor() {
  const branch = store.currentBranch;
  try {
    const response = await fetch(apiUrl());
    if (!response.ok || branch !== store.currentBranch) return;
    const data = await response.json();
    layout = { room: data.room, items: data.items };
    savedJSON = JSON.stringify(exportLayout(layout));
    selected = eSel = null;
    closePanel();
    scene?.setLayout(layout);
    repaint();
  } catch {
    toast("دریافت نقشه‌ی کافه ممکن نشد.");
  }
}

/** Fetches the day's free tables for the party, and redraws. */
export async function refreshFloor() {
  const requestId = ++store.availabilityRequest;
  if (!state.date) state.date = days()[0].date;
  try {
    const response = await fetch(
        `${cafeBaseUrl()}/availability?date=${state.date}&party_size=${party()}`,
      ),
      data = await response.json();
    if (requestId !== store.availabilityRequest) return;
    if (!response.ok) throw new Error(data.message);
    // Times already past today are not offered at all.
    const now = tehranClientNow(),
      clock = `${String(now.hour).padStart(2, "0")}:${String(now.minute).padStart(2, "0")}`;
    if (data.date === now.date) data.slots = (data.slots || []).filter((s) => s.time > clock);
    state.availability = data;
    const list = data.slots || [];
    if (!list.some((s) => s.time === state.time && s.available))
      state.time =
        list.find(
          (s) =>
            s.available &&
            s.tableIds.some((id) => tables().some((t) => fullId(t) === id && suits(t))),
        )?.time ||
        list.find((s) => s.available)?.time ||
        list[0]?.time ||
        "";
  } catch {
    if (requestId !== store.availabilityRequest) return;
    state.availability = {
      date: state.date,
      closed: true,
      reason: "دریافت ظرفیت ممکن نشد؛ دوباره تلاش کنید.",
      slots: [],
    };
  }
  state.availableTableIds = new Set(slotAt(state.time)?.tableIds || []);
  repaint();
  if (mode === "book" && selected && panelMode === "table") tablePanel(selected);
}

/* ------------------------------------------------------------------ drawing */

function repaint() {
  renderTop();
  renderList();
  scene?.paint((it) => {
    if (it.kind === "decor") return { color: COL.sel, selected: mode === "edit" && eSel === it };
    if (mode === "edit") {
      const bad = overlaps(layout, it);
      return {
        color: eSel === it ? COL.sel : bad ? COL.warn : COL.edit,
        warn: bad,
        selected: eSel === it,
      };
    }
    const st = stateOf(it),
      sel = selected === it;
    return {
      color: sel ? COL.sel : COL[st],
      off: st === "off" && !sel,
      pulse: st === "free" && !sel,
    };
  });
}

function renderTop() {
  const root = app();
  root.dataset.mode = mode;
  byId("floorMode").hidden = !canEdit();
  byId("floorMode")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
  if (mode === "edit") {
    renderEditTools();
    return;
  }
  setHtml(
    byId("floorDays"),
    html`<span class="lbl">روز</span>${days().map(
        (d) =>
          html`<button
            type="button"
            class="chip ${d.date === state.date ? "on" : ""}"
            data-d="${d.date}"
          >
            ${d.label}<small><bdi>${d.sub}</bdi></small>
          </button>`,
      )}`,
  );
  const data = state.availability;
  setHtml(
    byId("floorHours"),
    !data
      ? html`<span class="lbl">در حال بررسی ظرفیت…</span>`
      : data.closed || !data.slots.length
        ? html`<span class="lbl">${data.reason || "در این روز زمان آزادی نیست."}</span>`
        : html`<span class="lbl">ساعت</span>${data.slots.map((s) => {
              const free = tables().filter(
                (t) => suits(t) && s.tableIds.includes(fullId(t)),
              ).length;
              return html`<button
                type="button"
                class="chip ${s.time === state.time ? "on" : ""}"
                data-h="${s.time}"
              >
                <bdi>${timeLabel(s.time)}</bdi
                ><small><bdi>${free ? `${faDigits(free)} میز` : "پر"}</bdi></small>
              </button>`;
            })}`,
  );
  byId("floorParty").textContent = `${faDigits(party())} نفر`;
  const present = Object.keys(ZONES).filter((k) => tables().some((t) => zoneOf(layout, t) === k));
  setHtml(
    byId("floorZones"),
    present.length > 1
      ? html`${[["all", "همه"], ...present.map((k) => [k, ZONES[k]])].map(
          ([k, v]) =>
            html`<button type="button" class="chip ${zone === k ? "on" : ""}" data-z="${k}">
              ${v}
            </button>`,
        )}`
      : "",
  );
  const all = tables().filter((t) => t.reservable !== false),
    free = all.filter((t) => freeAt(t, state.time)).length;
  setHtml(
    byId("floorStats"),
    state.time
      ? html`<div>
          میز آزاد ${timeLabel(state.time)}<b>${faDigits(free)} از ${faDigits(all.length)}</b>
        </div>`
      : "",
  );
  const notice = byId("floorNotice"),
    message = !bookingOpen()
      ? "رزرو آنلاین این کافه موقتاً متوقف است."
      : store.cafeSettings.customerNotice || "";
  notice.textContent = message;
  notice.hidden = !message;
  byId("floorListToggle").classList.toggle("on", listOpen || engineState === "failed");
}

/** The tables as a list: for anyone who prefers it, and where the 3D view cannot run. */
function renderList() {
  const list = byId("floorList"),
    open = mode === "book" && (listOpen || engineState === "failed");
  list.hidden = !open;
  if (!open) return;
  const names = { free: "آزاد", busy: "رزرو شده", off: "نامناسب" };
  setHtml(
    list,
    html`<h3>میزهای کافه</h3>
      ${tables().map((t) => {
        const st = stateOf(t);
        return html`<button
          type="button"
          class="list-table ${st} ${selected === t ? "on" : ""}"
          data-pick="${t.id}"
        >
          <i></i><b>${t.name}</b
          ><span>${faDigits(seatsOf(t))} نفره · ${ZONES[zoneOf(layout, t)]}</span
          ><em>${names[st]}</em>
        </button>`;
      })}`,
  );
}

/* ------------------------------------------------------------------ booking panel */

const panel = () => byId("floorPanel");
function openPanel() {
  app().classList.add("sheet");
  panel().classList.add("open");
}
function closePanel() {
  app().classList.remove("sheet");
  panel().classList.remove("open");
  if (state.hold && panelMode !== "done") releaseHold();
  selected = null;
  eSel = null;
  panelMode = null;
  scene?.showPin(null);
}
let toastTimer;
/** @param {string} text */
function toast(text) {
  const el = byId("floorToast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function timeline(t) {
  const list = slots();
  if (!list.length) return "";
  return html`<div class="tl" style="grid-template-columns:repeat(${list.length},1fr)">
      ${list.map(
        (s) =>
          html`<button
            type="button"
            class="${s.tableIds.includes(fullId(t)) ? "" : "b"} ${s.time === state.time ? "s" : ""}"
            data-th="${s.time}"
            title="${timeLabel(s.time)}"
          ></button>`,
      )}
    </div>
    <div class="tlx" style="grid-template-columns:repeat(${list.length},1fr)">
      ${list.map((s, i) => html`<span>${i % 4 === 0 ? faDigits(s.time.slice(0, 2)) : ""}</span>`)}
    </div>`;
}

/** @param {Item} t */
function tablePanel(t) {
  panelMode = "table";
  const seats = seatsOf(t),
    zn = zoneOf(layout, t),
    tooSmall = seats < party(),
    tooBig = seats > party() + 3,
    closedTable = t.reservable === false || (t.operationalStatus || "available") !== "available",
    isFree = freeAt(t, state.time) && !closedTable,
    alts = tables()
      .filter((o) => o !== t && stateOf(o) === "free")
      .slice(0, 4),
    nextFree = slots()
      .filter((s) => s.time !== state.time && s.tableIds.includes(fullId(t)))
      .slice(0, 4),
    day = dayOf(state.date);
  setHtml(
    panel(),
    html`<div class="ph">
        <div class="ic">${t.name}</div>
        <div>
          <small>${ZONES[zn]}</small>
          <h3>${titleOf(t)} · ${faDigits(seats)} نفره</h3>
          <p>${day.label} · ساعت ${timeLabel(state.time)}</p>
        </div>
        <button type="button" class="x" data-close aria-label="بستن">✕</button>
      </div>
      ${t.tags?.length ? html`<div class="tags">${t.tags.map((x) => html`<span class="tag">${x}</span>`)}</div>` : ""}
      <div class="status ${closedTable ? "info" : isFree ? "free" : "busy"}">
        ${
          closedTable
            ? "این میز فعلاً رزرو آنلاین نمی‌پذیرد."
            : isFree
              ? "● این میز در این ساعت آزاد است"
              : "● این میز در این ساعت رزرو شده"
        }
      </div>
      ${panelNote ? html`<p class="err note" id="floorPanelNote" role="alert">${panelNote}</p>` : ""}
      <h4>برنامه‌ی میز در ${day.label}</h4>
      ${timeline(t)}
      ${tooSmall ? html`<p class="err">این میز برای ${faDigits(party())} نفر کوچک است.</p>` : ""}
      ${!bookingOpen() ? html`<p class="err">رزرو آنلاین این کافه موقتاً متوقف است.</p>` : ""}
      ${
        isFree && !tooSmall && bookingOpen()
          ? html`<h4>اطلاعات رزرو</h4>
              <form id="floorBookForm" class="book-form" novalidate>
                <div class="two">
                  <div class="field">
                    <label for="f-name">نام</label
                    ><input
                      id="f-name"
                      class="input"
                      value="${form.name}"
                      placeholder="نام شما"
                      autocomplete="name"
                      maxlength="70"
                    />
                  </div>
                  <div class="field">
                    <label for="f-phone">موبایل</label
                    ><input
                      id="f-phone"
                      class="input"
                      dir="ltr"
                      inputmode="tel"
                      value="${form.phone}"
                      placeholder="09…"
                      autocomplete="tel"
                      maxlength="14"
                    />
                  </div>
                </div>
                <div class="field">
                  <label for="f-note">توضیح (اختیاری)</label
                  ><input
                    id="f-note"
                    class="input"
                    value="${form.note}"
                    placeholder="مثلاً جشن تولد، صندلی کودک"
                    maxlength="240"
                  />
                </div>
                <p class="hold-line" id="f-hold" hidden></p>
                <p id="f-err" class="err" role="alert"></p>
                <div class="acts">
                  <button class="btn p" type="submit" data-book>
                    رزرو برای ${faDigits(party())} نفر · ${timeLabel(state.time)}
                  </button>
                </div>
              </form>`
          : ""
      }
      ${
        !isFree && !closedTable && nextFree.length
          ? html`<h4>ساعت‌های آزاد همین میز</h4>
              <div class="alt">
                ${nextFree.map((s) => html`<button type="button" data-goh="${s.time}"><i></i>ساعت ${timeLabel(s.time)}<span>انتخاب</span></button>`)}
              </div>`
          : ""
      }
      ${
        !isFree && alts.length
          ? html`<h4>میزهای آزاد دیگر در ${timeLabel(state.time)}</h4>
              <div class="alt">
                ${alts.map((o) => html`<button type="button" data-got="${o.id}"><i></i>${titleOf(o)} · ${faDigits(seatsOf(o))} نفره<span>${ZONES[zoneOf(layout, o)]}</span></button>`)}
              </div>`
          : ""
      }
      ${tooBig ? html`<p class="err">این میز برای ${faDigits(party())} نفر بزرگ است؛ میزهای مناسب‌تر سبز شده‌اند.</p>` : ""}`,
  );
  if (state.hold?.tableId === fullId(t)) startCountdown(() => document.getElementById("f-hold"));
  openPanel();
}

function donePanel() {
  if (!lastBooking) return;
  panelMode = "done";
  const { item, data, time, date, party: guests } = lastBooking,
    day = dayOf(date),
    pay = data.payment?.required && !data.payment?.paid;
  setHtml(
    panel(),
    html`<div class="ph">
        <div class="ic">${item.name}</div>
        <div>
          <small>${ZONES[zoneOf(layout, item)]}</small>
          <h3>
            ${pay ? "رزرو در انتظار پرداخت است" : data.status === "confirmed" ? "رزرو تأیید شد" : "درخواست رزرو ثبت شد"}
          </h3>
          <p>
            ${pay ? "میز تا پایان مهلت پرداخت برایتان نگه داشته شده است." : data.status === "confirmed" ? "منتظرتان هستیم!" : "پس از تأیید کافه خبرتان می‌کنیم."}
          </p>
        </div>
        <button type="button" class="x" data-close aria-label="بستن">✕</button>
      </div>
      <div class="ok"><div class="ck">✓</div></div>
      <div class="ticket">
        <div><small>روز</small><b>${day.label} ${day.sub}</b></div>
        <div><small>ساعت</small><b>${timeLabel(time)}</b></div>
        <div><small>میز</small><b>${item.name} · ${ZONES[zoneOf(layout, item)]}</b></div>
        <div><small>تعداد</small><b>${faDigits(guests)} نفر</b></div>
        <div class="code" id="floorTrackingCode">${data.trackingCode}</div>
      </div>
      ${
        pay
          ? html`<p class="pay-note">
                بیعانه: ${formatToman(data.payment.amountRials)} · مهلت پرداخت:
                ${data.payment.dueAt ? faDigits(formatTehranTime(data.payment.dueAt)) : "—"}
              </p>
              ${data.payment.refundPolicy ? html`<p class="pay-note">${data.payment.refundPolicy}</p>` : ""}
              <div class="acts">
                <button type="button" class="btn p" data-pay>${payButtonLabel(true)}</button>
              </div>`
          : ""
      }
      <p class="err" id="f-payerr" role="alert"></p>
      <div class="acts">
        <button type="button" class="btn" data-copy>کپی جزئیات رزرو</button
        ><button type="button" class="btn" data-close>رزرو دیگر</button>
      </div>`,
  );
  openPanel();
}

/** @param {Item} t */
function selectTable(t) {
  panelNote = "";
  if (state.hold && state.hold.tableId !== fullId(t)) releaseHold();
  selected = t;
  state.tableId = fullId(t);
  state.table = titleOf(t);
  scene?.showPin(t);
  scene?.flyTo(t);
  byId("floorHint").classList.add("gone");
  repaint();
  tablePanel(t);
}

/** Holds the chosen table once the customer starts filling in the form. */
async function holdChosen() {
  if (!selected || state.hold?.tableId === fullId(selected)) return;
  const t = selected,
    held = await holdTable(fullId(t));
  if (selected !== t) return;
  if (!held.ok) {
    toast(held.message);
    if (held.status === 409) await refreshFloor();
    return;
  }
  startCountdown(() => document.getElementById("f-hold"));
}

async function submitBooking() {
  const t = selected,
    err = /** @type {HTMLElement} */ (document.getElementById("f-err")),
    button = /** @type {HTMLButtonElement} */ (panel().querySelector("[data-book]")),
    mobile = latinDigits(form.phone).replace(/\D/g, "");
  if (!t) return;
  if (!form.name.trim()) return void (err.textContent = "نام را وارد کنید.");
  if (!/^09\d{9}$/.test(mobile))
    return void (err.textContent = "شماره موبایل درست نیست (مثلاً 09121234567).");
  button.disabled = true;
  button.textContent = "در حال ثبت رزرو…";
  err.textContent = "";
  try {
    const response = await fetch(reservationsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: form.name.trim(),
          mobile,
          notes: form.note,
          date: state.date,
          time: state.time,
          partySize: party(),
          tableIds: [fullId(t)],
          holdToken: state.hold?.tableId === fullId(t) ? state.hold.token : undefined,
        }),
      }),
      data = await response.json();
    if (response.status === 409) {
      // Someone took the table or the time first; the backend refused. Show the truth.
      panelNote = `${data.message || "این میز همین الان رزرو شد."} میز یا ساعت دیگری را انتخاب کنید.`;
      await refreshFloor();
      if (selected === t && panelMode === "table") tablePanel(t);
      return;
    }
    if (!response.ok) throw new Error(data.message || "ثبت رزرو انجام نشد.");
    forgetHold();
    lastBooking = { item: t, data, mobile, time: state.time, date: state.date, party: party() };
    form.name = form.phone = form.note = "";
    donePanel();
    toast("رزرو ثبت شد ✓");
    refreshFloor();
  } catch (error) {
    err.textContent = /** @type {Error} */ (error).message;
    button.disabled = false;
    button.textContent = `رزرو برای ${faDigits(party())} نفر · ${timeLabel(state.time)}`;
  }
}

async function payDeposit() {
  if (!lastBooking) return;
  const button = /** @type {HTMLButtonElement} */ (panel().querySelector("[data-pay]")),
    err = /** @type {HTMLElement} */ (document.getElementById("f-payerr"));
  button.disabled = true;
  button.textContent = payingLabel();
  try {
    const response = await fetch(
        `/api/reservations/${encodeURIComponent(lastBooking.data.trackingCode)}/pay`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mobile: lastBooking.mobile }),
        },
      ),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "پرداخت انجام نشد.");
    if (followGatewayRedirect(data)) return;
    lastBooking.data = {
      ...lastBooking.data,
      status: data.status,
      payment: { ...lastBooking.data.payment, paid: true },
    };
    donePanel();
    toast("پرداخت انجام شد ✓");
  } catch (error) {
    err.textContent = /** @type {Error} */ (error).message;
    button.disabled = false;
    button.textContent = payButtonLabel();
  }
}

/* ------------------------------------------------------------------ editor */

const ICON = {
  round2: html`<circle cx="16" cy="16" r="6" fill="#a8714a" /><rect
      x="13"
      y="3"
      width="6"
      height="5"
      rx="1.5"
      fill="#d7c3ad"
    /><rect x="13" y="24" width="6" height="5" rx="1.5" fill="#d7c3ad" />`,
  round4: html`<circle cx="16" cy="16" r="7" fill="#a8714a" /><rect
      x="13"
      y="2"
      width="6"
      height="5"
      rx="1.5"
      fill="#d7c3ad"
    /><rect x="13" y="25" width="6" height="5" rx="1.5" fill="#d7c3ad" /><rect
      x="2"
      y="13"
      width="5"
      height="6"
      rx="1.5"
      fill="#d7c3ad"
    /><rect x="25" y="13" width="5" height="6" rx="1.5" fill="#d7c3ad" />`,
  square4: html`<rect x="9" y="9" width="14" height="14" rx="2" fill="#a8714a" /><rect
      x="13"
      y="2"
      width="6"
      height="5"
      rx="1.5"
      fill="#d7c3ad"
    /><rect x="13" y="25" width="6" height="5" rx="1.5" fill="#d7c3ad" /><rect
      x="2"
      y="13"
      width="5"
      height="6"
      rx="1.5"
      fill="#d7c3ad"
    /><rect x="25" y="13" width="5" height="6" rx="1.5" fill="#d7c3ad" />`,
  long6: html`<rect x="4" y="11" width="24" height="10" rx="2" fill="#a8714a" /><g fill="#d7c3ad"
      ><rect x="6" y="4" width="5" height="5" rx="1.5" /><rect
        x="13.5"
        y="4"
        width="5"
        height="5"
        rx="1.5" /><rect x="21" y="4" width="5" height="5" rx="1.5" /><rect
        x="6"
        y="23"
        width="5"
        height="5"
        rx="1.5" /><rect x="13.5" y="23" width="5" height="5" rx="1.5" /><rect
        x="21"
        y="23"
        width="5"
        height="5"
        rx="1.5"
    /></g>`,
  booth4: html`<path d="M4 6h8v20H4z M4 24h20v4H4z" fill="#5a3d6b" /><rect
      x="15"
      y="10"
      width="8"
      height="11"
      rx="2"
      fill="#a8714a"
    />`,
  booth6: html`<path d="M4 3h7v26H4z M4 26h22v4H4z M4 2h22v4H4z" fill="#5a3d6b" /><rect
      x="14"
      y="10"
      width="9"
      height="12"
      rx="2"
      fill="#a8714a"
    />`,
  bar: html`<rect x="3" y="10" width="26" height="8" rx="2" fill="#5b3a26" /><rect
      x="20"
      y="6"
      width="5"
      height="5"
      fill="#c9ccd1"
    /><g fill="#3a2a20"
      ><circle cx="7" cy="23" r="2.4" /><circle cx="13" cy="23" r="2.4" /><circle
        cx="19"
        cy="23"
        r="2.4"
    /></g>`,
  plant: html`<rect x="11" y="20" width="10" height="9" rx="2" fill="#c8a27c" /><ellipse
      cx="16"
      cy="13"
      rx="8"
      ry="10"
      fill="#4f9a62"
    />`,
  vip: html`<rect x="3" y="5" width="26" height="22" rx="3" fill="#7d5236" /><rect
      x="7"
      y="9"
      width="18"
      height="14"
      rx="2"
      fill="#b0473f"
    /><text
      x="16"
      y="19"
      font-size="7"
      text-anchor="middle"
      fill="#fff"
      font-family="sans-serif"
      font-weight="700"
      >VIP</text
    >`,
  room: html`<path d="M5 26V6h22v20z" fill="none" stroke="#7a4b2a" stroke-width="2.5" /><path
      d="M5 20h22"
      stroke="#7a4b2a"
      stroke-width="2"
      stroke-dasharray="3 2"
    />`,
};
const svg = (k) => html`<svg viewBox="0 0 32 32" aria-hidden="true">${ICON[k]}</svg>`;

function renderPalette() {
  setHtml(
    byId("floorPalette"),
    html`${Object.entries(TYPES).map(([k, v]) => html`<button type="button" class="pal" data-add="table:${k}">${svg(k)}${v.label}</button>`)}
      ${Object.entries(DECOR).map(([k, v]) => html`<button type="button" class="pal" data-add="decor:${k}">${svg(k)}${v}</button>`)}
      <button type="button" class="pal room" data-room>${svg("room")}ابعاد سالن</button>`,
  );
}
function renderEditTools() {
  setHtml(
    byId("floorEditTools"),
    html`<button type="button" class="chip" data-et="back">→ پنل مدیریت</button>
      <button type="button" class="chip ${topView ? "on" : ""}" data-et="view">
        ${topView ? "نمای سه‌بعدی" : "نمای از بالا"}
      </button>
      <button type="button" class="chip pri" data-et="save">
        ذخیره و انتشار${dirty() ? html`<span class="dot"></span>` : ""}
      </button>
      <button type="button" class="chip" data-et="json">خروجی / ورودی JSON</button>
      <button type="button" class="chip" data-et="preview">پیش‌نمایش برای مشتری</button>
      <button type="button" class="chip" data-et="undo">برگشت به آخرین ذخیره</button>
      <span class="lbl"
        >${faDigits(tables().length)} میز ·
        ${faDigits(tables().reduce((s, t) => s + seatsOf(t), 0))} صندلی</span
      >`,
  );
}
const rotBlock = (it) =>
  html`<div class="field">
    <label>چرخش <b>${faDigits(it.rot)}°</b></label>
    <div class="rot">
      <button type="button" data-rot="-45">↺ ۴۵°</button
      ><button type="button" data-rot="-15">↺ ۱۵°</button
      ><button type="button" data-rot="15">↻ ۱۵°</button
      ><button type="button" data-rot="45">↻ ۴۵°</button>
    </div>
  </div>`;

/** @param {Item} t */
function tableEditPanel(t) {
  panelMode = "edit-table";
  const bad = overlaps(layout, t);
  setHtml(
    panel(),
    html`<div class="ph">
        <div class="ic">${t.name}</div>
        <div>
          <small>ویرایش میز · ${ZONES[zoneOf(layout, t)]}</small>
          <h3>${titleOf(t)} · ${faDigits(seatsOf(t))} نفره</h3>
          <p>ناحیه از روی جای میز خودکار تعیین می‌شود</p>
        </div>
        <button type="button" class="x" data-close aria-label="بستن">✕</button>
      </div>
      ${bad ? html`<div class="status warn">● این میز با میز دیگری تداخل دارد؛ کمی جابه‌جایش کنید</div>` : ""}
      <div class="field">
        <label for="e-name">شماره / نام میز</label
        ><input id="e-name" class="input" value="${t.name}" maxlength="12" /><span
          id="e-nameerr"
          class="err"
        ></span>
      </div>
      <div class="field">
        <label>نوع میز</label>
        <div class="types">
          ${Object.entries(TYPES).map(([k, v]) => html`<button type="button" data-type="${k}" class="${t.type === k ? "on" : ""}">${v.label}</button>`)}
        </div>
      </div>
      ${rotBlock(t)}
      <div class="field">
        <label>ویژگی‌ها (به مشتری نمایش داده می‌شود)</label>
        <div class="tags">
          ${TAGS.map((x) => html`<button type="button" class="tagbtn ${t.tags?.includes(x) ? "on" : ""}" data-tag="${x}">${x}</button>`)}
        </div>
      </div>
      <label class="toggle-row"
        ><input type="checkbox" id="e-reservable" ${t.reservable === false ? "" : html`checked`} />
        رزرو آنلاین این میز فعال باشد</label
      >
      <div class="acts">
        <button type="button" class="btn" data-dup>کپی میز</button
        ><button type="button" class="btn d" data-del>حذف میز</button>
      </div>`,
  );
  openPanel();
}
/** @param {Item} it */
function decorEditPanel(it) {
  panelMode = "edit-decor";
  setHtml(
    panel(),
    html`<div class="ph">
        <div class="ic">${svg(it.type)}</div>
        <div>
          <small>ویرایش</small>
          <h3>${DECOR[it.type]}</h3>
          <p>
            ${it.type === "vip" ? "میزهای داخل این محدوده در بخش VIP نشان داده می‌شوند" : "برای جابه‌جایی بکشید"}
          </p>
        </div>
        <button type="button" class="x" data-close aria-label="بستن">✕</button>
      </div>
      ${
        it.type === "vip"
          ? html`<div class="two">
              <div class="field">
                <label>عرض (متر)</label>
                <div class="stepper">
                  <button type="button" data-vw="1">+</button><b>${faDigits(it.w || 6)}</b
                  ><button type="button" data-vw="-1">−</button>
                </div>
              </div>
              <div class="field">
                <label>طول (متر)</label>
                <div class="stepper">
                  <button type="button" data-vd="1">+</button><b>${faDigits(it.d || 6)}</b
                  ><button type="button" data-vd="-1">−</button>
                </div>
              </div>
            </div>`
          : ""
      }
      ${it.type !== "plant" ? rotBlock(it) : ""}
      <div class="acts">
        <button type="button" class="btn" data-dup>کپی</button
        ><button type="button" class="btn d" data-del>حذف</button>
      </div>`,
  );
  openPanel();
}
function roomPanel() {
  panelMode = "room";
  const r = layout.room,
    st = (key, label) =>
      html`<div class="field">
        <label>${label}</label>
        <div class="stepper">
          <button type="button" data-room-k="${key}" data-v="1">+</button
          ><b>${r[key] ? `${faDigits(r[key])} متر` : "ندارد"}</b
          ><button type="button" data-room-k="${key}" data-v="-1">−</button>
        </div>
      </div>`;
  setHtml(
    panel(),
    html`<div class="ph">
        <div class="ic">${svg("room")}</div>
        <div>
          <small>تنظیمات</small>
          <h3>ابعاد سالن</h3>
          <p>اندازه‌ی تقریبی کافی است؛ با قدم هم می‌شود اندازه گرفت</p>
        </div>
        <button type="button" class="x" data-close aria-label="بستن">✕</button>
      </div>
      <div class="two">${st("w", "عرض سالن")}${st("d", "عمق سالن")}</div>
      ${st("terrace", "عمق تراس / فضای باز")}
      <ol class="help">
        <li>ابعاد سالن را تنظیم کنید.</li>
        <li>از نوار پایین میز، بار، گلدان یا محدوده‌ی VIP اضافه کنید.</li>
        <li>هر چیزی را با کشیدن جابه‌جا کنید و از پنل بچرخانید.</li>
        <li>میزهای قرمز با هم تداخل دارند.</li>
        <li>«ذخیره و انتشار» را بزنید؛ مشتری‌ها همان لحظه چینش تازه را می‌بینند.</li>
      </ol>`,
  );
  openPanel();
}
function jsonPanel() {
  panelMode = "json";
  eSel = null;
  setHtml(
    panel(),
    html`<div class="ph">
        <div class="ic">{ }</div>
        <div>
          <small>داده‌ی چینش</small>
          <h3>خروجی / ورودی JSON</h3>
          <p>همین داده برای این شعبه در دیتابیس ذخیره می‌شود</p>
        </div>
        <button type="button" class="x" data-close aria-label="بستن">✕</button>
      </div>
      <div class="field">
        <textarea id="e-json" class="input json" spellcheck="false">
${JSON.stringify(exportLayout(layout), null, 1)}</textarea
        ><span id="e-jerr" class="err"></span>
      </div>
      <div class="acts">
        <button type="button" class="btn" data-jcopy>کپی</button
        ><button type="button" class="btn p" data-jload>بارگذاری این JSON</button>
      </div>`,
  );
  openPanel();
}
/** @param {Item} it */
function selectEdit(it) {
  eSel = it;
  repaint();
  if (it.kind === "table") tableEditPanel(it);
  else decorEditPanel(it);
}
function rebuildItems() {
  scene?.rebuildItems();
  repaint();
}

async function saveLayout() {
  try {
    const response = await fetch(apiUrl(), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ layout: exportLayout(layout) }),
      }),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "ذخیره‌ی چینش انجام نشد.");
    layout = { room: data.room, items: data.items };
    savedJSON = JSON.stringify(exportLayout(layout));
    eSel = null;
    closePanel();
    scene?.setLayout(layout);
    repaint();
    toast("چینش ذخیره و منتشر شد ✓");
    refreshFloor();
  } catch (error) {
    toast(/** @type {Error} */ (error).message);
  }
}

/** @param {"book" | "edit"} next */
function setMode(next) {
  if (mode === next) return;
  if (next === "edit" && !canEdit()) return;
  if (
    mode === "edit" &&
    dirty() &&
    !confirm("تغییرات چینش ذخیره نشده‌اند. بدون ذخیره خارج می‌شوید؟")
  )
    return;
  if (mode === "edit" && dirty()) restoreSaved();
  closePanel();
  mode = next;
  topView = false;
  scene?.setMode(next);
  scene?.home(false);
  if (next === "edit") renderPalette();
  const hint = byId("floorHint");
  hint.textContent =
    next === "edit"
      ? "یک میز را بکشید تا جابه‌جا شود؛ از پایین میز تازه اضافه کنید"
      : "روز، ساعت و تعداد نفرات را انتخاب کنید، بعد روی یک میز سبز بزنید";
  hint.classList.remove("gone");
  setTimeout(() => hint.classList.add("gone"), 5000);
  repaint();
}
function restoreSaved() {
  const saved = JSON.parse(savedJSON || "null");
  if (!saved) return;
  layout = saved;
  scene?.setLayout(layout);
}

/** Redraws the bar and the floor after settings change (paused booking, notice, party limit). */
export function repaintFloor() {
  if (!app().hidden) repaint();
}

/** Opens the floor editor from the staff panel. */
export function openFloorEditor() {
  adminDialog.close();
  setMode("edit");
}

/* ------------------------------------------------------------------ wiring */

/** @param {Item} it */
function onPick(it) {
  if (mode === "edit") return selectEdit(it);
  if (it.kind === "table") selectTable(it);
}

async function startScene() {
  if (engineState !== "idle") return;
  engineState = "loading";
  try {
    const createFloor = await loadEngine();
    scene = createFloor(byId("floorScene"), {
      onPick,
      onEmpty: () => {
        if (mode === "edit" || panelMode !== "done") {
          closePanel();
          repaint();
        }
      },
      onDragEnd: (it, moved) => {
        if (moved && (it.kind === "table" || it.type === "vip")) rebuildItems();
        else repaint();
        selectEdit(it);
      },
    });
    engineState = "ready";
    scene.setMode(/** @type {"book" | "edit"} */ (mode));
    scene.setLayout(layout);
    byId("floorScene").dataset.ready = "true";
  } catch {
    // No WebGL, or the engine could not load: the list of tables does the same job.
    engineState = "failed";
    scene = null;
    byId("floorFallback").hidden = false;
  }
  repaint();
}

/** Shows the floor for a café and loads everything it needs. */
export async function startFloor() {
  app().hidden = false;
  state.guests = Math.min(state.guests || 2, store.cafeSettings.maxPartySize || 20);
  if (!state.date) state.date = days()[0].date;
  repaint();
  startScene();
  await loadFloor();
  await refreshFloor();
  // Nothing left today (late in the evening, or closed): start on the next day that has room.
  for (let i = 1; i < 7 && !slots().some((s) => s.available); i++) {
    state.date = days()[i].date;
    state.time = "";
    await refreshFloor();
  }
  setTimeout(() => byId("floorHint").classList.add("gone"), 7000);
}

export function wireFloor() {
  byId("floorDays").onclick = (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-d]");
    if (!(b instanceof HTMLElement)) return;
    state.date = b.dataset.d || state.date;
    state.time = "";
    state.availability = null;
    renderTop();
    refreshFloor();
  };
  byId("floorHours").onclick = (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-h]");
    if (!(b instanceof HTMLElement)) return;
    if (state.hold) releaseHold();
    panelNote = "";
    state.time = b.dataset.h || "";
    state.availableTableIds = new Set(slotAt(state.time)?.tableIds || []);
    repaint();
    if (selected && panelMode === "table") tablePanel(selected);
  };
  byId("floorZones").onclick = (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-z]");
    if (!(b instanceof HTMLElement)) return;
    zone = b.dataset.z || "all";
    repaint();
  };
  const changeParty = (delta) => {
    state.guests = Math.max(1, Math.min(store.cafeSettings.maxPartySize || 20, party() + delta));
    if (state.hold) releaseHold();
    refreshFloor();
  };
  byId("floorPlus").onclick = () => changeParty(1);
  byId("floorMinus").onclick = () => changeParty(-1);
  byId("floorListToggle").onclick = () => {
    listOpen = !listOpen;
    repaint();
  };
  byId("floorList").onclick = (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-pick]");
    const t = b instanceof HTMLElement && tables().find((x) => x.id === b.dataset.pick);
    if (t) selectTable(t);
  };
  byId("floorMode").onclick = (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-m]");
    if (b instanceof HTMLElement) setMode(b.dataset.m === "edit" ? "edit" : "book");
  };
  byId("floorZoomIn").onclick = () => scene?.zoom(1.3);
  byId("floorZoomOut").onclick = () => scene?.zoom(1 / 1.3);
  byId("floorRotate").onclick = () =>
    byId("floorRotate").classList.toggle("on", Boolean(scene?.toggleRotate()));
  byId("floorHome").onclick = () => {
    closePanel();
    repaint();
    scene?.home(topView);
  };
  byId("openMapEditor").onclick = openFloorEditor;
  addEventListener("beforeunload", (e) => {
    if (mode === "edit" && dirty()) e.preventDefault();
  });

  byId("floorEditTools").onclick = (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("[data-et]");
    if (!(b instanceof HTMLElement)) return;
    const k = b.dataset.et;
    if (k === "view") {
      topView = !topView;
      scene?.home(topView);
      renderEditTools();
    } else if (k === "save") saveLayout();
    else if (k === "json") jsonPanel();
    else if (k === "preview") setMode("book");
    else if (k === "undo") {
      restoreSaved();
      closePanel();
      repaint();
      toast("آخرین چینش ذخیره‌شده برگشت");
    } else if (k === "back") {
      setMode("book");
      if (mode === "book") adminDialog.showModal();
    }
  };
  byId("floorPalette").onclick = (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest("[data-room]")) {
      eSel = null;
      repaint();
      roomPanel();
      return;
    }
    const b = target.closest("[data-add]");
    if (!(b instanceof HTMLElement)) return;
    const [kind, type] = (b.dataset.add || "").split(":"),
      c = scene?.centre() || { x: 0, z: 0 },
      /** @type {Item} */ it = {
        kind: kind === "table" ? "table" : "decor",
        type,
        x: snap(c.x),
        z: snap(c.z),
        rot: 0,
      };
    if (it.kind === "table")
      Object.assign(it, { id: newTableId(), name: nextName(layout), tags: [], reservable: true });
    if (type === "vip") Object.assign(it, { w: 6, d: 6 });
    clampPos(layout, it);
    // The first free spot around the centre of the view.
    if (it.kind === "table" && overlaps(layout, it)) {
      const cx = it.x,
        cz = it.z;
      search: for (let r = 1.5; r <= 14; r += 1.5)
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          it.x = snap(cx + Math.cos(a) * r);
          it.z = snap(cz + Math.sin(a) * r);
          clampPos(layout, it);
          if (!overlaps(layout, it)) break search;
        }
    }
    layout.items.push(it);
    rebuildItems();
    selectEdit(it);
    toast(it.kind === "table" ? `${titleOf(it)} اضافه شد` : `${DECOR[type]} اضافه شد`);
  };

  const p = panel();
  p.addEventListener("input", (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (input.id === "f-name") form.name = input.value;
    if (input.id === "f-phone") form.phone = input.value;
    if (input.id === "f-note") form.note = input.value;
  });
  p.addEventListener("focusin", (e) => {
    if (mode === "book" && /** @type {HTMLElement} */ (e.target).closest("#floorBookForm"))
      holdChosen();
  });
  p.addEventListener("submit", (e) => {
    e.preventDefault();
    submitBooking();
  });
  p.addEventListener("change", (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    if (!eSel || eSel.kind !== "table") return;
    if (input.id === "e-reservable") {
      eSel.reservable = input.checked;
      repaint();
    }
    if (input.id === "e-name") {
      const v = input.value.trim().slice(0, 12);
      if (!v) return;
      if (tables().some((t) => t !== eSel && t.name === v)) {
        const err = document.getElementById("e-nameerr");
        if (err) err.textContent = "این نام قبلاً استفاده شده است";
        return;
      }
      eSel.name = v;
      rebuildItems();
      tableEditPanel(eSel);
    }
  });
  p.onclick = async (e) => {
    const target = /** @type {HTMLElement} */ (e.target),
      hit = (selector) => target.closest(selector);
    if (hit("[data-close]")) {
      closePanel();
      repaint();
      return;
    }
    if (mode === "edit") {
      const it = eSel;
      const ty = hit("[data-type]");
      if (ty instanceof HTMLElement && it) {
        it.type = ty.dataset.type || it.type;
        rebuildItems();
        tableEditPanel(it);
        return;
      }
      const ro = hit("[data-rot]");
      if (ro instanceof HTMLElement && it) {
        it.rot = (((it.rot + Number(ro.dataset.rot)) % 360) + 360) % 360;
        if (it.rot > 180) it.rot -= 360;
        scene?.turn(it);
        repaint();
        if (it.kind === "table") tableEditPanel(it);
        else decorEditPanel(it);
        return;
      }
      const tg = hit("[data-tag]");
      if (tg instanceof HTMLElement && it) {
        const x = tg.dataset.tag || "",
          tags = it.tags || [];
        it.tags = tags.includes(x) ? tags.filter((y) => y !== x) : [...tags, x];
        tg.classList.toggle("on");
        renderEditTools();
        return;
      }
      if (hit("[data-del]") && it) {
        layout.items = layout.items.filter((i) => i !== it);
        const n = it.name || DECOR[it.type];
        closePanel();
        rebuildItems();
        toast(`${n} حذف شد`);
        return;
      }
      if (hit("[data-dup]") && it) {
        /** @type {Item} */
        const copy = {
          ...exportLayout({ room: layout.room, items: [it] }).items[0],
          x: snap(it.x + 2.5),
        };
        if (copy.kind === "table")
          Object.assign(copy, {
            id: newTableId(),
            name: nextName(layout, (it.name || "T").replace(/\d+$/, "") || "T"),
          });
        clampPos(layout, copy);
        layout.items.push(copy);
        rebuildItems();
        selectEdit(copy);
        return;
      }
      const vw = hit("[data-vw]"),
        vd = hit("[data-vd]");
      if ((vw || vd) && it) {
        if (vw instanceof HTMLElement)
          it.w = Math.max(3, Math.min(14, (it.w || 6) + Number(vw.dataset.vw)));
        if (vd instanceof HTMLElement)
          it.d = Math.max(3, Math.min(14, (it.d || 6) + Number(vd.dataset.vd)));
        rebuildItems();
        decorEditPanel(it);
        return;
      }
      const rk = hit("[data-room-k]");
      if (rk instanceof HTMLElement) {
        const k = /** @type {"w" | "d" | "terrace"} */ (rk.dataset.roomK),
          lim = { w: [8, 40], d: [6, 30], terrace: [0, 12] }[k];
        layout.room[k] = Math.max(lim[0], Math.min(lim[1], layout.room[k] + Number(rk.dataset.v)));
        layout.items.forEach((i) => clampPos(layout, i));
        scene?.rebuildRoom();
        rebuildItems();
        roomPanel();
        return;
      }
      if (hit("[data-jcopy]")) {
        try {
          await navigator.clipboard.writeText(
            /** @type {HTMLTextAreaElement} */ (document.getElementById("e-json")).value,
          );
          toast("کپی شد ✓");
        } catch {
          toast("کپی ممکن نشد؛ متن را دستی انتخاب کنید");
        }
        return;
      }
      if (hit("[data-jload]")) {
        const err = /** @type {HTMLElement} */ (document.getElementById("e-jerr"));
        let o;
        try {
          o = JSON.parse(
            /** @type {HTMLTextAreaElement} */ (document.getElementById("e-json")).value,
          );
        } catch {
          err.textContent = "JSON قابل خواندن نیست";
          return;
        }
        if (!o?.room || !Array.isArray(o.items)) {
          err.textContent = "ساختار JSON درست نیست (room و items لازم است)";
          return;
        }
        layout = { room: o.room, items: o.items };
        scene?.setLayout(layout);
        closePanel();
        repaint();
        toast("چینش بارگذاری شد؛ برای انتشار «ذخیره و انتشار» را بزنید");
      }
      return;
    }
    // Booking.
    const th = hit("[data-th]");
    if (th instanceof HTMLElement && selected) {
      if (state.hold) releaseHold();
      panelNote = "";
      state.time = th.dataset.th || state.time;
      repaint();
      tablePanel(selected);
      return;
    }
    const gh = hit("[data-goh]");
    if (gh instanceof HTMLElement && selected) {
      panelNote = "";
      state.time = gh.dataset.goh || state.time;
      repaint();
      tablePanel(selected);
      return;
    }
    const gt = hit("[data-got]");
    if (gt instanceof HTMLElement) {
      const t = tables().find((x) => x.id === gt.dataset.got);
      if (t) selectTable(t);
      return;
    }
    if (hit("[data-pay]")) return void payDeposit();
    if (hit("[data-copy]") && lastBooking) {
      const { item, data, time, date, party: guests } = lastBooking,
        day = dayOf(date),
        text = `رزرو میزو\n${store.cafeProfile.cafe.name} — ${titleOf(item)} (${ZONES[zoneOf(layout, item)]})\n${day.label} ${day.sub}، ساعت ${timeLabel(time)}\n${faDigits(guests)} نفر — کد پیگیری: ${data.trackingCode}`;
      try {
        await navigator.clipboard.writeText(text);
        toast("کپی شد ✓");
      } catch {
        toast("کپی ممکن نشد");
      }
    }
  };
}
