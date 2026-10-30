import { zarinpalGateway } from "./gateways/zarinpal.js";
import { isDemo } from "./util/env.js";
// The configured real payment gateway, or null. PAYMENT_GATEWAY names it; another gateway is added
// by giving it the same shape as zarinpalGateway (name, request, verify).
/** @param {import("./types").Env} env */
export function paymentGateway(env) {
  if (env.PAYMENT_GATEWAY === "zarinpal") return zarinpalGateway(env);
  return null;
}
// How deposits are taken: a real gateway, simulated payments (DEMO_MODE) or not at all.
/** @param {import("./types").Env} env @returns {"zarinpal" | "demo" | "none"} */
export function paymentMode(env) {
  const gateway = paymentGateway(env);
  if (gateway) return /** @type {"zarinpal"} */ (gateway.name);
  return isDemo(env) ? "demo" : "none";
}
