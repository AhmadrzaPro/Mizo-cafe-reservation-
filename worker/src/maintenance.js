import { processDueReminders } from "./notifications.js";
import { cleanupRateLimits } from "./rate-limit.js";
import { expireSubscriptions } from "./subscription.js";

// Background work that the `scheduled` handler does on a cron. Hosts without a cron trigger never
// call it, so café API requests also run it, throttled per isolate: due reminders at most once a
// minute (their timing matters), housekeeping at most every ten minutes.
const REMINDERS_EVERY = 60000,
  HOUSEKEEPING_EVERY = 600000;
let lastReminders = 0,
  lastHousekeeping = 0;

/** @param {import("./types").Env} env @returns {Promise<unknown>[]} */
export function maintenanceOnRequest(env, now = Date.now()) {
  const work = [];
  if (now - lastReminders >= REMINDERS_EVERY) {
    lastReminders = now;
    work.push(processDueReminders(env));
  }
  if (now - lastHousekeeping >= HOUSEKEEPING_EVERY) {
    lastHousekeeping = now;
    work.push(cleanupRateLimits(env.DB, now), expireSubscriptions(env.DB));
  }
  // Background failures are logged, never surfaced to the request that triggered them.
  return work.map((promise) =>
    promise.catch((error) => console.error("maintenance_failed", error)),
  );
}
