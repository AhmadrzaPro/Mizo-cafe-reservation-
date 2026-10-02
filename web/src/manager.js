import { fetchAvailability } from "./booking.js";
import { adminDialog, authDialog, paymentsCard, setupDialog } from "./dialogs.js";
import { faDigits, latinDigits } from "./format.js";
import {
  activeBranchProfile,
  applyCafeProfile,
  fetchMap,
  fetchSettings,
  loadCafeProfile,
} from "./profile.js";
import { pageParams, store } from "./state.js";

export function fillSetupForm(editing = false) {
  document.querySelector("#setupOwnerFields").hidden = editing;
  document.querySelector("#setupOwnerMobile").required = !editing;
  const branch = activeBranchProfile();
  document.querySelector("#setupTitle").textContent = editing
    ? "اطلاعات کافه را ویرایش کن"
    : "کافه‌ات را به میزو معرفی کن";
  document.querySelector("#setupStep").textContent = editing ? "تنظیمات پایه" : "مرحله ۱ از ۳";
  document.querySelector("#setupCafeName").value = editing ? store.cafeProfile.cafe.name : "";
  document.querySelector("#setupCity").value = editing ? branch.city : "";
  document.querySelector("#setupBranchName").value = editing ? branch.name : "شعبه اصلی";
  document.querySelector("#setupAddress").value = editing ? branch.address : "";
  document
    .querySelectorAll('input[name="setupStructure"]')
    .forEach((input) => (input.disabled = editing));
  document.querySelector(
    `input[name="setupStructure"][value="${editing ? store.cafeProfile.cafe.structure : "single"}"]`,
  ).checked = true;
  document.querySelector("#saveSetup").textContent = editing
    ? "ذخیره تغییرات"
    : "ساخت کافه و ورود به پنل";
  document.querySelector("#setupError").textContent = "";
}
export function resetAuthForm() {
  store.otpChallenge = null;
  document.querySelector("#otpRequestForm").hidden = false;
  document.querySelector("#otpVerifyForm").hidden = true;
  document.querySelector("#authError").textContent = "";
  document.querySelector("#authCode").value = "";
  document.querySelector("#demoCodeBox").hidden = true;
}
export function hasManagerPermission(permission) {
  return Boolean(store.managerSession?.permissions?.includes(permission));
}
export function applyManagerAccess() {
  if (!store.managerSession) return;
  document.querySelector("#managerIdentity").textContent =
    `${store.managerSession.name} · ${store.managerSession.roleLabel}`;
  document
    .querySelectorAll("[data-owner-only]")
    .forEach((element) => (element.hidden = store.managerSession.role !== "owner"));
  document.querySelectorAll("[data-manage-only]").forEach((element) => {
    const permission =
      element.id === "openMapEditor"
        ? "map.write"
        : element.id === "openSchedule"
          ? "schedule.write"
          : "settings.write";
    element.hidden = !hasManagerPermission(permission);
  });
  document
    .querySelectorAll("[data-permission]")
    .forEach((element) => (element.hidden = !hasManagerPermission(element.dataset.permission)));
  if (store.managerSession.branchId) {
    const branch = store.cafeProfile.branches.find(
      (item) => item.id === store.managerSession.branchId,
    );
    if (branch) store.currentBranch = branch.slug;
  }
  applyCafeProfile(store.cafeProfile);
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
  paymentsCard.innerHTML =
    "<b>پرداخت و بیعانه</b><span>قوانین بیعانه و تراکنش‌های هر شعبه</span><em>مدیریت پرداخت‌ها ←</em>";
  document.querySelector(".admin-grid").appendChild(paymentsCard);
  document.querySelectorAll("[data-open-demo]").forEach((b) => (b.onclick = openManager));
  document.querySelector("#adminClose").onclick = () => adminDialog.close();
  document.querySelector("#editCafeProfile").onclick = () => {
    adminDialog.close();
    fillSetupForm(true);
    setupDialog.showModal();
  };
  document.querySelector("#setupForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = document.querySelector("#saveSetup"),
      error = document.querySelector("#setupError"),
      editing = store.cafeProfile.configured,
      payload = {
        ownerMobile: latinDigits(document.querySelector("#setupOwnerMobile").value),
        ownerName: document.querySelector("#setupOwnerName").value,
        cafeName: document.querySelector("#setupCafeName").value,
        city: document.querySelector("#setupCity").value,
        branchName: document.querySelector("#setupBranchName").value,
        address: document.querySelector("#setupAddress").value,
        branchSlug: store.currentBranch,
        structure: document.querySelector('input[name="setupStructure"]:checked').value,
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
  document.querySelector("#otpRequestForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = document.querySelector("#requestOtp"),
      error = document.querySelector("#authError"),
      mobile = latinDigits(document.querySelector("#authMobile").value);
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
      document.querySelector("#otpRequestForm").hidden = true;
      document.querySelector("#otpVerifyForm").hidden = false;
      document.querySelector("#authNameRow").hidden = !data.requiresBootstrap;
      document.querySelector("#authName").required = Boolean(data.requiresBootstrap);
      if (data.demoCode) {
        document.querySelector("#demoCode").textContent = faDigits(data.demoCode);
        document.querySelector("#demoCodeBox").hidden = false;
      }
      document.querySelector("#authCode").focus();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = "دریافت کد ورود";
    }
  };
  document.querySelector("#otpVerifyForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = document.querySelector("#verifyOtp"),
      error = document.querySelector("#authError");
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
            code: latinDigits(document.querySelector("#authCode").value),
            name: document.querySelector("#authName").value,
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
  document.querySelector("#retryOtp").onclick = resetAuthForm;
  document.querySelector("#logoutManager").onclick = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    store.managerSession = null;
    adminDialog.close();
    showManagerLogin();
  };
}
