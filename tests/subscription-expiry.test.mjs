// What happens when a café's trial or paid period ends unpaid: past_due right away, three days of
// grace, then public online booking pauses until the platform owner approves a payment.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";
import { fixture } from "./helpers/worker.mjs";

const DAY = 86400000,
  admin = { "oai-authenticated-user-id": "platform-owner" },
  ago = (days) => new Date(Date.now() - days * DAY).toISOString();

async function trialCafe() {
  const f = await fixture({
    SAAS_ADMIN_AUTH: "oai-header",
    SUBSCRIPTION_CARD_NUMBER: "6219861930664833",
  });
  const cafe = await f.setupCafe(),
    owner = await f.login(cafe);
  await f.call("/api/subscription", { method: "PUT", cookie: owner, body: { enabled: true } });
  const endTrial = (daysAgo) =>
    f.DB.raw.prepare("UPDATE saas_subscriptions SET trial_ends_at=?").run(ago(daysAgo));
  const subscription = async () => (await f.call("/api/subscription", { cookie: owner })).data;
  const paused = async () => (await f.call(`${cafe.base}/settings`)).data.onlineBookingPaused;
  return { ...f, cafe, owner, endTrial, subscription, paused };
}

test("a running trial keeps booking open", async () => {
  const f = await trialCafe();
  const data = await f.subscription();
  assert.equal(data.status, "trial");
  assert.equal(data.bookingPaused, false);
  assert.equal(await f.paused(), false);
});

test("an ended trial is past due at once but keeps booking open for three days", async () => {
  const f = await trialCafe();
  f.endTrial(1);
  const data = await f.subscription();
  assert.equal(data.status, "past_due");
  assert.equal(data.bookingPaused, false);
  assert.equal(Date.parse(data.graceEndsAt) - Date.parse(data.endsAt), 3 * DAY);
  assert.equal(await f.paused(), false);
  assert.equal((await f.book(f.cafe)).status, 201);
});

test("after the grace period public booking pauses; staff bookings and tracking still work", async () => {
  const f = await trialCafe();
  const before = await f.book(f.cafe);
  f.endTrial(4);
  assert.equal((await f.subscription()).bookingPaused, true);
  assert.equal(await f.paused(), true);
  const blocked = await f.book(f.cafe);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, "online_booking_paused");
  assert.match(blocked.data.message, /تماس/);

  const phone = await f.call(`${f.cafe.base}/operations/reservations`, {
    method: "POST",
    cookie: f.owner,
    body: {
      customerName: "تلفنی",
      partySize: 2,
      date: "2090-03-01",
      time: "12:00",
      tableIds: [f.cafe.table],
      source: "phone",
    },
  });
  assert.equal(phone.status, 201);
  const tracked = await f.call(`/api/reservations/${before.data.trackingCode}`, {
    method: "POST",
    body: { mobile: "09121110000" },
  });
  assert.equal(tracked.status, 200);
});

test("approving a payment reopens booking at once with 30 paid days", async () => {
  const f = await trialCafe();
  f.endTrial(10);
  assert.equal(await f.paused(), true);
  await f.call("/api/subscription/card-transfer", {
    method: "POST",
    cookie: f.owner,
    body: { reference: "123456" },
  });
  const [payment] = (await f.call("/api/saas/overview", { headers: admin })).data.pendingPayments;
  await f.call(`/api/saas/payments/${payment.id}/approve`, { method: "POST", headers: admin });
  const data = await f.subscription();
  assert.equal(data.status, "active");
  assert.equal(data.bookingPaused, false);
  const days = (Date.parse(data.currentPeriodEndsAt) - Date.now()) / DAY;
  assert.ok(days > 29.9 && days <= 30, String(days));
  assert.equal(await f.paused(), false);
  assert.equal((await f.book(f.cafe)).status, 201);
});

test("an ended paid period behaves like an ended trial", async () => {
  const f = await trialCafe();
  f.DB.raw
    .prepare("UPDATE saas_subscriptions SET status='active',current_period_ends_at=?")
    .run(ago(5));
  const data = await f.subscription();
  assert.equal(data.status, "past_due");
  assert.equal(data.bookingPaused, true);
});

test("the scheduled job records the expiry once", async () => {
  const f = await trialCafe();
  f.endTrial(1);
  for (let run = 0; run < 2; run++) {
    const pending = [];
    await worker.scheduled({}, f.env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  }
  assert.equal(f.DB.raw.prepare("SELECT status FROM saas_subscriptions").get().status, "past_due");
  const expired = (await f.subscription()).events.filter((e) => e.type === "expired");
  assert.equal(expired.length, 1);
});

test("an owner cannot switch the subscription off, unpaid or not", async () => {
  for (const daysAgo of [1, -5]) {
    const f = await trialCafe();
    f.endTrial(daysAgo);
    const off = await f.call("/api/subscription", {
      method: "PUT",
      cookie: f.owner,
      body: { enabled: false },
    });
    assert.equal(off.status, 409);
    assert.equal(off.data.error, "subscription_required");
    assert.equal((await f.subscription()).enabled, true);
  }
});

test("cafés the SaaS admin made free never pause", async () => {
  // Switched off in the SaaS console, long after the trial ended.
  const free = await trialCafe();
  free.endTrial(30);
  free.DB.raw.prepare("UPDATE saas_subscriptions SET enabled=0").run();
  assert.equal(await free.paused(), false);

  const comped = await trialCafe();
  comped.DB.raw
    .prepare("UPDATE saas_subscriptions SET status='active',current_period_ends_at=NULL")
    .run();
  assert.equal((await comped.subscription()).bookingPaused, false);
});

test("the SaaS console shows past-due and paused cafés", async () => {
  const f = await trialCafe();
  f.endTrial(4);
  const overview = (await f.call("/api/saas/overview", { headers: admin })).data;
  assert.equal(overview.stats.pastDue, 1);
  assert.equal(overview.stats.paused, 1);
  assert.equal(overview.cafes[0].status, "past_due");
  assert.equal(overview.cafes[0].bookingPaused, true);
});
