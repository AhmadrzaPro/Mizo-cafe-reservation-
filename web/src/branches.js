import { fetchAvailability } from "./booking.js";
import { adminDialog, branchFormDialog, branchesDialog, editor } from "./dialogs.js";
import { byId, html, setHtml } from "./dom.js";
import { renderEditor } from "./editor.js";
import { switchBranch } from "./editor-nav.js";
import { faDigits } from "./format.js";
import {
  activeBranchProfile,
  activeBranches,
  applyCafeProfile,
  fetchMap,
  fetchSettings,
} from "./profile.js";
import { store } from "./state.js";

export function renderBranches() {
  const list = byId("branchList"),
    branches = store.cafeProfile.branches,
    active = activeBranches().length;
  byId("branchTotal").textContent = faDigits(branches.length);
  byId("branchActive").textContent = faDigits(active);
  byId("branchInactive").textContent = faDigits(branches.length - active);
  list.replaceChildren();
  if (!branches.length) {
    setHtml(list, html`<div class="branch-empty">هنوز شعبه‌ای ساخته نشده است.</div>`);
    return;
  }
  branches.forEach((branch) => {
    const card = document.createElement("article");
    card.className = `branch-card${branch.active === false ? " inactive" : ""}`;
    setHtml(
      card,
      html`<span class="branch-icon">${branch.name.trim().charAt(0) || "ش"}</span>
        <div>
          <h3>${branch.name}</h3>
          <p>${branch.city}${branch.address ? ` · ${branch.address}` : ""}</p>
          <span class="branch-state"
            >${branch.active === false ? "غیرفعال" : "فعال و آماده رزرو"}</span
          >
        </div>
        <div class="branch-actions">
          ${branch.active === false ? "" : html`<button class="branch-enter">انتخاب شعبه</button><button class="branch-map">ویرایش نقشه</button>`}<button
            class="branch-edit"
          >
            ویرایش
          </button>
        </div>`,
    );
    /** @type {HTMLButtonElement} */ (card.querySelector(".branch-edit")).onclick = () =>
      openBranchForm(branch);
    card.querySelector(".branch-enter")?.addEventListener("click", async () => {
      await switchBranch(branch.slug);
      branchesDialog.close();
      adminDialog.showModal();
    });
    card.querySelector(".branch-map")?.addEventListener("click", async () => {
      await switchBranch(branch.slug);
      branchesDialog.close();
      renderEditor();
      editor.showModal();
    });
    list.appendChild(card);
  });
  byId("branchesError").textContent = "";
}
export function openBranchForm(branch = null) {
  byId("branchFormTitle").textContent = branch ? "ویرایش شعبه" : "افزودن شعبه جدید";
  byId("branchSlug").value = branch?.slug || "";
  byId("branchName").value = branch?.name || "";
  byId("branchCity").value = branch?.city || activeBranchProfile()?.city || "";
  byId("branchAddress").value = branch?.address || "";
  byId("branchIsActive").checked = branch?.active !== false;
  byId("branchActiveRow").hidden = !branch;
  byId("branchFormError").textContent = "";
  byId("saveBranch").textContent = branch ? "ذخیره تغییرات" : "ساخت شعبه";
  branchFormDialog.showModal();
}

export function wireBranches() {
  byId("openBranches").onclick = () => {
    adminDialog.close();
    renderBranches();
    branchesDialog.showModal();
  };
  byId("addBranch").onclick = () => openBranchForm();
  byId("branchForm").onsubmit = async (event) => {
    event.preventDefault();
    const slug = byId("branchSlug").value,
      button = byId("saveBranch"),
      error = byId("branchFormError"),
      payload = {
        name: byId("branchName").value,
        city: byId("branchCity").value,
        address: byId("branchAddress").value,
        active: byId("branchIsActive").checked,
      };
    button.disabled = true;
    button.textContent = "در حال ذخیره…";
    error.textContent = "";
    try {
      const response = await fetch(
          slug ? `/api/branches/${encodeURIComponent(slug)}` : "/api/branches",
          {
            method: slug ? "PATCH" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        ),
        profile = await response.json();
      if (!response.ok) throw new Error(profile.message || "ذخیره شعبه انجام نشد.");
      applyCafeProfile(profile);
      renderBranches();
      branchFormDialog.close();
      await Promise.all([fetchMap(), fetchSettings()]);
      await fetchAvailability();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = slug ? "ذخیره تغییرات" : "ساخت شعبه";
    }
  };
}
