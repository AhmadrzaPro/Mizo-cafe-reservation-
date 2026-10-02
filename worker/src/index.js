import {
  appJs,
  editorCss,
  heroBase64,
  page,
  paymentsCss,
  saasCss,
  saasJs,
  saasPage,
  stylesCss,
} from "./site-content.js";
import { requestOtp, verifyOtp } from "./auth/otp.js";
import { canUseBranch, hasPermission, sessionStaff, staffSessionPublic } from "./auth/session.js";
import { availability } from "./availability.js";
import { branchRow, createBranch, updateBranch } from "./branches.js";
import { reply, replyWithHeaders } from "./http.js";
import { adjustLoyalty, readLoyalty } from "./loyalty.js";
import { analyzeMapImage, readMap, writeMap } from "./map.js";
import { processDueReminders, readNotifications, writeNotificationSettings } from "./notifications.js";
import { createWaitlist, readOperations, updateOperationalReservation, updateWaitlist } from "./operations.js";
import { payReservationDemo, readPayments, refundPayment } from "./payments.js";
import { readReports } from "./reports.js";
import { createReservation, expireUnpaidReservations, lookupReservation, publicReservation } from "./reservations.js";
import { readSaasOverview, requireSaasAdmin, updateSaasAccount } from "./saas-admin.js";
import { readSchedule, readSettings, writeSchedule, writeSettings } from "./settings.js";
import { readSetup, writeSetup } from "./setup.js";
import { listStaff, saveStaff } from "./staff.js";
import { decodeBase64, textTypes } from "./static.js";
import { readSubscription, renewSubscriptionDemo, updateSubscription } from "./subscription.js";
import { tehranNow, validDate, validTime } from "./util/dates.js";
import { isDemo } from "./util/env.js";
import { safeSlug } from "./util/ids.js";
async function handleBranchApi(request, env, url, cafeSlug, branchSlug, resource) {
  if (!safeSlug(cafeSlug) || !safeSlug(branchSlug)) return reply({ error: "invalid_slug" }, 400);
  const branch = await branchRow(env.DB, cafeSlug, branchSlug);
  if (branch && ["availability", "reservations"].includes(resource))
    await expireUnpaidReservations(env.DB, branch.id);
  if (resource === "map") {
    if (request.method === "GET") {
      const map = await readMap(env.DB, cafeSlug, branchSlug);
      return map ? reply(map) : reply({ error: "map_not_found" }, 404);
    }
    if (request.method === "PUT") {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > 150000) return reply({ error: "payload_too_large" }, 413);
      const result = await writeMap(env.DB, cafeSlug, branchSlug, await request.json());
      return result instanceof Response ? result : reply(result);
    }
  }
  if (resource === "settings") {
    if (request.method === "GET") return reply(await readSettings(env.DB, cafeSlug, branchSlug));
    if (request.method === "PUT")
      return reply(await writeSettings(env.DB, cafeSlug, branchSlug, await request.json()));
  }
  if (!branch)
    return reply({ error: "branch_not_found", message: "ابتدا نقشه شعبه را منتشر کنید." }, 404);
  if (resource === "schedule") {
    if (request.method === "GET") return reply(await readSchedule(env.DB, branch));
    if (request.method === "PUT")
      return reply(await writeSchedule(env.DB, branch, await request.json()));
  }
  const settings = await readSettings(env.DB, cafeSlug, branchSlug);
  if (resource === "availability" && request.method === "GET") {
    const date = url.searchParams.get("date"),
      partySize = Math.max(
        1,
        Math.min(settings.maxPartySize, Number(url.searchParams.get("party_size")) || 2),
      );
    if (!validDate(date)) return reply({ error: "invalid_date" }, 400);
    return reply(await availability(env.DB, branch, date, partySize, settings));
  }
  if (resource === "reservations") {
    if (request.method === "POST")
      return createReservation(env, branch, await request.json(), settings);
    if (request.method === "GET") {
      const date = url.searchParams.get("date");
      if (!validDate(date)) return reply({ error: "invalid_date" }, 400);
      const result = await env.DB.prepare(
        "SELECT r.tracking_code,r.customer_name,r.mobile,r.party_size,r.reserved_at,r.status,GROUP_CONCAT(t.name,'، ') AS table_names FROM reservations r LEFT JOIN reservation_tables rt ON rt.reservation_id=r.id LEFT JOIN cafe_tables t ON t.id=rt.table_id WHERE r.branch_id=? AND r.reserved_at>=? AND r.reserved_at<? GROUP BY r.id ORDER BY r.reserved_at",
      )
        .bind(branch.id, `${date}T00:00`, `${date}T23:59`)
        .all();
      return reply({ reservations: result.results || [] });
    }
  }
  return reply({ error: "method_not_allowed" }, 405);
}
async function handleApi(request, env, url) {
  if (!env.DB) return reply({ error: "database_unavailable" }, 503);
  try {
    if (url.pathname === "/api/auth/request" && request.method === "POST")
      return requestOtp(env, await request.json());
    if (url.pathname === "/api/auth/verify" && request.method === "POST")
      return verifyOtp(env, await request.json());
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const session = await sessionStaff(env.DB, request);
      return reply(
        session
          ? { authenticated: true, staff: staffSessionPublic(session) }
          : { authenticated: false },
      );
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const session = await sessionStaff(env.DB, request);
      if (session)
        await env.DB.prepare("DELETE FROM staff_sessions WHERE id=?")
          .bind(session.session_id)
          .run();
      return replyWithHeaders({ authenticated: false }, 200, {
        "set-cookie": "mizo_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
      });
    }
    if (url.pathname === "/api/reports" && request.method === "GET") {
      const session = await sessionStaff(env.DB, request);
      if (!session)
        return reply({ error: "authentication_required", message: "ابتدا وارد پنل شوید." }, 401);
      return readReports(env.DB, session, url);
    }
    const paymentsMatch = url.pathname.match(/^\/api\/payments(?:\/([^/]+)\/refund)?$/);
    if (paymentsMatch) {
      const session = await sessionStaff(env.DB, request);
      if (!session)
        return reply({ error: "authentication_required", message: "ابتدا وارد پنل شوید." }, 401);
      if (request.method === "GET" && !paymentsMatch[1]) return readPayments(env.DB, session, url);
      if (request.method === "POST" && paymentsMatch[1] && !isDemo(env))
        return reply({ error: "payment_not_configured" }, 503);
      if (request.method === "POST" && paymentsMatch[1])
        return refundPayment(env.DB, session, decodeURIComponent(paymentsMatch[1]));
      return reply({ error: "method_not_allowed" }, 405);
    }
    const loyaltyMatch = url.pathname.match(/^\/api\/loyalty(?:\/([^/]+))?$/);
    if (loyaltyMatch) {
      const session = await sessionStaff(env.DB, request);
      if (!session)
        return reply({ error: "authentication_required", message: "ابتدا وارد پنل شوید." }, 401);
      const customerId = loyaltyMatch[1] && decodeURIComponent(loyaltyMatch[1]);
      if (request.method === "GET" && !customerId) return readLoyalty(env.DB, session, url);
      if (request.method === "PATCH" && customerId)
        return adjustLoyalty(env.DB, session, customerId, await request.json());
      return reply({ error: "method_not_allowed" }, 405);
    }
    if (url.pathname === "/api/subscription" || url.pathname === "/api/subscription/renew") {
      const session = await sessionStaff(env.DB, request);
      if (!session)
        return reply({ error: "authentication_required", message: "ابتدا وارد پنل شوید." }, 401);
      if (request.method === "GET" && url.pathname === "/api/subscription")
        return reply(await readSubscription(env.DB, session.cafe_id));
      if (request.method === "PUT" && url.pathname === "/api/subscription")
        return updateSubscription(env.DB, session, await request.json());
      if (request.method === "POST" && url.pathname.endsWith("/renew") && !isDemo(env))
        return reply({ error: "payment_not_configured" }, 503);
      if (request.method === "POST" && url.pathname.endsWith("/renew"))
        return renewSubscriptionDemo(env.DB, session);
      return reply({ error: "method_not_allowed" }, 405);
    }
    if (url.pathname === "/api/saas/overview") {
      const admin = await requireSaasAdmin(env.DB, request);
      if (!admin)
        return reply(
          { error: "forbidden", message: "دسترسی مدیر SaaS برای این حساب فعال نیست." },
          403,
        );
      if (request.method === "GET") return reply(await readSaasOverview(env.DB));
      if (request.method === "PATCH") return updateSaasAccount(env.DB, await request.json());
      return reply({ error: "method_not_allowed" }, 405);
    }
    const staffMatch = url.pathname.match(/^\/api\/staff(?:\/([^/]+))?$/);
    if (staffMatch) {
      const session = await sessionStaff(env.DB, request);
      if (!session)
        return reply({ error: "authentication_required", message: "ابتدا وارد پنل شوید." }, 401);
      const id = staffMatch[1] && decodeURIComponent(staffMatch[1]);
      if (request.method === "GET" && !id) return listStaff(env.DB, session);
      if (request.method === "POST" && !id) return saveStaff(env.DB, session, await request.json());
      if (request.method === "PATCH" && id)
        return saveStaff(env.DB, session, await request.json(), id);
      return reply({ error: "method_not_allowed" }, 405);
    }
    if (url.pathname === "/api/setup") {
      if (request.method === "GET")
        return reply(
          await readSetup(
            env.DB,
            url.searchParams.get("cafe") || env.DEFAULT_CAFE_SLUG,
            await sessionStaff(env.DB, request),
          ),
        );
      if (request.method === "POST") return writeSetup(env.DB, await request.json());
      if (request.method === "PATCH") {
        const session = await sessionStaff(env.DB, request);
        if (!session || session.role !== "owner")
          return reply(
            { error: "forbidden", message: "فقط مالک کافه به این بخش دسترسی دارد." },
            403,
          );
        return writeSetup(env.DB, await request.json(), session);
      }
      return reply({ error: "method_not_allowed" }, 405);
    }
    const branchesMatch = url.pathname.match(/^\/api\/branches(?:\/([^/]+))?$/);
    if (branchesMatch) {
      const slug = branchesMatch[1] && decodeURIComponent(branchesMatch[1]);
      if (request.method === "GET" && !slug)
        return reply(
          await readSetup(
            env.DB,
            url.searchParams.get("cafe") || env.DEFAULT_CAFE_SLUG,
            await sessionStaff(env.DB, request),
          ),
        );
      const session = await sessionStaff(env.DB, request);
      if (!session || session.role !== "owner")
        return reply(
          { error: "forbidden", message: "فقط مالک کافه می‌تواند شعب را مدیریت کند." },
          403,
        );
      if (request.method === "POST" && !slug)
        return createBranch(env.DB, await request.json(), session);
      if (request.method === "PATCH" && slug)
        return updateBranch(env.DB, slug, await request.json(), session);
      return reply({ error: "method_not_allowed" }, 405);
    }
    const notificationsMatch = url.pathname.match(
      /^\/api\/cafes\/([^/]+)\/branches\/([^/]+)\/notifications(?:\/(process))?$/,
    );
    if (notificationsMatch) {
      const [, cafeSlug, branchSlug, action] = notificationsMatch;
      if (!safeSlug(cafeSlug) || !safeSlug(branchSlug))
        return reply({ error: "invalid_slug" }, 400);
      const branch = await branchRow(env.DB, cafeSlug, branchSlug),
        session = await sessionStaff(env.DB, request);
      if (
        !session ||
        !branch ||
        !canUseBranch(session, branch) ||
        !hasPermission(session, "messages.read")
      )
        return reply({ error: "forbidden", message: "به پیامک‌های این شعبه دسترسی ندارید." }, 403);
      if (request.method === "GET" && !action)
        return reply(await readNotifications(env, cafeSlug, branchSlug));
      if (request.method === "PUT" && !action) {
        if (!hasPermission(session, "messages.write"))
          return reply(
            { error: "forbidden", message: "اجازه تغییر تنظیمات پیامک را ندارید." },
            403,
          );
        return writeNotificationSettings(env, cafeSlug, branchSlug, await request.json());
      }
      if (request.method === "POST" && action === "process") {
        if (!hasPermission(session, "messages.write"))
          return reply({ error: "forbidden", message: "اجازه اجرای یادآوری‌ها را ندارید." }, 403);
        const result = await processDueReminders(env, branch.id);
        return reply({
          ...result,
          notifications: await readNotifications(env, cafeSlug, branchSlug),
        });
      }
      return reply({ error: "method_not_allowed" }, 405);
    }
    const opsMatch = url.pathname.match(
      /^\/api\/cafes\/([^/]+)\/branches\/([^/]+)\/operations(?:\/(reservations|waitlist|tables)(?:\/([^/]+))?)?$/,
    );
    if (opsMatch) {
      const [, cafeSlug, branchSlug, section, itemId] = opsMatch;
      if (!safeSlug(cafeSlug) || !safeSlug(branchSlug))
        return reply({ error: "invalid_slug" }, 400);
      const branch = await branchRow(env.DB, cafeSlug, branchSlug);
      if (!branch) return reply({ error: "branch_not_found" }, 404);
      const session = await sessionStaff(env.DB, request);
      if (!session || !canUseBranch(session, branch) || !hasPermission(session, "dashboard.view"))
        return reply({ error: "forbidden", message: "به عملیات این شعبه دسترسی ندارید." }, 403);
      const settings = await readSettings(env.DB, cafeSlug, branchSlug);
      if (!section && request.method === "GET") {
        const date = url.searchParams.get("date") || tehranNow().date,
          time = url.searchParams.get("time") || tehranNow().time;
        if (!validDate(date) || !validTime(time)) return reply({ error: "invalid_datetime" }, 400);
        return reply(await readOperations(env.DB, branch, date, session, time, settings));
      }
      if (section === "reservations" && request.method === "POST" && !itemId) {
        if (!hasPermission(session, "reservations.write"))
          return reply({ error: "forbidden", message: "اجازه ثبت رزرو ندارید." }, 403);
        return createReservation(env, branch, await request.json(), settings, true);
      }
      if (section === "reservations" && request.method === "PATCH" && itemId) {
        if (!hasPermission(session, "reservations.write"))
          return reply({ error: "forbidden", message: "اجازه ویرایش رزرو ندارید." }, 403);
        return updateOperationalReservation(env.DB, branch, itemId, await request.json(), settings);
      }
      if (section === "waitlist" && request.method === "POST" && !itemId) {
        if (!hasPermission(session, "waitlist.write"))
          return reply({ error: "forbidden", message: "اجازه مدیریت لیست انتظار ندارید." }, 403);
        return createWaitlist(env.DB, branch, await request.json());
      }
      if (section === "waitlist" && request.method === "PATCH" && itemId) {
        if (!hasPermission(session, "waitlist.write"))
          return reply({ error: "forbidden", message: "اجازه مدیریت لیست انتظار ندارید." }, 403);
        return updateWaitlist(env.DB, branch, itemId, await request.json());
      }
      if (section === "tables" && request.method === "PATCH" && itemId) {
        if (!hasPermission(session, "tables.write"))
          return reply({ error: "forbidden", message: "اجازه تغییر وضعیت میزها را ندارید." }, 403);
        const body = await request.json(),
          allowed = ["available", "dirty", "inactive"],
          status = body.status;
        if (!allowed.includes(status)) return reply({ error: "invalid_status" }, 400);
        const result = await env.DB.prepare(
          "UPDATE cafe_tables SET operational_status=?,updated_at=? WHERE id=? AND id IN (SELECT t.id FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE a.branch_id=?)",
        )
          .bind(status, new Date().toISOString(), decodeURIComponent(itemId), branch.id)
          .run();
        return result.meta?.changes
          ? reply({ id: decodeURIComponent(itemId), status })
          : reply({ error: "table_not_found" }, 404);
      }
      return reply({ error: "method_not_allowed" }, 405);
    }
    const imageMatch = url.pathname.match(
      /^\/api\/cafes\/([^/]+)\/branches\/([^/]+)\/map\/analyze$/,
    );
    if (imageMatch) {
      const [, cafeSlug, branchSlug] = imageMatch;
      if (!["GET", "POST"].includes(request.method))
        return reply({ error: "method_not_allowed" }, 405);
      if (!safeSlug(cafeSlug) || !safeSlug(branchSlug))
        return reply({ error: "invalid_slug" }, 400);
      const branch = await branchRow(env.DB, cafeSlug, branchSlug),
        session = await sessionStaff(env.DB, request);
      if (
        !branch ||
        !session ||
        !canUseBranch(session, branch) ||
        !hasPermission(session, "map.write")
      )
        return reply(
          { error: "forbidden", message: "به ویرایش نقشه این شعبه دسترسی ندارید." },
          403,
        );
      return request.method === "GET"
        ? reply({ enabled: Boolean(env.OPENAI_API_KEY) })
        : analyzeMapImage(request, env);
    }
    const branchMatch = url.pathname.match(
      /^\/api\/cafes\/([^/]+)\/branches\/([^/]+)\/(map|settings|schedule|availability|reservations)$/,
    );
    if (branchMatch) {
      const [, cafeSlug, branchSlug, resource] = branchMatch;
      if (request.method === "PUT" || (resource === "reservations" && request.method === "GET")) {
        const branch = await branchRow(env.DB, cafeSlug, branchSlug),
          session = await sessionStaff(env.DB, request),
          needed = request.method === "PUT" ? `${resource}.write` : "reservations.read";
        if (
          !session ||
          !branch ||
          !canUseBranch(session, branch) ||
          !hasPermission(session, needed)
        )
          return reply({ error: "forbidden", message: "به این بخش دسترسی ندارید." }, 403);
      }
      return handleBranchApi(request, env, url, cafeSlug, branchSlug, resource);
    }
    const reservationMatch = url.pathname.match(
      /^\/api\/reservations\/([A-Z0-9-]+)(?:\/(cancel|pay))?$/,
    );
    if (reservationMatch) {
      const code = reservationMatch[1],
        action = reservationMatch[2];
      if (request.method === "GET" && !action) {
        const row = await lookupReservation(env.DB, code, url.searchParams.get("mobile"));
        return row
          ? reply(publicReservation(row))
          : reply(
              { error: "reservation_not_found", message: "رزروی با این مشخصات پیدا نشد." },
              404,
            );
      }
      const body = await request.json(),
        row = await lookupReservation(env.DB, code, body.mobile);
      if (!row)
        return reply(
          { error: "reservation_not_found", message: "رزروی با این مشخصات پیدا نشد." },
          404,
        );
      if (action === "pay" && request.method === "POST") return payReservationDemo(env, row);
      if (action === "cancel" && request.method === "POST") {
        if (!["pending", "confirmed"].includes(row.status))
          return reply({ error: "cannot_cancel", message: "این رزرو قابل لغو نیست." }, 409);
        const result = await env.DB.batch([
          env.DB.prepare(
            "UPDATE reservations SET status='cancelled',updated_at=? WHERE id=? AND status IN ('pending','confirmed')",
          ).bind(new Date().toISOString(), row.id),
          env.DB.prepare(
            "DELETE FROM reservation_locks WHERE reservation_id=? AND EXISTS (SELECT 1 FROM reservations WHERE id=? AND status='cancelled')",
          ).bind(row.id, row.id),
          env.DB.prepare(
            "UPDATE sms_messages SET status='cancelled' WHERE reservation_id=? AND status='queued' AND EXISTS (SELECT 1 FROM reservations WHERE id=? AND status='cancelled')",
          ).bind(row.id, row.id),
        ]);
        if (!result[0].meta?.changes) return reply({ error: "cannot_cancel" }, 409);
        return reply(publicReservation(await lookupReservation(env.DB, code, body.mobile)));
      }
      return reply({ error: "method_not_allowed" }, 405);
    }
    return reply({ error: "not_found" }, 404);
  } catch (error) {
    console.error("api_error", error);
    return reply(
      {
        error: "database_temporarily_unavailable",
        message: "ارتباط با پایگاه داده برقرار نشد؛ دوباره تلاش کنید.",
      },
      503,
    );
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "GET" && url.pathname.startsWith("/api/cafes/")) {
        ctx.waitUntil(processDueReminders(env));
      }
      return handleApi(request, env, url);
    }
    if (url.pathname === "/saas-admin") {
      if (!env.DB || !(await requireSaasAdmin(env.DB, request)))
        return new Response("دسترسی به این بخش مجاز نیست.", {
          status: 403,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      return new Response(saasPage, {
        headers: {
          "content-type": textTypes["/saas-admin"],
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (url.pathname === "/assets/cafe-hero.png")
      return new Response(decodeBase64(heroBase64), {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" },
      });
    const content =
      url.pathname === "/" || url.pathname === "/index.html"
        ? page
        : url.pathname === "/styles.css"
          ? stylesCss
          : url.pathname === "/editor.css"
            ? editorCss
            : url.pathname === "/app.js"
              ? appJs
              : url.pathname === "/saas-admin.css"
                ? saasCss
                : url.pathname === "/saas-admin.js"
                  ? saasJs
                  : null;
    if (content === null) return new Response("Not found", { status: 404 });
    return new Response(content, {
      headers: {
        "content-type": textTypes[url.pathname] || textTypes["/"],
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
      },
    });
  },
  async scheduled(controller, env, ctx) {
    void controller;
    ctx.waitUntil(Promise.all([processDueReminders(env), expireUnpaidReservations(env.DB)]));
  },
};
