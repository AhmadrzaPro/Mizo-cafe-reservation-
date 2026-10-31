import { fetchAvailability } from "./booking.js";
import { adminDialog, authDialog, paymentsCard, setupDialog } from "./dialogs.js";
import { byId, html, setHtml } from "./dom.js";
import { faDigits, latinDigits } from "./format.js";
import {
  activeBranchProfile,
  applyCafeProfile,
  fetchMap,
  fetchSettings,
  loadCafeProfile,
} from "./profile.js";
import { pageParams, store } from "./state.js";
import { refreshSubscriptionNotice } from "./subscription.js";

export function fillSetupForm(editing = false) {
  byId("setupOwnerFields").hidden = editing;
  byId("setupOwnerMobile").required = !editing;
  const branch = activeBranchProfile();
  byId("setupTitle").textContent = editing
    ? "اطلاعات کافه را ویرایش کن"
    : "کافه‌ات را به میزو معرفی کن";
  byId("setupStep").textContent = editing ? "تنظیمات پایه" : "مرحله ۱ از ۳";
  byId("setupCafeName").value = editing ? store.cafeProfile.cafe.name : "";
  byId("setupCity").value = editing ? branch.city : "";
  byId("setupBranchName").value = editing ? branch.name : "شعبه اصلی";
  byId("setupAddress").value = editing ? branch.address : "";
  /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll('input[name="setupStructure"]')
  ).forEach((input) => (input.disabled = editing));
  /** @type {HTMLInputElement} */ (
    document.querySelector(
      `input[name="setupStructure"][value="${editing ? store.cafeProfile.cafe.structure : "single"}"]`,
    )
  ).checked = true;
  byId("saveSetup").textContent = editing ? "ذخیره تغییرات" : "ساخت کافه و ورود به پنل";
  byId("setupError").textContent = "";
}
export function resetAuthForm() {
  store.otpChallenge = null;
  byId("otpRequestForm").hidden = false;
  byId("otpVerifyForm").hidden = true;
  byId("authError").textContent = "";
  byId("authCode").value = "";
  byId("demoCodeBox").hidden = true;
}
export function hasManagerPermission(permission) {
  return Boolean(store.managerSession?.permissions?.includes(permission));
}
export function applyManagerAccess() {
  if (!store.managerSession) return;
  byId("managerIdentity").textContent =
    `${store.managerSession.name} · ${store.managerSession.roleLabel}`;
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-owner-only]")).forEach(
    (element) => (element.hidden = store.managerSession.role !== "owner"),
  );
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-manage-only]")).forEach(
    (element) => {
      const permission =
        element.id === "openMapEditor"
          ? "map.write"
          : element.id === "openSchedule"
            ? "schedule.write"
            : "settings.write";
      element.hidden = !hasManagerPermission(permission);
    },
  );
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-permission]")).forEach(
    (element) => (element.hidden = !hasManagerPermission(element.dataset.permission)),
  );
  if (store.managerSession.branchId) {
    const branch = store.cafeProfile.branches.find(
      (item) => item.id === store.managerSession.branchId,
    );
    if (branch) store.currentBranch = branch.slug;
  }
  applyCafeProfile(store.cafeProfile);
  refreshSubscriptionNotice();
  showActiveDevices();
}
// How many devices this staff member is signed in on, next to "sign out everywhere".
async function showActiveDevices() {
  const label = byId("managerDevices");
  label.textContent = "";
  try {
    const response = await fetch("/api/auth/sessions");
    if (!response.ok) return;
    const { sessions } = await response.json();
    if (sessions.length > 1) label.textContent = `فعال روی ${faDigits(sessions.length)} دستگاه`;
  } catch {
    // The count is informational; the panel works without it.
  }
}
export async function loadManagerSession() {
  try {
    const response = await fetch("/api/auth/session"),
      data = await response.json();
    store.managerSession = data.authenticated ? data.staff : null;
    if (store.managerSession) applyManagerAccess();
    return store.managerSession;
  } catch {
    return null;
  }
}
export function showManagerLogin() {
  resetAuthForm();
  if (!authDialog.open) authDialog.showModal();
}
export async function openManager() {
  if (pageParams.get("new") !== "1" && (await loadManagerSession())) {
    store.currentCafeSlug = store.managerSession.cafeSlug;
    const own = await loadCafeProfile();
    if (own.configured) {
      applyCafeProfile(own);
      await Promise.all([fetchMap(), fetchSettings()]);
      await fetchAvailability();
      adminDialog.showModal();
      return;
    }
  }
  const profile = await loadCafeProfile();
  if (!profile.configured) {
    fillSetupForm(false);
    setupDialog.showModal();
    return;
  }
  applyCafeProfile(profile);
  showManagerLogin();
}

