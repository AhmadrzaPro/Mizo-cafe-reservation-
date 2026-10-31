import { byId } from "./dom.js";
import {
  dateFromIso,
  faDigits,
  isoDate,
  isoValue,
  persianMonthFormatter,
  persianParts,
  setJalaliInput,
} from "./format.js";
import { store } from "./state.js";

export function renderJalaliPicker() {
  const first = new Date(store.jalaliAnchor),
    parts = persianParts(first);
  first.setDate(first.getDate() - (parts.day - 1));
  store.jalaliAnchor = new Date(first);
  byId("jalaliMonthTitle").textContent = persianMonthFormatter.format(first);
  const grid = byId("jalaliDays");
  grid.replaceChildren();
  const leading = (first.getDay() + 1) % 7;
  for (let i = 0; i < leading; i++) {
    const blank = document.createElement("span");
    blank.className = "blank";
    grid.appendChild(blank);
  }
  const selected = isoValue(store.jalaliTarget),
    today = isoDate(new Date()),
    month = persianParts(first).month,
    year = persianParts(first).year;
  for (let cursor = new Date(first); ; cursor.setDate(cursor.getDate() + 1)) {
    const cursorParts = persianParts(cursor);
    if (cursorParts.month !== month || cursorParts.year !== year) break;
    const value = isoDate(cursor),
      button = document.createElement("button");
    button.type = "button";
    button.textContent = faDigits(cursorParts.day);
    button.classList.toggle("selected", value === selected);
    button.classList.toggle("today", value === today);
    button.onclick = () => {
      setJalaliInput(store.jalaliTarget, value);
      byId("jalaliPicker").close();
      store.jalaliTarget.dispatchEvent(new Event("change", { bubbles: true }));
    };
    grid.appendChild(button);
  }
}
export function openJalaliPicker(input) {
  store.jalaliTarget = input;
  store.jalaliAnchor = isoValue(input) ? dateFromIso(isoValue(input)) : new Date();
  renderJalaliPicker();
  byId("jalaliPicker").showModal();
}

export function wireJalaliPicker() {
  document.querySelectorAll("[data-jalali]").forEach((input) => {
    input.addEventListener("click", () => openJalaliPicker(input));
    input.addEventListener("keydown", (/** @type {KeyboardEvent} */ event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openJalaliPicker(input);
      }
    });
  });
  byId("jalaliPrev").onclick = () => {
    store.jalaliAnchor.setDate(store.jalaliAnchor.getDate() - 1);
    renderJalaliPicker();
  };
  byId("jalaliNext").onclick = () => {
    store.jalaliAnchor.setDate(store.jalaliAnchor.getDate() + 32);
    renderJalaliPicker();
  };
  byId("jalaliToday").onclick = () => {
    const value = isoDate(new Date());
    setJalaliInput(store.jalaliTarget, value);
    byId("jalaliPicker").close();
    store.jalaliTarget.dispatchEvent(new Event("change", { bubbles: true }));
  };
  byId("jalaliCancel").onclick = () => byId("jalaliPicker").close();
}
