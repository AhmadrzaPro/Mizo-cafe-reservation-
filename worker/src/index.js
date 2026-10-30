import { Hono } from "hono";
import { requestOtp, verifyOtp } from "./auth/otp.js";
import {
  canUseBranch,
  hasPermission,
  logout,
  sessionStaff,
  staffSessionPublic,
} from "./auth/session.js";
import { availability } from "./availability.js";
import { branchRow, createBranch, updateBranch } from "./branches.js";
import { clientIp, InvalidJsonError, readJson, reply } from "./http.js";
import { adjustLoyalty, readLoyalty } from "./loyalty.js";
import { analyzeMapImage, readMap, writeMap } from "./map.js";
import {
  processDueReminders,
  readNotifications,
  writeNotificationSettings,
} from "./notifications.js";
import {
  createWaitlist,
  readOperations,
  updateOperationalReservation,
  updateTableStatus,
  updateWaitlist,
} from "./operations.js";
import { paymentMode } from "./gateway.js";
import {
  completeGatewayPayment,
  payReservation,
  readPayments,
  refundPayment,
  reviewCardTransfer,
  submitCardTransfer,
} from "./payments.js";
import {
  cleanupRateLimits,
  cleanupRateLimitsOccasionally,
  consumeLimit,
  limits,
  rateLimitedReply,
} from "./rate-limit.js";
import { readReports } from "./reports.js";
import {
  cancelReservation,
  createReservation,
  expireUnpaidReservations,
  lookupReservation,
  publicReservation,
} from "./reservations.js";
import { readSaasOverview, requireSaasAdmin, updateSaasAccount } from "./saas-admin.js";
import { InvalidBodyError, readBody, schemas } from "./schemas.js";
import { readSchedule, readSettings, writeSchedule, writeSettings } from "./settings.js";
import { readSetup, writeSetup } from "./setup.js";
import { listStaff, saveStaff } from "./staff.js";
import { serveStatic } from "./static.js";
import { readSubscription, renewSubscriptionDemo, updateSubscription } from "./subscription.js";
import { tehranNow, validDate, validTime } from "./util/dates.js";
import { isDemo } from "./util/env.js";
import { safeSlug } from "./util/ids.js";

/** @typedef {import("./types").Env} Env */
/** @typedef {import("./types").Staff} Staff */
/** @typedef {import("./types").Branch} Branch */
/** @typedef {{ Bindings: Env, Variables: { session: Staff, branch: Branch } }} AppEnv */
/** @typedef {import("hono").Context<AppEnv>} Ctx */

const methodNotAllowed = () => reply({ error: "method_not_allowed" }, 405);
const authenticationRequired = () =>
  reply({ error: "authentication_required", message: "ابتدا وارد پنل شوید." }, 401);
const forbidden = (message) => reply({ error: "forbidden", message }, 403);
/** @param {Ctx} c @param {keyof typeof limits} policy @param {string} name */
const withinLimit = (c, policy, name) =>
  consumeLimit(c.env, limits[policy], `${name}:ip:${clientIp(c.req.raw, c.env)}`);
/** @param {Ctx} c */
const cafeQuery = (c) => c.req.query("cafe") || c.env.DEFAULT_CAFE_SLUG;

/** Requires a signed-in staff member and stores it as `session`. */
/** @type {import("hono").MiddlewareHandler<AppEnv>} */
const requireStaff = async (c, next) => {
  const session = await sessionStaff(c.env.DB, c.req.raw);
  if (!session) return authenticationRequired();
  c.set("session", session);
  await next();
};
/** Requires the café owner. */
const requireOwner = (message) =>
  /** @type {import("hono").MiddlewareHandler<AppEnv>} */ (
    async (c, next) => {
      const session = await sessionStaff(c.env.DB, c.req.raw);
      if (!session || session.role !== "owner") return forbidden(message);
      c.set("session", session);
      await next();
    }
  );
/**
 * Loads the active branch of the URL and requires a staff member who may use it with
 * `permission`. With `missingBranch` a branch that does not exist answers 404 before any auth.
 * @param {string | ((c: Ctx) => string)} permission
 * @param {string} message
 * @param {{ missingBranch?: boolean }} [options]
 */
