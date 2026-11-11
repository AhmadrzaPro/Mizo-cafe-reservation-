import { settingsUrl } from "./api.js";
import { renderControls } from "./controls.js";
import { repaintFloor } from "./floor3d/view.js";
import { byId, required } from "./dom.js";
import { pagePath, pageParams, state, store } from "./state.js";

// The branch the page was opened for (its slug or link name), applied once the profile loads.
let requestedBranch = pageParams.get("branch") || pagePath.branch;

export function activeBranches() {
  return store.cafeProfile.branches.filter(
    (branch) =>
      branch.active !== false &&
      (!store.managerSession?.branchId || branch.id === store.managerSession.branchId),
  );
}
export function activeBranchProfile() {
  return (
    store.cafeProfile.branches.find((branch) => branch.slug === store.currentBranch) ||
    activeBranches()[0] ||
    store.cafeProfile.branches[0]
  );
}
export function syncBranchSelectors() {
  const branches = activeBranches(),
    single = branches.length === 1;
  [
    "branchSelect",
    "controlBranch",
    "opsBranch",
    "smsBranch",
    "paymentsBranch",
    "floorBranch",
  ].forEach((id) => {
    const select = /** @type {HTMLSelectElement} */ (document.querySelector(`#${id}`));
    if (!select) return;
    select.replaceChildren();
    branches.forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch.slug;
      option.textContent = branch.name;
      select.appendChild(option);
    });
    select.value = store.currentBranch;
    select.classList.toggle("single-branch", single);
  });
  byId("floorBranch").hidden = single;
}
/**
 * A branch's booking link path: /<café>/<branch>, with the owner's link names where set.
 * @param {import("./types").CafeProfile} profile @param {import("./types").CafeBranch} branch
 */
export function bookingPath(profile, branch) {
  return `/${profile.cafe.link || profile.cafe.slug}/${branch.link || branch.slug}`;
}
export function applyCafeProfile(profile) {
  if (!profile?.configured) return;
  store.cafeProfile = profile;
  store.currentCafeSlug = profile.cafe.slug;
  if (requestedBranch) {
    const asked = profile.branches.find(
      (b) => b.active !== false && (b.slug === requestedBranch || b.link === requestedBranch),
    );
    if (asked) store.currentBranch = asked.slug;
    requestedBranch = "";
  }
  if (
    !profile.branches.some(
      (branch) => branch.slug === store.currentBranch && branch.active !== false,
    )
  )
    store.currentBranch = activeBranches()[0]?.slug || profile.branches[0]?.slug || "main";
  syncBranchSelectors();
  const branch = activeBranchProfile();
  if (!branch) return;
  // The address bar always shows the readable booking link of the café and branch on screen.
  const url = new URL(location.href);
  url.pathname = bookingPath(profile, branch);
  ["cafe", "branch", "new"].forEach((name) => url.searchParams.delete(name));
  history.replaceState(null, "", url);
  pageParams.delete("new");
  byId("floorCafeName").textContent = profile.cafe.name;
  byId("floorCafePlace").textContent = [branch.city, branch.name].filter(Boolean).join("، ");
  document.body.dataset.mode = "cafe";
  document.title = `${profile.cafe.name} — رزرو میز`;
  byId("adminCafeName").textContent = profile.cafe.name;
  byId("adminCafeLocation").textContent = `${branch.city} · ${branch.name}`;
  required(".ops-brand b").textContent = `عملیات ${profile.cafe.name}`;
}
export async function loadCafeProfile() {
  if (pageParams.get("new") === "1") return { configured: false };
  try {
    const response = await fetch(
        "/api/setup" +
          (store.currentCafeSlug ? "?cafe=" + encodeURIComponent(store.currentCafeSlug) : ""),
      ),
      profile = await response.json();
    if (response.ok && profile.configured) applyCafeProfile(profile);
    return profile;
  } catch {
    return { configured: false };
  }
}
export function applySettingsToCustomer() {
  // Paused by the café, or by an unpaid subscription past its grace period: the floor says so.
  if (state.guests > store.cafeSettings.maxPartySize)
    state.guests = store.cafeSettings.maxPartySize;
}
export async function fetchSettings() {
  try {
    const response = await fetch(settingsUrl());
    if (response.ok) {
      store.cafeSettings = await response.json();
      applySettingsToCustomer();
      renderControls();
      repaintFloor();
      return true;
    }
  } catch {}
  byId("controlSaveStatus").textContent = "دریافت تنظیمات ممکن نیست";
  return false;
}
