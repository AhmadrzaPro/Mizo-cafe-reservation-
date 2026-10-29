// Café modules beyond booking: staff, branches, loyalty, payments, reports, SMS, subscription and
// the SaaS console. Each test checks the main flow and who may and may not use it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/worker.mjs";

test("staff: the owner invites and deactivates staff; others cannot manage the team", async () => {
  const { call, setupCafe, login, staffSession } = await fixture();
  const cafe = await setupCafe(),
    owner = await login(cafe),
    reception = await staffSession(cafe, owner, "reception", "09120000001");
  const list = await call("/api/staff", { cookie: owner });
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.staff.map((s) => s.role).sort(), ["owner", "reception"]);
  const invited = list.data.staff.find((s) => s.role === "reception");
  assert.equal(invited.branchId, cafe.branchId);

  assert.equal((await call("/api/staff", { cookie: reception })).status, 403);
  const escalate = await call("/api/staff", {
    method: "POST",
    cookie: reception,
    body: { name: "نفوذی", mobile: "09120000009", role: "owner" },
  });
  assert.equal(escalate.status, 403);
  assert.equal((await call("/api/staff")).status, 401);

  const self = list.data.staff.find((s) => s.role === "owner");
  const lockout = await call(`/api/staff/${self.id}`, {
    method: "PATCH",
    cookie: owner,
    body: { name: "مالک", mobile: self.mobile, role: "owner", active: false },
  });
  assert.equal(lockout.data.error, "self_lockout");
  const duplicate = await call("/api/staff", {
    method: "POST",
    cookie: owner,
    body: { name: "تکراری", mobile: "09120000001", role: "barista", branchId: cafe.branchId },
  });
  assert.equal(duplicate.data.error, "duplicate_mobile");
  const missingBranch = await call("/api/staff", {
    method: "POST",
    cookie: owner,
    body: { name: "بی‌شعبه", mobile: "09120000002", role: "reception" },
  });
  assert.equal(missingBranch.data.error, "invalid_staff");

  const deactivated = await call(`/api/staff/${invited.id}`, {
    method: "PATCH",
    cookie: owner,
    body: { ...invited, branchId: cafe.branchId, active: false },
  });
  assert.equal(deactivated.status, 200);
  assert.equal((await call("/api/auth/session", { cookie: reception })).data.authenticated, false);
});

test("staff: an owner cannot touch another café's team", async () => {
  const { call, setupCafe, login, staffSession } = await fixture();
  const a = await setupCafe("کافه الف"),
    b = await setupCafe("کافه ب", "09123450000"),
    ownerA = await login(a),
    ownerB = await login(b, "09123450000");
  await staffSession(b, ownerB, "reception", "09120000001");
  const staffB = (await call("/api/staff", { cookie: ownerB })).data.staff;
  const target = staffB.find((s) => s.role === "reception");
  const hijack = await call(`/api/staff/${target.id}`, {
    method: "PATCH",
    cookie: ownerA,
    body: { name: "تغییر", mobile: "09120000001", role: "reception", branchId: a.branchId },
  });
  assert.equal(hijack.status, 404);
  const crossBranch = await call("/api/staff", {
    method: "POST",
    cookie: ownerA,
    body: { name: "همکار", mobile: "09120000003", role: "reception", branchId: b.branchId },
  });
  assert.equal(crossBranch.data.error, "invalid_branch");
});