const requireBranch = (permission, message, { missingBranch = false } = {}) =>
  /** @type {import("hono").MiddlewareHandler<AppEnv>} */ (
    async (c, next) => {
      const branch = await branchRow(c.env.DB, c.req.param("cafe"), c.req.param("branch"));
      if (missingBranch && !branch) return reply({ error: "branch_not_found" }, 404);
      const session = await sessionStaff(c.env.DB, c.req.raw),
        needed = typeof permission === "function" ? permission(c) : permission;
      if (!session || !branch || !canUseBranch(session, branch) || !hasPermission(session, needed))
        return forbidden(message);
      c.set("session", session);
      c.set("branch", branch);
      await next();
    }
  );
/** Branch resources that need a published branch but no staff (availability, public booking). */
/** @type {import("hono").MiddlewareHandler<AppEnv>} */
const loadBranch = async (c, next) => {
  const branch = await branchRow(c.env.DB, c.req.param("cafe"), c.req.param("branch"));
  if (!branch)
    return reply({ error: "branch_not_found", message: "ابتدا نقشه شعبه را منتشر کنید." }, 404);
  c.set("branch", branch);
  await next();
};
/** @param {Ctx} c */
const branchSettings = (c) => readSettings(c.env.DB, c.req.param("cafe"), c.req.param("branch"));

/** @type {Hono<AppEnv>} */
const app = new Hono();

app.use("/api/*", async (c, next) => {
  if (!c.env.DB) return reply({ error: "database_unavailable" }, 503);
  await next();
});

// Auth
app.post("/api/auth/request", async (c) => {
  if (!(await withinLimit(c, "otpPerIp", "otp"))) return rateLimitedReply();
  return requestOtp(c.env, await readBody(c.req.raw, schemas.otpRequest));
});
app.post("/api/auth/verify", async (c) => {
  if (!(await withinLimit(c, "otpVerifyPerIp", "otp-verify"))) return rateLimitedReply();
  return verifyOtp(c.env, await readBody(c.req.raw, schemas.otpVerify));
});
app.get("/api/auth/session", async (c) => {
  const session = await sessionStaff(c.env.DB, c.req.raw);
  return reply(
    session
      ? { authenticated: true, staff: staffSessionPublic(session) }
      : { authenticated: false },
  );
});
app.post("/api/auth/logout", (c) => logout(c.env, c.req.raw));

// Café-wide staff areas
app.get("/api/reports", requireStaff, (c) =>
  readReports(c.env.DB, c.get("session"), new URL(c.req.url)),
);
app.get("/api/payments", requireStaff, (c) =>
  readPayments(c.env.DB, c.get("session"), new URL(c.req.url), paymentMode(c.env)),
);
app.post("/api/payments/:id/refund", requireStaff, (c) =>
  refundPayment(c.env.DB, c.get("session"), c.req.param("id"), { demo: isDemo(c.env) }),
);
app.post("/api/payments/transfers/:id/:decision{approve|reject}", requireStaff, (c) =>
  reviewCardTransfer(
    c.env,
    c.get("session"),
    c.req.param("id"),
    c.req.param("decision") === "approve",
  ),
);
// The gateway returns the customer here after payment; the response redirects to the booking page.
app.get("/api/payments/:provider/callback", (c) =>
  completeGatewayPayment(c.env, c.req.param("provider"), new URL(c.req.url)),
);
app.get("/api/loyalty", requireStaff, (c) =>
  readLoyalty(c.env.DB, c.get("session"), new URL(c.req.url)),
);
app.patch("/api/loyalty/:customer", requireStaff, async (c) =>
  adjustLoyalty(c.env.DB, c.get("session"), c.req.param("customer"), await readJson(c.req.raw)),
);
app.get("/api/subscription", requireStaff, async (c) =>
  reply(await readSubscription(c.env.DB, c.get("session").cafe_id)),
);
app.put("/api/subscription", requireStaff, async (c) =>
  updateSubscription(c.env.DB, c.get("session"), await readJson(c.req.raw)),
);
app.post("/api/subscription/renew", requireStaff, (c) =>
  isDemo(c.env)
    ? renewSubscriptionDemo(c.env.DB, c.get("session"))
    : reply({ error: "payment_not_configured" }, 503),
);
app.get("/api/staff", requireStaff, (c) => listStaff(c.env.DB, c.get("session")));
app.post("/api/staff", requireStaff, async (c) =>
  saveStaff(c.env.DB, c.get("session"), await readJson(c.req.raw)),
);
app.patch("/api/staff/:id", requireStaff, async (c) =>
  saveStaff(c.env.DB, c.get("session"), await readJson(c.req.raw), c.req.param("id")),
);
for (const path of [
  "/api/payments",
  "/api/payments/:id/refund",
  "/api/loyalty",
  "/api/loyalty/:customer",
  "/api/subscription",
  "/api/subscription/renew",
  "/api/staff",
  "/api/staff/:id",
])
  app.all(path, requireStaff, methodNotAllowed);

