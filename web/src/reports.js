import { adminDialog, reportsDialog } from "./dialogs.js";
import { byId, html, setHtml } from "./dom.js";
import { faDigits, formatPersianDate } from "./format.js";
import { store } from "./state.js";

export function setupReportBranches() {
  const select = byId("reportsBranch");
  select.replaceChildren();
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
  byId("reportReservations").textContent = faDigits(summary.reservations);
  byId("reportGuests").textContent = faDigits(summary.guests);
  byId("reportCompletion").textContent = `${faDigits(summary.completionRate)}٪`;
  byId("reportRepeat").textContent = faDigits(summary.repeatCustomers);
  byId("reportNoShow").textContent = `${faDigits(summary.noShowRate)}٪`;
  const chart = byId("reportChart"),
    max = Math.max(1, ...store.reportsData.daily.map((item) => item.reservations));
  setHtml(
    chart,
    store.reportsData.daily.length
      ? html`${store.reportsData.daily.map(
          (item) =>
            html`<div class="report-column">
              <span
                style="height:${Math.max(8, Math.round((item.reservations / max) * 100))}%"
                title="${faDigits(item.reservations)} رزرو"
              ></span
              ><small>${formatPersianDate(item.date).replace(/^....\//, "")}</small>
            </div>`,
        )}`
      : html`<div class="insight-empty">در این بازه رزروی ثبت نشده است.</div>`,
  );
  const hours = byId("reportHours"),
    hourMax = Math.max(1, ...store.reportsData.busyHours.map((item) => item.reservations));
  setHtml(
    hours,
    store.reportsData.busyHours.length
      ? html`${store.reportsData.busyHours.map(
          (item) =>
            html`<div>
              <span>${faDigits(item.hour)}</span
              ><i><b style="width:${Math.round((item.reservations / hourMax) * 100)}%"></b></i
              ><strong>${faDigits(item.reservations)}</strong>
            </div>`,
        )}`
      : html`<div class="insight-empty">داده کافی وجود ندارد.</div>`,
  );
  const branches = byId("reportBranches");
  setHtml(
    branches,
    store.reportsData.branches.length
      ? html`${store.reportsData.branches.map(
          (item) =>
            html`<article>
              <div>
                <b>${item.name}</b
                ><span>${faDigits(item.reservations)} رزرو · ${faDigits(item.guests)} مهمان</span>
              </div>
              <strong
                >${item.reservations ? faDigits(Math.round((item.completed / item.reservations) * 100)) : faDigits(0)}٪
                تکمیل</strong
              >
            </article>`,
        )}`
      : html`<div class="insight-empty">شعبه فعالی پیدا نشد.</div>`,
  );
}
export async function fetchReports() {
  const error = byId("reportsError"),
    days = byId("reportsDays").value,
    branch = byId("reportsBranch").value;
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
  byId("openReports").onclick = async () => {
    adminDialog.close();
    setupReportBranches();
    reportsDialog.showModal();
    await fetchReports();
  };
  byId("reportsDays").onchange = fetchReports;
  byId("reportsBranch").onchange = fetchReports;
}
