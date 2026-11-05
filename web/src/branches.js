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
  bookingPath,
  fetchMap,
  fetchSettings,
} from "./profile.js";
import { store } from "./state.js";

/** A branch's full booking link, as the owner shares it. @param {import("./types").CafeBranch} branch */
const bookingLink = (branch) => `${location.origin}${bookingPath(store.cafeProfile, branch)}`;
/** The link name a branch would have, shown under the form's field. */
function previewBranchLink() {
  const typed = byId("branchLink").value.trim().toLowerCase();
  byId("branchLinkPreview").textContent = `${location.host}${bookingPath(store.cafeProfile, {
    id: "",
    slug: byId("branchSlug").value || "…",
    name: "",
    city: "",
    address: "",
    link: typed,
  })}`;
}
const LINK_RULE =
  "نام لینک باید ۳ تا ۴۰ حرف انگلیسی کوچک، عدد یا خط تیره باشد و با خط تیره شروع یا تمام نشود.";
const RESERVED_CAFE_LINKS = [
  "api",
  "admin",
  "saas-admin",
  "assets",
  "fonts",
  "static",
  "index",
  "new",
  "www",
  "mizo",
];
/**
 * The same rules the server applies (worker/src/links.js), checked first so the owner hears at
 * once. An empty name is fine: it clears the link.
 * @param {string} value @param {"cafe" | "branch"} kind
 */
function linkProblem(value, kind) {
  const link = value.trim().toLowerCase();
  if (!link) return "";
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(link) || link.includes("--")) return LINK_RULE;
  if (kind === "cafe" && (/^(?:cafe|multi)-/.test(link) || RESERVED_CAFE_LINKS.includes(link)))
    return "این نام برای لینک کافه رزرو شده است؛ نام دیگری انتخاب کنید.";
  if (kind === "branch" && (link === "main" || link.startsWith("branch-")))
    return "این نام برای لینک شعبه رزرو شده است؛ نام دیگری انتخاب کنید.";
  return "";
}
/** Copies a link, or selects it for the owner to copy where the clipboard is not allowed. */
async function copyLink(button, link) {
  try {
    await navigator.clipboard.writeText(link);
    button.textContent = "کپی شد ✓";
  } catch {
    window.prompt("لینک رزرو را کپی کنید:", link);
  }
  setTimeout(() => (button.textContent = "کپی لینک"), 1600);
}

export function renderBranches() {
  byId("cafeLinkOrigin").textContent = `${location.host}/`;
  byId("cafeLink").value = store.cafeProfile.cafe.link || "";
  byId("cafeLink").placeholder = store.cafeProfile.cafe.slug;
  byId("cafeLinkError").textContent = "";
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
          ${branch.active === false ? "" : html`<code class="branch-link" dir="ltr">${bookingLink(branch)}</code>`}
          <span class="branch-state"
            >${branch.active === false ? "غیرفعال" : "فعال و آماده رزرو"}</span
          >
        </div>
        <div class="branch-actions">
          ${branch.active === false ? "" : html`<button class="branch-enter">انتخاب شعبه</button><button class="branch-map">ویرایش نقشه</button><button class="branch-copy">کپی لینک</button>`}<button
            class="branch-edit"
          >
            ویرایش
          </button>
        </div>`,
    );
    /** @type {HTMLButtonElement} */ (card.querySelector(".branch-edit")).onclick = () =>
      openBranchForm(branch);
    card
      .querySelector(".branch-copy")
      ?.addEventListener("click", (event) =>
        copyLink(/** @type {HTMLButtonElement} */ (event.currentTarget), bookingLink(branch)),
      );
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
/** @param {import("./types").CafeBranch | null} [branch] */
export function openBranchForm(branch = null) {
  byId("branchFormTitle").textContent = branch ? "ویرایش شعبه" : "افزودن شعبه جدید";
  byId("branchSlug").value = branch?.slug || "";
  byId("branchName").value = branch?.name || "";
  byId("branchCity").value = branch?.city || activeBranchProfile()?.city || "";
  byId("branchAddress").value = branch?.address || "";
  byId("branchLink").value = branch?.link || "";
  previewBranchLink();
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
  byId("branchLink").oninput = previewBranchLink;
  byId("cafeLinkForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = byId("saveCafeLink"),
      error = byId("cafeLinkError");
    error.textContent = linkProblem(byId("cafeLink").value, "cafe");
    if (error.textContent) return;
    button.disabled = true;
    try {
      const response = await fetch("/api/cafe/link", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ link: byId("cafeLink").value }),
        }),
        profile = await response.json();
      if (!response.ok) throw new Error(profile.message || "ذخیره لینک انجام نشد.");
      applyCafeProfile(profile);
      renderBranches();
      button.textContent = "ذخیره شد ✓";
      setTimeout(() => (button.textContent = "ذخیره لینک"), 1600);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
  byId("branchForm").onsubmit = async (event) => {
    event.preventDefault();
    const slug = byId("branchSlug").value,
      button = byId("saveBranch"),
      error = byId("branchFormError"),
      payload = {
        name: byId("branchName").value,
        city: byId("branchCity").value,
        address: byId("branchAddress").value,
        link: byId("branchLink").value,
        active: byId("branchIsActive").checked,
      };
    error.textContent = linkProblem(payload.link, "branch");
    if (error.textContent) return;
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
