import { fetchAvailability } from "./booking.js";
import { adminDialog, branchFormDialog, branchesDialog, editor } from "./dialogs.js";
import { renderEditor } from "./editor.js";
import { switchBranch } from "./editor-nav.js";
import { faDigits } from "./format.js";
import { escapeHtml } from "./operations.js";
import {
  activeBranchProfile,
  activeBranches,
  applyCafeProfile,
  fetchMap,
  fetchSettings,
} from "./profile.js";
import { store } from "./state.js";

export function renderBranches() {
  const list = document.querySelector("#branchList"),
    branches = store.cafeProfile.branches,
    active = activeBranches().length;
  document.querySelector("#branchTotal").textContent = faDigits(branches.length);
  document.querySelector("#branchActive").textContent = faDigits(active);
  document.querySelector("#branchInactive").textContent = faDigits(branches.length - active);
  list.innerHTML = "";
  if (!branches.length) {
    list.innerHTML = '<div class="branch-empty">هنوز شعبه‌ای ساخته نشده است.</div>';
    return;
  }
  branches.forEach((branch) => {
    const card = document.createElement("article");
    card.className = `branch-card${branch.active === false ? " inactive" : ""}`;
    card.innerHTML = `<span class="branch-icon">${escapeHtml(branch.name.trim().charAt(0) || "ش")}</span><div><h3>${escapeHtml(branch.name)}</h3><p>${escapeHtml(branch.city)}${branch.address ? ` · ${escapeHtml(branch.address)}` : ""}</p><span class="branch-state">${branch.active === false ? "غیرفعال" : "فعال و آماده رزرو"}</span></div><div class="branch-actions">${branch.active === false ? "" : `<button class="branch-enter">انتخاب شعبه</button><button class="branch-map">ویرایش نقشه</button>`}<button class="branch-edit">ویرایش</button></div>`;
    card.querySelector(".branch-edit").onclick = () => openBranchForm(branch);
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
  document.querySelector("#branchesError").textContent = "";
}
export function openBranchForm(branch = null) {
  document.querySelector("#branchFormTitle").textContent = branch
    ? "ویرایش شعبه"
    : "افزودن شعبه جدید";
  document.querySelector("#branchSlug").value = branch?.slug || "";
  document.querySelector("#branchName").value = branch?.name || "";
  document.querySelector("#branchCity").value = branch?.city || activeBranchProfile()?.city || "";
  document.querySelector("#branchAddress").value = branch?.address || "";
  document.querySelector("#branchIsActive").checked = branch?.active !== false;
  document.querySelector("#branchActiveRow").hidden = !branch;
  document.querySelector("#branchFormError").textContent = "";
  document.querySelector("#saveBranch").textContent = branch ? "ذخیره تغییرات" : "ساخت شعبه";
  branchFormDialog.showModal();
}

export function wireBranches() {
  document.querySelector("#openBranches").onclick = () => {
    adminDialog.close();
    renderBranches();
    branchesDialog.showModal();
  };
  document.querySelector("#addBranch").onclick = () => openBranchForm();
  document.querySelector("#branchForm").onsubmit = async (event) => {
    event.preventDefault();
    const slug = document.querySelector("#branchSlug").value,
      button = document.querySelector("#saveBranch"),
      error = document.querySelector("#branchFormError"),
      payload = {
        name: document.querySelector("#branchName").value,
        city: document.querySelector("#branchCity").value,
        address: document.querySelector("#branchAddress").value,
        active: document.querySelector("#branchIsActive").checked,
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
