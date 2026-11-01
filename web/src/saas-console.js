// The platform owner's console (/saas-admin): every café's subscription, the platform's figures,
// and card-to-card transfers awaiting review. Bundled on its own as /saas-admin.js.
import { html, required, setHtml } from "./dom.js";
import { faDigits, formatPersianDate, formatTehranTime, formatToman } from "./format.js";

/** @typedef {import("./types").SaasOverview} SaasOverview */
/** @typedef {SaasOverview["cafes"][number]} SaasCafe */
/** @typedef {SaasOverview["pendingPayments"][number]} PendingTransfer */

const statusLabels = /** @type {const} */ ({
  inactive: "غیرفعال",
  trial: "آزمایشی",
  active: "فعال",
  past_due: "نیازمند پرداخت",
});
const errorBox = () => required("#saasError");

/**
 * Sends a request to the console API and returns its JSON, or throws with the server's message.
 * @param {string} path @param {RequestInit | undefined} init @param {string} failure
 * @returns {Promise<SaasOverview>}
 */
async function api(path, init, failure) {
  const response = await fetch(path, init),
    data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || failure);
  return data;
}

/** @param {SaasOverview} data */
function render(data) {
  required("#saasCafeCount").textContent = faDigits(data.stats.cafes);
  required("#saasEnabledCount").textContent = faDigits(data.stats.enabled);
  required("#saasTrialCount").textContent = faDigits(data.stats.trials);
  required("#saasActiveCount").textContent = faDigits(data.stats.active);
  required("#saasMrr").textContent = formatToman(data.stats.mrrRials);
  required("#saasUnitPrice").textContent = `${formatToman(data.unitPriceRials)} برای هر شعبه فعال`;
  renderTransfers(data.pendingPayments);
  renderCafes(data.cafes);
}

/** @param {PendingTransfer[]} transfers */
function renderTransfers(transfers) {
  required("#saasPayments").hidden = !transfers.length;
  const list = required("#saasPaymentList");
  list.replaceChildren();
  for (const transfer of transfers) {
    const row = document.createElement("article");
    row.className = "saas-payment-row";
    setHtml(
      row,
      html`<div>
          <h3>${transfer.cafeName}</h3>
          <p>
            ${formatPersianDate(transfer.createdAt)} ساعت ${formatTehranTime(transfer.createdAt)} ·
            ${faDigits(transfer.months)} ماه
          </p>
          <p dir="ltr">
            پیگیری ${transfer.reference}${transfer.cardLast4 && ` · کارت ****${transfer.cardLast4}`}
          </p>
          ${
            transfer.duplicateReference &&
            html`<p class="saas-warning">این شماره پیگیری برای پرداخت دیگری هم ثبت شده است</p>`
          }
        </div>
        <b>${formatToman(transfer.amountRials)}</b>
        <div class="saas-payment-actions">
          <button type="button" data-decision="approve">تأیید و تمدید</button>
          <button type="button" data-decision="reject" class="saas-reject">رد</button>
        </div>`,
    );
    for (const button of row.querySelectorAll("button"))
      button.addEventListener("click", () =>
        reviewTransfer(transfer, button.dataset.decision === "approve", row),
      );
    list.append(row);
  }
}

/** @param {SaasCafe} cafe */
function cafeStanding(cafe) {
  if (cafe.bookingPaused) return html` · <b class="saas-warning">رزرو آنلاین بسته</b>`;
  if (cafe.status === "past_due" && cafe.graceEndsAt)
    return html` · <b class="saas-warning">مهلت تا ${formatPersianDate(cafe.graceEndsAt)}</b>`;
  return "";
}

/** @param {SaasCafe[]} cafes */
function renderCafes(cafes) {
  const list = required("#saasCafeList");
  if (!cafes.length) {
    setHtml(list, html`<div class="saas-empty">هنوز کافه‌ای راه‌اندازی نشده است.</div>`);
    return;
  }
  list.replaceChildren();
  for (const cafe of cafes) {
    const row = document.createElement("article");
    row.className = "saas-cafe-row";
    setHtml(
      row,
      html`<div class="saas-cafe-name">
          <span>${cafe.name.trim().charAt(0) || "ک"}</span>
          <div>
            <h3>${cafe.name}</h3>
            <p>
              ${faDigits(cafe.branchCount)} شعبه فعال ·
              ${cafe.enabled ? "اشتراک روشن" : "بدون اشتراک"}${cafeStanding(cafe)}
            </p>
          </div>
        </div>
        <div class="saas-price">
          <span>هزینه ماهانه</span><b>${formatToman(cafe.monthlyPriceRials)}</b>
        </div>
        <label
          >وضعیت<select class="saas-status">
            ${Object.entries(statusLabels).map(
              ([value, label]) =>
                html`<option value="${value}" ${cafe.status === value && "selected"}>
                  ${label}
                </option>`,
            )}
          </select></label
        ><label class="saas-enabled"
          >اشتراک روشن<input type="checkbox" ${cafe.enabled && "checked"}
        /></label>
        <button type="button" class="saas-save">ذخیره</button>`,
    );
    const save = /** @type {HTMLButtonElement} */ (required(".saas-save", row));
    save.addEventListener("click", () => saveCafe(cafe.id, row, save));
    list.append(row);
  }
}

/** Runs one console action, showing its error and keeping the button busy meanwhile. */
async function run(
  /** @type {HTMLButtonElement[]} */ buttons,
  /** @type {() => Promise<void>} */ action,
) {
  errorBox().textContent = "";
  buttons.forEach((button) => (button.disabled = true));
  try {
    await action();
  } catch (error) {
    errorBox().textContent = error instanceof Error ? error.message : String(error);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

/** @param {PendingTransfer} transfer @param {boolean} approve @param {HTMLElement} row */
function reviewTransfer(transfer, approve, row) {
  const question = approve
    ? `واریز ${formatToman(transfer.amountRials)} از «${transfer.cafeName}» در حساب دیده شده است؟ اشتراک ۳۰ روز تمدید می‌شود.`
    : `پرداخت «${transfer.cafeName}» رد شود؟`;
  if (!confirm(question)) return;
  return run([...row.querySelectorAll("button")], async () => {
    render(
      await api(
        `/api/saas/payments/${encodeURIComponent(transfer.id)}/${approve ? "approve" : "reject"}`,
        { method: "POST" },
        "بررسی پرداخت انجام نشد.",
      ),
    );
  });
}

/** @param {string} cafeId @param {HTMLElement} row @param {HTMLButtonElement} button */
function saveCafe(cafeId, row, button) {
  const status = /** @type {HTMLSelectElement} */ (required(".saas-status", row)).value,
    enabled = /** @type {HTMLInputElement} */ (required(".saas-enabled input", row)).checked;
  return run([button], async () => {
    render(
      await api(
        "/api/saas/overview",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cafeId, status, enabled }),
        },
        "ذخیره حساب انجام نشد.",
      ),
    );
  });
}

async function refresh() {
  const button = /** @type {HTMLButtonElement} */ (required("#refreshSaas"));
  await run([button], async () => {
    try {
      render(await api("/api/saas/overview", undefined, "دریافت اطلاعات انجام نشد."));
    } catch (error) {
      setHtml(
        required("#saasCafeList"),
        html`<div class="saas-empty">دسترسی به اطلاعات ممکن نیست.</div>`,
      );
      throw error;
    }
  });
}

required("#refreshSaas").addEventListener("click", refresh);
refresh();