// SaaS console
app.on(["GET", "PATCH"], "/api/saas/overview", async (c) => {
  if (!(await requireSaasAdmin(c.env, c.req.raw)))
    return forbidden("دسترسی مدیر SaaS برای این حساب فعال نیست.");
  return c.req.method === "GET"
    ? reply(await readSaasOverview(c.env.DB))
    : updateSaasAccount(c.env.DB, await readJson(c.req.raw));
});
app.all("/api/saas/overview", async (c) =>
  (await requireSaasAdmin(c.env, c.req.raw))
    ? methodNotAllowed()
    : forbidden("دسترسی مدیر SaaS برای این حساب فعال نیست."),
);

// Café setup and branches
const readCafe = async (c) =>
  reply(await readSetup(c.env.DB, cafeQuery(c), await sessionStaff(c.env.DB, c.req.raw)));
app.get("/api/setup", readCafe);
app.post("/api/setup", async (c) => {
  if (!(await withinLimit(c, "setupPerIp", "setup"))) return rateLimitedReply();
  return writeSetup(c.env.DB, await readBody(c.req.raw, schemas.setup));
});
app.patch("/api/setup", requireOwner("فقط مالک کافه به این بخش دسترسی دارد."), async (c) =>
  writeSetup(c.env.DB, await readJson(c.req.raw), c.get("session")),
);
app.all("/api/setup", methodNotAllowed);
const ownsBranches = requireOwner("فقط مالک کافه می‌تواند شعب را مدیریت کند.");
app.get("/api/branches", readCafe);
app.post("/api/branches", ownsBranches, async (c) =>
  createBranch(c.env.DB, await readJson(c.req.raw), c.get("session")),
);
app.patch("/api/branches/:slug", ownsBranches, async (c) =>
  updateBranch(c.env.DB, c.req.param("slug"), await readJson(c.req.raw), c.get("session")),
);
app.all("/api/branches", ownsBranches, methodNotAllowed);
app.all("/api/branches/:slug", ownsBranches, methodNotAllowed);

// Branch-scoped routes
const BRANCH = "/api/cafes/:cafe/branches/:branch";
app.use(`${BRANCH}/*`, async (c, next) => {
  if (!safeSlug(c.req.param("cafe")) || !safeSlug(c.req.param("branch")))
    return reply({ error: "invalid_slug" }, 400);
  await next();
});

const smsAccess = requireBranch("messages.read", "به پیامک‌های این شعبه دسترسی ندارید.");
/** @param {string} message */
const smsWrite = (message) =>
  /** @type {import("hono").MiddlewareHandler<AppEnv>} */ (
    async (c, next) =>
      hasPermission(c.get("session"), "messages.write") ? next() : forbidden(message)
  );
app.get(`${BRANCH}/notifications`, smsAccess, async (c) =>
  reply(await readNotifications(c.env, c.req.param("cafe"), c.req.param("branch"))),
);
app.put(
  `${BRANCH}/notifications`,
  smsAccess,
  smsWrite("اجازه تغییر تنظیمات پیامک را ندارید."),
  async (c) =>
    writeNotificationSettings(
      c.env,
      c.req.param("cafe"),
      c.req.param("branch"),
      await readJson(c.req.raw),
    ),
);
app.post(
  `${BRANCH}/notifications/process`,
  smsAccess,
  smsWrite("اجازه اجرای یادآوری‌ها را ندارید."),
  async (c) => {
    const result = await processDueReminders(c.env, c.get("branch").id);
    return reply({
      ...result,
      notifications: await readNotifications(c.env, c.req.param("cafe"), c.req.param("branch")),
    });
  },
);
app.all(`${BRANCH}/notifications`, smsAccess, methodNotAllowed);
app.all(`${BRANCH}/notifications/process`, smsAccess, methodNotAllowed);

const opsAccess = requireBranch("dashboard.view", "به عملیات این شعبه دسترسی ندارید.", {
  missingBranch: true,
});
/** @param {string} permission @param {string} message */
const opsWrite = (permission, message) =>
  /** @type {import("hono").MiddlewareHandler<AppEnv>} */ (
    async (c, next) => (hasPermission(c.get("session"), permission) ? next() : forbidden(message))
  );
