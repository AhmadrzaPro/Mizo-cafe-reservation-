import { app } from "./api.js";
import { cleanupAuth } from "./auth/session.js";
import { maintenanceOnRequest } from "./maintenance.js";
import { processDueReminders } from "./notifications.js";
import { cleanupRateLimits } from "./rate-limit.js";
import { expireUnpaidReservations } from "./reservations.js";
import { serveStatic } from "./static.js";
import { expireSubscriptions } from "./subscription.js";

/** @typedef {import("./types").Env} Env */

export default {
  /** @param {Request} request @param {Env} env @param {ExecutionContext} ctx */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "GET" && url.pathname.startsWith("/api/cafes/") && env.DB)
        for (const work of maintenanceOnRequest(env)) ctx.waitUntil(work);
      return app.fetch(request, env, ctx);
    }
    return serveStatic(request, env, url);
  },
  /** @param {ScheduledController} controller @param {Env} env @param {ExecutionContext} ctx */
  async scheduled(controller, env, ctx) {
    void controller;
    ctx.waitUntil(
      Promise.all([
        processDueReminders(env),
        expireUnpaidReservations(env.DB),
        expireSubscriptions(env.DB),
        cleanupRateLimits(env.DB),
        cleanupAuth(env.DB),
      ]),
    );
  },
};