export function wireManager() {
  paymentsCard.className = "admin-feature payments-feature";
  paymentsCard.id = "openPayments";
  paymentsCard.dataset.permission = "payments.read";
  setHtml(
    paymentsCard,
    html`<b>پرداخت و بیعانه</b><span>قوانین بیعانه و تراکنش‌های هر شعبه</span
      ><em>مدیریت پرداخت‌ها ←</em>`,
  );
  document.querySelector(".admin-grid").appendChild(paymentsCard);
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-open-demo]")).forEach(
    (b) => (b.onclick = openManager),
  );
  byId("adminClose").onclick = () => adminDialog.close();
  byId("editCafeProfile").onclick = () => {
    adminDialog.close();
    fillSetupForm(true);
    setupDialog.showModal();
  };
  byId("setupForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = byId("saveSetup"),
      error = byId("setupError"),
      editing = store.cafeProfile.configured,
      payload = {
        ownerMobile: latinDigits(byId("setupOwnerMobile").value),
        ownerName: byId("setupOwnerName").value,
        cafeName: byId("setupCafeName").value,
        city: byId("setupCity").value,
        branchName: byId("setupBranchName").value,
        address: byId("setupAddress").value,
        branchSlug: store.currentBranch,
        structure: /** @type {HTMLInputElement} */ (
          document.querySelector('input[name="setupStructure"]:checked')
        ).value,
      };
    button.disabled = true;
    button.textContent = "در حال آماده‌سازی کافه…";
    error.textContent = "";
    try {
      const response = await fetch("/api/setup", {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        profile = await response.json();
      if (!response.ok) throw new Error(profile.message || "ذخیره اطلاعات انجام نشد.");
      applyCafeProfile(profile);
      await Promise.all([fetchMap(), fetchSettings()]);
      await fetchAvailability();
      setupDialog.close();
      if (editing) adminDialog.showModal();
      else showManagerLogin();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = editing ? "ذخیره تغییرات" : "ساخت کافه و ورود به پنل";
    }
  };
  byId("otpRequestForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = byId("requestOtp"),
      error = byId("authError"),
      mobile = latinDigits(byId("authMobile").value);
    button.disabled = true;
    button.textContent = "در حال ارسال…";
    error.textContent = "";
    try {
      const response = await fetch("/api/auth/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mobile, cafeSlug: store.currentCafeSlug }),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ارسال کد انجام نشد.");
      store.otpChallenge = { id: data.challengeId, mobile };
      byId("otpRequestForm").hidden = true;
      byId("otpVerifyForm").hidden = false;
      byId("authNameRow").hidden = !data.requiresBootstrap;
      byId("authName").required = Boolean(data.requiresBootstrap);
      if (data.demoCode) {
        byId("demoCode").textContent = faDigits(data.demoCode);
        byId("demoCodeBox").hidden = false;
      }
      byId("authCode").focus();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = "دریافت کد ورود";
    }
  };
  byId("otpVerifyForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = byId("verifyOtp"),
      error = byId("authError");
    button.disabled = true;
    button.textContent = "در حال بررسی…";
    error.textContent = "";
    try {
      const response = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cafeSlug: store.currentCafeSlug,
            challengeId: store.otpChallenge?.id,
            mobile: store.otpChallenge?.mobile,
            code: latinDigits(byId("authCode").value),
            name: byId("authName").value,
          }),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ورود انجام نشد.");
      store.managerSession = data.staff;
      applyManagerAccess();
      authDialog.close();
      adminDialog.showModal();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = "ورود به پنل";
    }
  };
  byId("retryOtp").onclick = resetAuthForm;
  byId("logoutEverywhere").onclick = async () => {
    if (!confirm("از همه دستگاه‌ها، از جمله همین دستگاه، خارج شوید؟")) return;
    await fetch("/api/auth/logout-all", { method: "POST" });
    store.managerSession = null;
    adminDialog.close();
    showManagerLogin();
  };
  byId("logoutManager").onclick = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    store.managerSession = null;
    adminDialog.close();
    showManagerLogin();
  };
}