app.get(`${BRANCH}/operations`, opsAccess, async (c) => {
  const now = tehranNow(),
    date = c.req.query("date") || now.date,
    time = c.req.query("time") || now.time;
  if (!validDate(date) || !validTime(time)) return reply({ error: "invalid_datetime" }, 400);
  return reply(
    await readOperations(
      c.env.DB,
      c.get("branch"),
      date,
      c.get("session"),
      time,
      await branchSettings(c),
    ),
  );
});
app.post(
  `${BRANCH}/operations/reservations`,
  opsAccess,
  opsWrite("reservations.write", "اجازه ثبت رزرو ندارید."),
  async (c) =>
    createReservation(
      c.env,
      c.get("branch"),
      await readJson(c.req.raw),
      await branchSettings(c),
      true,
    ),
);
app.patch(
  `${BRANCH}/operations/reservations/:id`,
  opsAccess,
  opsWrite("reservations.write", "اجازه ویرایش رزرو ندارید."),
  async (c) =>
    updateOperationalReservation(
      c.env.DB,
      c.get("branch"),
      c.req.param("id"),
      await readJson(c.req.raw),
      await branchSettings(c),
    ),
);
const waitlistWrite = opsWrite("waitlist.write", "اجازه مدیریت لیست انتظار ندارید.");
app.post(`${BRANCH}/operations/waitlist`, opsAccess, waitlistWrite, async (c) =>
  createWaitlist(c.env.DB, c.get("branch"), await readJson(c.req.raw)),
);
app.patch(`${BRANCH}/operations/waitlist/:id`, opsAccess, waitlistWrite, async (c) =>
  updateWaitlist(c.env.DB, c.get("branch"), c.req.param("id"), await readJson(c.req.raw)),
);
app.patch(
  `${BRANCH}/operations/tables/:id`,
  opsAccess,
  opsWrite("tables.write", "اجازه تغییر وضعیت میزها را ندارید."),
  async (c) =>
    updateTableStatus(c.env.DB, c.get("branch"), c.req.param("id"), await readJson(c.req.raw)),
);
for (const path of [
  "/operations",
  "/operations/:section{reservations|waitlist|tables}",
  "/operations/:section{reservations|waitlist|tables}/:id",
])
  app.all(BRANCH + path, opsAccess, methodNotAllowed);

const mapWrite = requireBranch("map.write", "به ویرایش نقشه این شعبه دسترسی ندارید.");
app.get(`${BRANCH}/map/analyze`, mapWrite, (c) =>
  reply({ enabled: Boolean(c.env.OPENAI_API_KEY) }),
);
app.post(`${BRANCH}/map/analyze`, mapWrite, (c) => analyzeMapImage(c.req.raw, c.env));
app.all(`${BRANCH}/map/analyze`, methodNotAllowed);

// Map, settings, schedule, availability and reservations of one branch. Writes and the
// reservation list need staff with the matching permission; the rest is public.
/** @param {string} resource */
const branchWrite = (resource) =>
  requireBranch(
    (c) => (c.req.method === "PUT" ? `${resource}.write` : "reservations.read"),
    "به این بخش دسترسی ندارید.",
  );
