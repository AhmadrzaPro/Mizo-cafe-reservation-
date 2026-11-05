import { cloneDefault } from "./map-defaults.js";

export const state = {
  guests: 2,
  date: "",
  dateLabel: "",
  time: "",
  table: "",
  tableId: "",
  availableTableIds: new Set(),
  availability: /** @type {import("./types").Availability | null} */ (null),
  /** The table held for this booking while the customer fills in the form (table-hold.js). */
  hold: /** @type {{ id: string, token: string, tableId: string, expiresAt: string } | null} */ (
    null
  ),
};
// globalThis keeps this module importable outside a browser (unit tests).
export const pageParams = new URLSearchParams(globalThis.location?.search);
export const studioDemo = pageParams.get("studio") === "1";
/** The booking link the page was opened at, /<café>/<branch>: slugs or the owner's link names. */
export const pagePath = (() => {
  const parts = String(globalThis.location?.pathname || "/")
    .split("/")
    .filter(Boolean);
  const valid = parts.length <= 2 && parts.every((part) => /^[a-z0-9-]{1,64}$/.test(part));
  return { cafe: valid ? parts[0] || "" : "", branch: valid ? parts[1] || "" : "" };
})();
export const mapViewportPointers = new Map();

// Mutable application state shared across modules (formerly top-level `let` globals).
export const store = {
  mapHistory: /** @type {string[]} */ ([]),
  mapHistoryIndex: -1,
  mapSnap: true,
  mapMaterial: true,
  customerMapZoom: 1,
  opsMapZoom: 1,
  cafeMap: cloneDefault(),
  activeArea: "main",
  customerArea: "main",
  selectedId: /** @type {string | null} */ (null),
  zoom: 1,
  dirty: false,
  currentCafeSlug: pageParams.get("cafe") || pagePath.cafe,
  currentBranch: "main",
  // Replaced by the café's real profile once it loads; no café is shown before that.
  cafeProfile: /** @type {import("./types").CafeProfile} */ ({
    configured: false,
    cafe: { slug: "", name: "", structure: "single" },
    branches: [{ id: "", slug: "main", name: "شعبه اصلی", city: "", address: "" }],
  }),
  cafeSettings: {
    reservationsEnabled: true,
    autoConfirm: true,
    reservationDuration: 90,
    maxPartySize: 8,
    customerNotice: "",
    bufferMinutes: 15,
    slotInterval: 30,
    depositEnabled: false,
    depositMode: "fixed",
    depositAmountRials: 2000000,
    depositPeakOnly: false,
    depositPeakStart: "18:00",
    depositPeakEnd: "22:00",
    paymentDeadlineMinutes: 15,
    refundPolicy: "تا ۲ ساعت قبل از زمان رزرو، بیعانه کامل بازگردانده می‌شود.",
  },
  cafeSchedule: {
    hours: /** @type {import("./types").OpeningHours[]} */ ([]),
    closures: /** @type {import("./types").Closure[]} */ ([]),
  },
  jalaliTarget: /** @type {HTMLInputElement | null} */ (null),
  jalaliAnchor: new Date(),
  managerSession: /** @type {import("./types").ManagerSession | null} */ (null),
  otpChallenge: /** @type {import("./types").OtpChallenge | null} */ (null),
  // Modal scroll lock (modal.js).
  modalScrollY: 0,
  modalScrollLocked: false,
  availabilityRequest: 0,
  mapPreviewMode: false,
  pendingPayment: /** @type {import("./types").PendingPayment | null} */ (null),
  staffMembers: /** @type {import("./types").StaffMember[]} */ ([]),
  smsData: /** @type {import("./types").SmsData | null} */ (null),
  subscriptionData: /** @type {import("./types").SubscriptionData | null} */ (null),
  reportsData: /** @type {import("./types").ReportsData | null} */ (null),
  loyaltyData: /** @type {import("./types").LoyaltyData | null} */ (null),
  mapImageData: "",
  mapImageDraft: /** @type {import("./types").DraftTable[]} */ ([]),
  mapImageArea: "",
  mapImageBranch: "",
  mapImageRequest: 0,
  opsData: /** @type {import("./types").OpsData | null} */ (null),
  opsRefreshTimer: /** @type {ReturnType<typeof setInterval> | null} */ (null),
  opsAreaId: "",
};
