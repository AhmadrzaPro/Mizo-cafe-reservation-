import { cloneDefault } from "./map-defaults.js";

export const state = {
  guests: 2,
  date: "",
  dateLabel: "",
  time: "",
  table: "",
  tableId: "",
  availableTableIds: new Set(),
  availability: null,
};
// globalThis keeps this module importable outside a browser (unit tests).
export const pageParams = new URLSearchParams(globalThis.location?.search);
export const studioDemo = pageParams.get("studio") === "1";
export const mapViewportPointers = new Map();

// Mutable application state shared across modules (formerly top-level `let` globals).
export const store = {
  mapHistory: [],
  mapHistoryIndex: -1,
  mapSnap: true,
  mapMaterial: true,
  customerMapZoom: 1,
  opsMapZoom: 1,
  cafeMap: cloneDefault(),
  activeArea: "main",
  customerArea: "main",
  selectedId: null,
  zoom: 1,
  dirty: false,
  currentCafeSlug: pageParams.get("cafe") || "",
  currentBranch: "main",
  cafeProfile: {
    configured: false,
    cafe: { slug: "roma", name: "کافه روما", structure: "single" },
    branches: [
      { slug: "elahiye", name: "شعبه الهیه", city: "تهران", address: "" },
      { slug: "shahrak-gharb", name: "شعبه شهرک غرب", city: "تهران", address: "" },
    ],
  },
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
  cafeSchedule: { hours: [], closures: [] },
  jalaliTarget: null,
  jalaliAnchor: new Date(),
  managerSession: null,
  otpChallenge: null,
  // Modal scroll lock (modal.js).
  modalScrollY: 0,
  modalScrollLocked: false,
  availabilityRequest: 0,
  mapPreviewMode: false,
  pendingPayment: null,
  staffMembers: [],
  smsData: null,
  subscriptionData: null,
  reportsData: null,
  loyaltyData: null,
  mapImageData: "",
  mapImageDraft: [],
  mapImageArea: "",
  mapImageBranch: "",
  mapImageRequest: 0,
  opsData: null,
  opsRefreshTimer: null,
  opsAreaId: "",
};
