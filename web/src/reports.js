import { adminDialog, reportsDialog } from "./dialogs.js";
import { faDigits, formatPersianDate } from "./format.js";
import { escapeHtml } from "./operations.js";
import { store } from "./state.js";

export function setupReportBranches() {
  const select = document.querySelector("#reportsBranch");
  select.innerHTML = "";
  if (store.managerSession?.role === "owner") {
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "همه شعب";
    select.appendChild(all);
  }
  store.cafeProfile.branches
    .filter(
      (branch) =>
        branch.active !== false &&
        (store.managerSession?.role === "owner" || branch.id === store.managerSession?.branchId),
    )
    .forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch.id;
      option.textContent = branch.name;
      select.appendChild(option);
    });
  select.disabled = store.managerSession?.role !== "owner";
}
export function renderReports() {
  const summary = store.reportsData.summary;
  document.querySelector("#reportReservations").textContent = faDigits(summary.reservations);
  document.querySelector("#reportGuests").textContent = faDigits(summary.guests);
  document.querySelector("#reportCompletion").textContent = `${faDigits(summary.completionRate)}٪`;
  document.querySelector("#reportRepeat").textContent = faDigits(summary.repeatCustomers);
  document.querySelector("#reportNoShow").textContent = `${faDigits(summary.noShowRate)}٪`;
  const chart = document.querySelector("#reportChart"),
    max = Math.max(1, ...store.reportsData.daily.map((item) => item.reservations));
  chart.innerHTML = store.reportsData.daily.length
    ? store.reportsData.daily
        .map(
          (item) =>
            `<div class="report-column"><span style="height:${Math.max(8, Math.round((item.reservations / max) * 100))}%" title="${faDigits(item.reservations)} رزرو"></span><small>${formatPersianDate(item.date).replace(/^....\//, "")}</small></div>`,
        )
        .join("")
    : '<div class="insight-empty">در این بازه رزروی ثبت نشده است.</div>';
  const hours = document.querySelector("#reportHours"),
    hourMax = Math.max(1, ...store.reportsData.busyHours.map((item) => item.reservations));
  hours.innerHTML = store.reportsData.busyHours.length
    ? store.reportsData.busyHours
        .map(
          (item) =>
            `<div><span>${faDigits(item.hour)}</span><i><b style="width:${Math.round((item.reservations / hourMax) * 100)}%"></b></i><strong>${faDigits(item.reservations)}</strong></div>`,
        )
        .join("")
    : '<div class="insight-empty">داده کافی وجود ندارد.</div>';
  const branches = document.querySelector("#reportBranches");
  branches.innerHTML =
    store.reportsData.branches
      .map(
        (item) =>
          `<article><div><b>${escapeHtml(item.name)}</b><span>${faDigits(item.reservations)} رزرو · ${faDigits(item.guests)} مهمان</span></div><strong>${item.reservations ? faDigits(Math.round((item.completed / item.reservations) * 100)) : faDigits(0)}٪ تکمیل</strong></article>`,
      )
      .join("") || '<div class="insight-empty">شعبه فعالی پیدا نشد.</div>';
}
export async function fetchReports() {
  const error = document.querySelector("#reportsError"),
    days = document.querySelector("#reportsDays").value,
    branch = document.querySelector("#reportsBranch").value;
  error.textContent = "";
  try {
    const response = await fetch(
        `/api/reports?days=${encodeURIComponent(days)}&branch=${encodeURIComponent(branch)}`,
      ),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "دریافت گزارش انجام نشد.");
    store.reportsData = data;
    renderReports();
  } catch (err) {
    error.textContent = err.message;
  }
}

export function wireReports() {
  document.querySelector("#openReports").onclick = async () => {
    adminDialog.close();
    setupReportBranches();
    reportsDialog.showModal();
    await fetchReports();
  };
  document.querySelector("#reportsDays").onchange = fetchReports;
  document.querySelector("#reportsBranch").onchange = fetchReports;
}
