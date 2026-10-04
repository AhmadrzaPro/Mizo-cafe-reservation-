import { adminDialog, staffDialog, staffFormDialog } from "./dialogs.js";
import { faDigits, latinDigits } from "./format.js";
import { escapeHtml } from "./operations.js";
import { store } from "./state.js";

export function renderStaff() {
  const list = document.querySelector("#staffList");
  list.innerHTML = "";
  if (!store.staffMembers.length) {
    list.innerHTML = '<div class="branch-empty">هنوز پرسنلی ثبت نشده است.</div>';
    return;
  }
  store.staffMembers.forEach((member) => {
    const card = document.createElement("article");
    card.className = `staff-card${member.active ? "" : " inactive"}`;
    card.innerHTML = `<span class="staff-avatar">${escapeHtml(member.name.trim().charAt(0) || "پ")}</span><div><h3>${escapeHtml(member.name)}</h3><p>${faDigits(member.mobile)} · ${escapeHtml(member.branchName)}</p><span class="staff-role">${escapeHtml(member.roleLabel)}${member.active ? "" : " · غیرفعال"}</span></div><button>ویرایش دسترسی</button>`;
    card.querySelector("button").onclick = () => openStaffForm(member);
    list.appendChild(card);
  });
}
export async function fetchStaff() {
  const error = document.querySelector("#staffError");
  error.textContent = "";
  try {
    const response = await fetch("/api/staff"),
      data = await response.json();
    if (!response.ok) throw new Error(data.message || "دریافت پرسنل انجام نشد.");
    store.staffMembers = data.staff;
    renderStaff();
  } catch (err) {
    error.textContent = err.message;
  }
}
export function syncStaffRole() {
  const role = document.querySelector("#staffRole").value,
    owner = role === "owner",
    details =
      {
        owner: [
          "همه شعب",
          "مدیریت تیم و شعب",
          "تنظیمات، نقشه و ساعت کاری",
          "رزرو، پیامک و وضعیت میزها",
        ],
        branch_manager: [
          "فقط شعبه انتخاب‌شده",
          "تنظیمات، نقشه و ساعت کاری",
          "رزرو و تنظیمات پیامک",
          "وضعیت میزها",
        ],
        reception: [
          "فقط شعبه انتخاب‌شده",
          "ثبت و ویرایش رزرو",
          "مدیریت لیست انتظار",
          "مشاهده وضعیت پیامک‌ها",
        ],
        barista: ["فقط شعبه انتخاب‌شده", "مشاهده نقشه زنده سالن", "تغییر وضعیت میزها"],
      }[role] || [];
  document.querySelector("#staffBranchRow").hidden = owner;
  document.querySelector("#staffBranch").required = !owner;
  document.querySelector("#staffPermissionPreview").innerHTML =
    `<b>این نقش چه دسترسی‌هایی دارد؟</b><ul>${details.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}
export function openStaffForm(member = null) {
  document.querySelector("#staffFormTitle").textContent = member ? "ویرایش دسترسی" : "افزودن پرسنل";
  document.querySelector("#staffId").value = member?.id || "";
  document.querySelector("#staffName").value = member?.name || "";
  document.querySelector("#staffMobile").value = member?.mobile || "";
  document.querySelector("#staffRole").value = member?.role || "reception";
  const branchSelect = document.querySelector("#staffBranch");
  branchSelect.innerHTML = "";
  store.cafeProfile.branches
    .filter((branch) => branch.active !== false)
    .forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch.id;
      option.textContent = branch.name;
      option.selected = branch.id === member?.branchId;
      branchSelect.appendChild(option);
    });
  document.querySelector("#staffIsActive").checked = member?.active !== false;
  const self = member?.id === store.managerSession?.id;
  document.querySelector("#staffRole").disabled = self;
  document.querySelector("#staffIsActive").disabled = self;
  document.querySelector("#staffFormError").textContent = "";
  document.querySelector("#saveStaff").textContent = member ? "ذخیره تغییرات" : "افزودن به تیم";
  syncStaffRole();
  staffFormDialog.showModal();
}

export function wireStaff() {
  document.querySelector("#staffRole").onchange = syncStaffRole;
  document.querySelector("#openStaff").onclick = async () => {
    adminDialog.close();
    staffDialog.showModal();
    await fetchStaff();
  };
  document.querySelector("#addStaff").onclick = () => openStaffForm();
  document.querySelector("#staffForm").onsubmit = async (event) => {
    event.preventDefault();
    const id = document.querySelector("#staffId").value,
      button = document.querySelector("#saveStaff"),
      error = document.querySelector("#staffFormError"),
      payload = {
        name: document.querySelector("#staffName").value,
        mobile: latinDigits(document.querySelector("#staffMobile").value),
        role: document.querySelector("#staffRole").value,
        branchId: document.querySelector("#staffBranch").value,
        active: document.querySelector("#staffIsActive").checked,
      };
    button.disabled = true;
    button.textContent = "در حال ذخیره…";
    error.textContent = "";
    try {
      const response = await fetch(id ? `/api/staff/${encodeURIComponent(id)}` : "/api/staff", {
          method: id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        data = await response.json();
      if (!response.ok) throw new Error(data.message || "ذخیره پرسنل انجام نشد.");
      store.staffMembers = data.staff;
      renderStaff();
      staffFormDialog.close();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
      button.textContent = id ? "ذخیره تغییرات" : "افزودن به تیم";
    }
  };
}
