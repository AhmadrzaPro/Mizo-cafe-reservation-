// @ts-check
/** @param {string} selector */
const dialog = (selector) => /** @type {HTMLDialogElement} */ (document.querySelector(selector));
export const adminDialog = dialog("#adminDialog"),
  setupDialog = dialog("#setupDialog"),
  authDialog = dialog("#authDialog"),
  staffDialog = dialog("#staffDialog"),
  staffFormDialog = dialog("#staffFormDialog"),
  smsDialog = dialog("#smsDialog"),
  subscriptionDialog = dialog("#subscriptionDialog"),
  reportsDialog = dialog("#reportsDialog"),
  loyaltyDialog = dialog("#loyaltyDialog"),
  loyaltyAdjustDialog = dialog("#loyaltyAdjustDialog"),
  paymentsDialog = dialog("#paymentsDialog"),
  branchesDialog = dialog("#branchesDialog"),
  branchFormDialog = dialog("#branchFormDialog"),
  editor = dialog("#mapEditorDialog"),
  controlDialog = dialog("#controlDialog"),
  scheduleDialog = dialog("#scheduleDialog");
export const paymentsCard = document.createElement("button");
