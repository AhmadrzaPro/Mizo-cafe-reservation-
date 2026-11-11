// Small booking helpers shared by the staff panels; the booking itself is the 3D floor
// (floor3d/view.js).
import { byId } from "./dom.js";
import { faDigits } from "./format.js";

export { refreshFloor as fetchAvailability } from "./floor3d/view.js";
export const trackingDialog = byId("trackingDialog");
export const money = (value) =>
  `${faDigits(Math.round(Number(value || 0) / 10).toLocaleString("en-US"))} تومان`;