app.get(`${BRANCH}/map`, async (c) => {
  const map = await readMap(c.env.DB, c.req.param("cafe"), c.req.param("branch"));
  return map ? reply(map) : reply({ error: "map_not_found" }, 404);
});
app.put(`${BRANCH}/map`, branchWrite("map"), async (c) => {
  if (Number(c.req.header("content-length") || 0) > 150000)
    return reply({ error: "payload_too_large" }, 413);
  const result = await writeMap(
    c.env.DB,
    c.req.param("cafe"),
    c.req.param("branch"),
    await readJson(c.req.raw),
  );
  return result instanceof Response ? result : reply(result);
});
app.get(`${BRANCH}/settings`, async (c) =>
  reply({ ...(await branchSettings(c)), paymentMode: paymentMode(c.env) }),
);
app.put(`${BRANCH}/settings`, branchWrite("settings"), async (c) =>
  reply(
    await writeSettings(
      c.env.DB,
      c.req.param("cafe"),
      c.req.param("branch"),
      await readJson(c.req.raw),
    ),
  ),
);
app.get(`${BRANCH}/schedule`, loadBranch, async (c) =>
  reply(await readSchedule(c.env.DB, c.get("branch"))),
);
app.put(`${BRANCH}/schedule`, branchWrite("schedule"), async (c) =>
  reply(await writeSchedule(c.env.DB, c.get("branch"), await readJson(c.req.raw))),
);
app.get(`${BRANCH}/availability`, loadBranch, async (c) => {
  const branch = c.get("branch"),
    settings = await branchSettings(c),
    date = c.req.query("date"),
    partySize = Math.max(
      1,
      Math.min(settings.maxPartySize, Number(c.req.query("party_size")) || 2),
    );
  await expireUnpaidReservations(c.env.DB, branch.id);
  if (!validDate(date)) return reply({ error: "invalid_date" }, 400);
  return reply(await availability(c.env.DB, branch, date, partySize, settings));
});
app.post(`${BRANCH}/reservations`, loadBranch, async (c) => {
  const branch = c.get("branch");
  await expireUnpaidReservations(c.env.DB, branch.id);
  if (!(await withinLimit(c, "reservationsPerIp", `reservation:${branch.cafe_id}`)))
    return rateLimitedReply();
  return createReservation(
    c.env,
    branch,
    await readBody(c.req.raw, schemas.publicReservation),
    await branchSettings(c),
  );
});
app.get(`${BRANCH}/reservations`, branchWrite("reservations"), async (c) => {
  const branch = c.get("branch"),
    date = c.req.query("date");
  await expireUnpaidReservations(c.env.DB, branch.id);
  if (!validDate(date)) return reply({ error: "invalid_date" }, 400);
  const result = await c.env.DB.prepare(
    "SELECT r.tracking_code,r.customer_name,r.mobile,r.party_size,r.reserved_at,r.status,GROUP_CONCAT(t.name,'، ') AS table_names FROM reservations r LEFT JOIN reservation_tables rt ON rt.reservation_id=r.id LEFT JOIN cafe_tables t ON t.id=rt.table_id WHERE r.branch_id=? AND r.reserved_at>=? AND r.reserved_at<? GROUP BY r.id ORDER BY r.reserved_at",
  )
    .bind(branch.id, `${date}T00:00`, `${date}T23:59`)
    .all();
  return reply({ reservations: result.results || [] });
});
app.all(`${BRANCH}/:resource{map|settings|schedule|availability|reservations}`, methodNotAllowed);

// Public tracking: lookup, cancellation and demo payment by tracking code and mobile.
const CODE = "/api/reservations/:code{[A-Z0-9-]+}";
// In Hono `/*` also matches the code path itself, so this one middleware covers every action.
app.use(`${CODE}/*`, async (c, next) =>
  (await withinLimit(c, "trackingPerIp", "tracking")) ? next() : rateLimitedReply(),
);
const reservationNotFound = () =>
  reply({ error: "reservation_not_found", message: "رزروی با این مشخصات پیدا نشد." }, 404);
app.get(CODE, async (c) => {
  const row = await lookupReservation(c.env.DB, c.req.param("code"), c.req.query("mobile"));
  return row ? reply(publicReservation(row)) : reservationNotFound();
});
app.post(`${CODE}/:action{cancel|pay|card-transfer}`, async (c) => {
  const code = c.req.param("code"),
    action = c.req.param("action"),
    body = await readBody(
      c.req.raw,
      action === "card-transfer" ? schemas.cardTransfer : schemas.trackingAction,
    ),
    row = await lookupReservation(c.env.DB, code, body.mobile);
  if (!row) return reservationNotFound();
  if (action === "pay") return payReservation(c.env, row, new URL(c.req.url).origin);
  if (action === "card-transfer") return submitCardTransfer(c.env, row, body);
  return cancelReservation(c.env.DB, row, code, body.mobile);
});
app.all(CODE, methodNotAllowed);
app.all(`${CODE}/:action{cancel|pay|card-transfer}`, methodNotAllowed);

app.notFound(() => reply({ error: "not_found" }, 404));
app.onError((error) => {
  if (error instanceof InvalidJsonError)
    return reply({ error: "invalid_json", message: "اطلاعات ارسالی معتبر نیست." }, 400);
  if (error instanceof InvalidBodyError)
    return reply(
      { error: "invalid_request", message: "اطلاعات ارسالی معتبر نیست.", fields: error.fields },
      400,
    );
  console.error("api_error", error);
  return reply({ error: "internal_error", message: "خطای داخلی رخ داد؛ دوباره تلاش کنید." }, 500);
});

export default {
  /** @param {Request} request @param {Env} env @param {ExecutionContext} ctx */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "GET" && url.pathname.startsWith("/api/cafes/")) {
        ctx.waitUntil(processDueReminders(env));
        ctx.waitUntil(cleanupRateLimitsOccasionally(env.DB));
      }
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
        cleanupRateLimits(env.DB),
      ]),
    );
  },
};
