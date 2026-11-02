import { scheduleUrl } from "./api.js";
import { fetchAvailability } from "./booking.js";
import { byId, html, setHtml, required } from "./dom.js";
import { formatPersianDate, isoValue, setJalaliInput } from "./format.js";
import { store } from "./state.js";

export const weekNames = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
export function renderSchedule() {
  const wrap = byId("weekHours");
  wrap.replaceChildren();
  store.cafeSchedule.hours.forEach((h) => {
    const row = document.createElement("div");
    row.className = "hour-row";
    setHtml(
      row,
      html`<b>${weekNames[h.weekday]}</b
        ><label
          ><input type="checkbox" data-closed="${h.weekday}" ${h.closed && "checked"} />
          تعطیل</label
        ><input
          type="time"
          data-open="${h.weekday}"
          value="${h.openTime}"
          ${h.closed && "disabled"}
        /><span>تا</span
        ><input
          type="time"
          data-close="${h.weekday}"
          value="${h.closeTime}"
          ${h.closed && "disabled"}
        />`,
    );
    /** @type {HTMLInputElement} */ (row.querySelector("[data-closed]")).onchange = (e) => {
      h.closed = /** @type {HTMLInputElement} */ (e.target).checked;
      renderSchedule();
    };
    /** @type {HTMLInputElement} */ (row.querySelector("[data-open]")).onchange = (e) =>
      (h.openTime = /** @type {HTMLInputElement} */ (e.target).value);
    /** @type {HTMLInputElement} */ (row.querySelector("[data-close]")).onchange = (e) =>
      (h.closeTime = /** @type {HTMLInputElement} */ (e.target).value);
    wrap.appendChild(row);
  });
  const list = byId("closureList");
  list.replaceChildren();
  store.cafeSchedule.closures.forEach((c, index) => {
    const item = document.createElement("div");
    setHtml(
      item,
      html`<span
          >${formatPersianDate(c.startDate)} تا
          ${formatPersianDate(c.endDate)}${c.reason && ` · ${c.reason}`}</span
        ><button type="button">حذف</button>`,
    );
    required("button", item).onclick = () => {
      store.cafeSchedule.closures.splice(index, 1);
      renderSchedule();
    };
    list.appendChild(item);
  });
}
export async function fetchSchedule() {
  const status = byId("scheduleStatus");
  status.textContent = "در حال دریافت تقویم…";
  try {
    const response = await fetch(scheduleUrl()),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "دریافت تقویم ممکن نیست");
    store.cafeSchedule = data;
    renderSchedule();
    status.textContent = "";
  } catch (err) {
    status.textContent = err.message;
  }
}

export function wireSchedule() {
  byId("addClosure").onclick = () => {
    const start = isoValue(byId("closureStart")),
      end = isoValue(byId("closureEnd")),
      reason = byId("closureReason").value.trim(),
      status = byId("scheduleStatus");
    if (!start || !end || end < start) {
      status.textContent = "بازه تاریخ تعطیلی را درست انتخاب کنید.";
      return;
    }
    store.cafeSchedule.closures.push({ startDate: start, endDate: end, reason });
    setJalaliInput(byId("closureStart"), "");
    setJalaliInput(byId("closureEnd"), "");
    byId("closureReason").value = "";
    status.textContent = "";
    renderSchedule();
  };
  byId("saveSchedule").onclick = async () => {
    const button = byId("saveSchedule"),
      status = byId("scheduleStatus");
    button.disabled = true;
    status.textContent = "در حال ذخیره…";
    try {
      const response = await fetch(scheduleUrl(), {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(store.cafeSchedule),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ذخیره انجام نشد");
      store.cafeSchedule = data;
      renderSchedule();
      await fetchAvailability();
      status.textContent = "تقویم شعبه ذخیره شد.";
    } catch (err) {
      status.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