test("branches: the owner adds and deactivates branches but keeps one active", async () => {
  const { call, setupCafe, login, staffSession } = await fixture();
  const cafe = await setupCafe(),
    owner = await login(cafe);
  const created = await call("/api/branches", {
    method: "POST",
    cookie: owner,
    body: { name: "شعبه دوم", city: "تهران" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.branches.length, 2);
  const second = created.data.branches.find((b) => b.name === "شعبه دوم");
  const published = await call(`/api/cafes/${cafe.slug}/branches/${second.slug}/map`);
  assert.equal(published.status, 200);

  const off = await call(`/api/branches/${second.slug}`, {
    method: "PATCH",
    cookie: owner,
    body: { active: false },
  });
  assert.equal(off.status, 200);
  const publicView = await call(`/api/setup?cafe=${cafe.slug}`);
  assert.deepEqual(
    publicView.data.branches.map((b) => b.slug),
    ["main"],
  );
  assert.equal(
    (await call(`/api/cafes/${cafe.slug}/branches/${second.slug}/schedule`)).status,
    404,
  );

  const last = await call("/api/branches/main", {
    method: "PATCH",
    cookie: owner,
    body: { active: false },
  });
  assert.equal(last.data.error, "last_active_branch");

  const manager = await staffSession(cafe, owner, "branch_manager", "09120000001");
  const denied = await call("/api/branches", {
    method: "POST",
    cookie: manager,
    body: { name: "شعبه سوم", city: "تهران" },
  });
  assert.equal(denied.status, 403);
});

test("loyalty: a completed visit earns points once; staff adjust within their rights", async () => {
  const { call, setupCafe, login, staffSession, book, setStatus } = await fixture();
  const cafe = await setupCafe(),
    owner = await login(cafe),
    reception = await staffSession(cafe, owner, "reception", "09120000001"),
    barista = await staffSession(cafe, owner, "barista", "09120000002");
  const booked = await book(cafe);
  assert.equal((await setStatus(cafe, owner, booked.data.trackingCode, "completed")).status, 200);

  const list = await call("/api/loyalty", { cookie: owner });
  assert.equal(list.status, 200);
  const [customer] = list.data.customers;
  assert.equal(customer.points, 10);
  assert.equal(customer.completedVisits, 1);
  assert.equal((await call("/api/loyalty?q=0912111", { cookie: owner })).data.customers.length, 1);
  assert.equal((await call("/api/loyalty?q=nobody", { cookie: owner })).data.customers.length, 0);

  const bonus = await call(`/api/loyalty/${customer.id}`, {
    method: "PATCH",
    cookie: owner,
    body: { points: 20 },
  });
  assert.equal(bonus.data.customers[0].points, 30);
  const overdraw = await call(`/api/loyalty/${customer.id}`, {
    method: "PATCH",
    cookie: owner,
    body: { points: -40 },
  });
  assert.equal(overdraw.data.error, "insufficient_points");
  for (const points of [0, 501, 1.5])
    assert.equal(
      (
        await call(`/api/loyalty/${customer.id}`, {
          method: "PATCH",
          cookie: owner,
          body: { points },
        })
      ).data.error,
      "invalid_points",
    );

  assert.equal((await call("/api/loyalty", { cookie: reception })).status, 200);
  const receptionWrite = await call(`/api/loyalty/${customer.id}`, {
    method: "PATCH",
    cookie: reception,
    body: { points: 5 },
  });
  assert.equal(receptionWrite.status, 403);
  assert.equal((await call("/api/loyalty", { cookie: barista })).status, 403);
});

test("payments: a paid deposit is listed and refunded once, only by staff who may write", async () => {
  const { DB, call, setupCafe, login, staffSession, book } = await fixture();
  const cafe = await setupCafe(),
    owner = await login(cafe),
    reception = await staffSession(cafe, owner, "reception", "09120000001");
  DB.raw
    .prepare(
      "UPDATE branch_settings SET deposit_enabled=1,deposit_amount_rials=500000,deposit_mode='fixed' WHERE branch_id=?",
    )
    .run(cafe.branchId);
  const booked = await book(cafe);
  assert.equal(booked.data.payment.required, true);
  const paid = await call(`/api/reservations/${booked.data.trackingCode}/pay`, {
    method: "POST",
    body: { mobile: "09121110000" },
  });
  assert.equal(paid.status, 200);

  const list = await call("/api/payments", { cookie: owner });
  assert.equal(list.status, 200);
  assert.equal(list.data.summary.paid, 500000);
  const [payment] = list.data.transactions;
  assert.equal(payment.mobile.includes("***"), true);

  const asReception = await call("/api/payments", { cookie: reception });
  assert.equal(asReception.data.canWrite, false);
  assert.equal(
    (await call(`/api/payments/${payment.id}/refund`, { method: "POST", cookie: reception }))
      .status,
    403,
  );
  const refunded = await call(`/api/payments/${payment.id}/refund`, {
    method: "POST",
    cookie: owner,
  });
  assert.equal(refunded.data.refunded, true);
  assert.equal(
    (await call(`/api/payments/${payment.id}/refund`, { method: "POST", cookie: owner })).data
      .error,
    "already_refunded",
  );
  assert.equal((await call("/api/payments", { cookie: owner })).data.summary.refunded, 500000);
});

test("payments: without demo mode refunds report that no gateway is configured", async () => {
  const { call, setupCafe, login, env } = await fixture();
  const cafe = await setupCafe(),
    owner = await login(cafe);
  delete env.DEMO_MODE;
  const r = await call("/api/payments/x/refund", { method: "POST", cookie: owner });
  assert.equal(r.status, 503);
  assert.equal(r.data.error, "payment_not_configured");
});

test("reports: totals follow reservation outcomes and stay within the staff member's branch", async () => {
  const { call, setupCafe, login, staffSession, book, setStatus } = await fixture();
  const cafe = await setupCafe(),
    owner = await login(cafe),
    manager = await staffSession(cafe, owner, "branch_manager", "09120000001"),
    barista = await staffSession(cafe, owner, "barista", "09120000002");
  const first = await book(cafe),
    second = await book(cafe, { partySize: 1 }),
    third = await book(cafe, { mobile: "09121112222" });
  assert.deepEqual([first.status, second.status, third.status], [201, 201, 201]);
  assert.equal((await setStatus(cafe, owner, first.data.trackingCode, "completed")).status, 200);
  assert.equal((await setStatus(cafe, owner, second.data.trackingCode, "no_show")).status, 200);

  const report = await call("/api/reports?days=30", { cookie: owner });
  assert.equal(report.status, 200);
  assert.equal(report.data.summary.reservations, 3);
  assert.equal(report.data.summary.guests, 5);
  assert.equal(report.data.summary.noShow, 1);
  assert.equal(report.data.summary.uniqueCustomers, 2);
  assert.equal(report.data.branches[0].completed, 1);
  assert.equal(
    (await call(`/api/reports?branch=nope`, { cookie: owner })).data.error,
    "invalid_branch",
  );

  const scoped = await call("/api/reports?branch=nope", { cookie: manager });
  assert.equal(scoped.status, 200);
  assert.equal(scoped.data.branchId, cafe.branchId);
  assert.equal((await call("/api/reports", { cookie: barista })).status, 403);
});

test("sms: confirmations go out and reminders queue; settings need write access", async () => {
  const { call, setupCafe, login, staffSession, book } = await fixture();
  const cafe = await setupCafe(),
    owner = await login(cafe),
    reception = await staffSession(cafe, owner, "reception", "09120000001"),
    barista = await staffSession(cafe, owner, "barista", "09120000002"),
    path = `${cafe.base}/notifications`;
  const saved = await call(path, {
    method: "PUT",
    cookie: owner,
    body: { confirmationEnabled: true, reminderEnabled: true, reminderMinutes: 120 },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.settings, {
    confirmationEnabled: true,
    reminderEnabled: true,
    reminderMinutes: 120,
  });

  await book(cafe);
  const messages = (await call(path, { cookie: owner })).data;
  assert.equal(messages.mode, "demo");
  const byKind = Object.fromEntries(messages.messages.map((m) => [m.kind, m]));
  assert.equal(byKind.confirmation.status, "demo_sent");
  assert.equal(byKind.reminder.status, "queued");
  assert.match(byKind.reminder.scheduledAt, /T10:00$/);
  assert.match(byKind.confirmation.mobile, /\*\*\*/);

  assert.equal((await call(path, { cookie: reception })).status, 200);
  const receptionWrite = await call(path, {
    method: "PUT",
    cookie: reception,
    body: { confirmationEnabled: false },
  });
  assert.equal(receptionWrite.status, 403);
  assert.equal((await call(`${path}/process`, { method: "POST", cookie: reception })).status, 403);
  assert.equal((await call(path, { cookie: barista })).status, 403);
  assert.equal((await call(path)).status, 403);
});

test("subscription: the owner starts a trial and renews in demo mode; staff cannot", async () => {
  const { call, setupCafe, login, staffSession, env } = await fixture();
  const cafe = await setupCafe(),
    owner = await login(cafe),
    manager = await staffSession(cafe, owner, "branch_manager", "09120000001");
  const initial = await call("/api/subscription", { cookie: owner });
  assert.equal(initial.data.enabled, false);
  assert.equal(initial.data.status, "inactive");
  assert.equal(
    (await call("/api/subscription/renew", { method: "POST", cookie: owner })).data.error,
    "subscription_disabled",
  );

  const trial = await call("/api/subscription", {
    method: "PUT",
    cookie: owner,
    body: { enabled: true },
  });
  assert.equal(trial.data.status, "trial");
  const trialDays = (Date.parse(trial.data.trialEndsAt) - Date.now()) / 86400000;
  assert.ok(trialDays > 13.9 && trialDays <= 14, String(trialDays));

  const renewed = await call("/api/subscription/renew", { method: "POST", cookie: owner });
  assert.equal(renewed.data.status, "active");
  assert.ok(renewed.data.events.some((e) => e.type === "payment_demo"));

  assert.equal(
    (await call("/api/subscription", { method: "PUT", cookie: manager, body: { enabled: false } }))
      .status,
    403,
  );
  delete env.DEMO_MODE;
  assert.equal(
    (await call("/api/subscription/renew", { method: "POST", cookie: owner })).status,
    503,
  );
});

const admin = (id) => ({
  "oai-authenticated-user-id": id,
  "oai-authenticated-user-email": `${id}@example.com`,
});

test("saas console: closed unless the host vouches for the identity headers", async () => {
  const { call, setupCafe } = await fixture();
  await setupCafe();
  const forged = await call("/api/saas/overview", { headers: admin("attacker") });
  assert.equal(forged.status, 403);
  assert.equal((await call("/saas-admin", { headers: admin("attacker") })).status, 403);
  assert.equal(
    (await call("/api/saas/overview", { method: "PATCH", headers: admin("attacker"), body: {} }))
      .status,
    403,
  );
});

test("saas console: the first platform user becomes admin and manages café accounts", async () => {
  const { call, setupCafe } = await fixture({ SAAS_ADMIN_AUTH: "oai-header" });
  await setupCafe();
  assert.equal((await call("/api/saas/overview")).status, 403);
  const overview = await call("/api/saas/overview", { headers: admin("owner-1") });
  assert.equal(overview.status, 200);
  assert.equal(overview.data.cafes.length, 1);
  assert.equal((await call("/api/saas/overview", { headers: admin("someone-else") })).status, 403);
  const page = await call("/saas-admin", { headers: admin("owner-1") });
  assert.equal(page.status, 200);
  assert.match(page.data, /<html/);

  const [cafe] = overview.data.cafes;
  const updated = await call("/api/saas/overview", {
    method: "PATCH",
    headers: admin("owner-1"),
    body: { cafeId: cafe.id, enabled: true, status: "active" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.cafes[0].status, "active");
  const missing = await call("/api/saas/overview", {
    method: "PATCH",
    headers: admin("owner-1"),
    body: { cafeId: "nope" },
  });
  assert.equal(missing.status, 404);
});
