import { scheduleUrl } from "./api.js";
import { fetchAvailability } from "./booking.js";
import { formatPersianDate, isoValue, setJalaliInput } from "./format.js";
import { escapeHtml } from "./operations.js";
import { store } from "./state.js";

export const weekNames = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];
export function renderSchedule() {
  const wrap = document.querySelector("#weekHours");
  wrap.innerHTML = "";
  store.cafeSchedule.hours.forEach((h) => {
    const row = document.createElement("div");
    row.className = "hour-row";
    row.innerHTML = `<b>${weekNames[h.weekday]}</b><label><input type="checkbox" data-closed="${h.weekday}" ${h.closed ? "checked" : ""}> تعطیل</label><input type="time" data-open="${h.weekday}" value="${h.openTime}" ${h.closed ? "disabled" : ""}><span>تا</span><input type="time" data-close="${h.weekday}" value="${h.closeTime}" ${h.closed ? "disabled" : ""}>`;
    row.querySelector("[data-closed]").onchange = (e) => {
      h.closed = e.target.checked;
      renderSchedule();
    };
    row.querySelector("[data-open]").onchange = (e) => (h.openTime = e.target.value);
    row.querySelector("[data-close]").onchange = (e) => (h.closeTime = e.target.value);
    wrap.appendChild(row);
  });
  const list = document.querySelector("#closureList");
  list.innerHTML = "";
  store.cafeSchedule.closures.forEach((c, index) => {
    const item = document.createElement("div");
    item.innerHTML = `<span>${formatPersianDate(c.startDate)} تا ${formatPersianDate(c.endDate)}${c.reason ? ` · ${escapeHtml(c.reason)}` : ""}</span><button type="button">حذف</button>`;
    item.querySelector("button").onclick = () => {
      store.cafeSchedule.closures.splice(index, 1);
      renderSchedule();
    };
    list.appendChild(item);
  });
}
export async function fetchSchedule() {
  const status = document.querySelector("#scheduleStatus");
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
  document.querySelector("#addClosure").onclick = () => {
    const start = isoValue(document.querySelector("#closureStart")),
      end = isoValue(document.querySelector("#closureEnd")),
      reason = document.querySelector("#closureReason").value.trim(),
      status = document.querySelector("#scheduleStatus");
    if (!start || !end || end < start) {
      status.textContent = "بازه تاریخ تعطیلی را درست انتخاب کنید.";
      return;
    }
    store.cafeSchedule.closures.push({ startDate: start, endDate: end, reason });
    setJalaliInput(document.querySelector("#closureStart"), "");
    setJalaliInput(document.querySelector("#closureEnd"), "");
    document.querySelector("#closureReason").value = "";
    status.textContent = "";
    renderSchedule();
  };
  document.querySelector("#saveSchedule").onclick = async () => {
    const button = document.querySelector("#saveSchedule"),
      status = document.querySelector("#scheduleStatus");
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
