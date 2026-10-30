// Cafés paying their subscription to the platform card to card, approved in the SaaS console.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/worker.mjs";

const card = "6219861930664833",
  admin = { "oai-authenticated-user-id": "platform-owner" },
  DAY = 86400000;

async function subscribedCafe(env = {}) {
  const f = await fixture({
    SUBSCRIPTION_CARD_NUMBER: "۶۲۱۹ ۸۶۱۹ ۳۰۶۶ ۴۸۳۳",
    SUBSCRIPTION_CARD_HOLDER: "میزو",
    SAAS_ADMIN_AUTH: "oai-header",
    ...env,
  });
  const cafe = await f.setupCafe(),
    owner = await f.login(cafe);
  await f.call("/api/subscription", { method: "PUT", cookie: owner, body: { enabled: true } });
  const transfer = (body, cookie = owner) =>
    f.call("/api/subscription/card-transfer", { method: "POST", cookie, body });
  const overview = () => f.call("/api/saas/overview", { headers: admin });
  const review = (id, decision, headers = admin) =>
    f.call(`/api/saas/payments/${id}/${decision}`, { method: "POST", headers });
  return { ...f, cafe, owner, transfer, overview, review };
}

test("the owner sees the platform card and the monthly fee", async () => {
  const f = await subscribedCafe();
  const data = (await f.call("/api/subscription", { cookie: f.owner })).data;
  assert.deepEqual(data.payment.card, { cardNumber: card, cardHolder: "میزو" });
  assert.equal(data.payment.pending, null);
  assert.equal(data.payment.demo, true);
  assert.equal(data.monthlyPriceRials, 4900000);
});

test("without a valid platform card, card-to-card subscription payment is off", async () => {
  for (const number of [undefined, "6219861930664834"]) {
    const f = await subscribedCafe({ SUBSCRIPTION_CARD_NUMBER: number });
    assert.equal((await f.call("/api/subscription", { cookie: f.owner })).data.payment.card, null);
    const r = await f.transfer({ reference: "123456" });
    assert.equal(r.status, 503);
    assert.equal(r.data.error, "card_transfer_not_configured");
  }
});

test("a submitted transfer waits for the platform owner; approval activates 30 paid days", async () => {
  const f = await subscribedCafe();
  const submitted = await f.transfer({ reference: "۹۸۷۶۵۴۳۲۱", cardLast4: "6037" });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.payment.pending.reference, "987654321");
  assert.equal(submitted.data.payment.pending.amountRials, 4900000);
  assert.equal(submitted.data.status, "trial");
  assert.ok(submitted.data.events.some((e) => e.type === "payment_submitted"));
  assert.equal((await f.transfer({ reference: "111111" })).data.error, "payment_pending");

  const [pending] = (await f.overview()).data.pendingPayments;
  assert.equal(pending.cardLast4, "6037");
  assert.equal(pending.duplicateReference, false);
  const approved = await f.review(pending.id, "approve");
  assert.equal(approved.status, 200);
  assert.equal(approved.data.pendingPayments.length, 0);
  assert.equal((await f.review(pending.id, "reject")).data.error, "already_reviewed");

  const data = (await f.call("/api/subscription", { cookie: f.owner })).data;
  assert.equal(data.status, "active");
  assert.equal(data.payment.pending, null);
  const days = (Date.parse(data.currentPeriodEndsAt) - Date.now()) / DAY;
  assert.ok(days > 29.9 && days <= 30, String(days));
  assert.ok(data.events.some((e) => e.type === "payment_card" && e.amountRials === 4900000));
});

test("paying before the period ends adds 30 days to its end", async () => {
  const f = await subscribedCafe();
  const end = new Date(Date.now() + 10 * DAY).toISOString();
  f.DB.raw
    .prepare("UPDATE saas_subscriptions SET status='active',current_period_ends_at=?")
    .run(end);
  await f.transfer({ reference: "222222" });
  const [pending] = (await f.overview()).data.pendingPayments;
  await f.review(pending.id, "approve");
  const data = (await f.call("/api/subscription", { cookie: f.owner })).data;
  assert.equal(Date.parse(data.currentPeriodEndsAt) - Date.parse(end), 30 * DAY);
});

test("a rejected transfer leaves the subscription unchanged and can be submitted again", async () => {
  const f = await subscribedCafe();
  await f.transfer({ reference: "333333" });
  const [pending] = (await f.overview()).data.pendingPayments;
  await f.review(pending.id, "reject");
  const data = (await f.call("/api/subscription", { cookie: f.owner })).data;
  assert.equal(data.status, "trial");
  assert.equal(data.payment.pending, null);
  assert.ok(data.events.some((e) => e.type === "payment_rejected"));
  assert.equal((await f.transfer({ reference: "444444" })).status, 200);
});

test("transfers are validated, owner-only, and flagged when a reference repeats", async () => {
  const f = await subscribedCafe();
  const manager = await f.staffSession(f.cafe, f.owner, "branch_manager", "09120000001");
  assert.equal((await f.transfer({ reference: "555555" }, manager)).status, 403);
  assert.equal((await f.transfer({ reference: "12" })).data.error, "invalid_reference");
  assert.equal(
    (await f.transfer({ reference: "555555", cardLast4: "12" })).data.error,
    "invalid_card_last4",
  );
  assert.equal((await f.transfer({ reference: "555555" })).status, 200);

  const other = await f.setupCafe("کافه دوم", "09123450000"),
    otherOwner = await f.login(other, "09123450000");
  await f.call("/api/subscription", { method: "PUT", cookie: otherOwner, body: { enabled: true } });
  assert.equal((await f.transfer({ reference: "555555" }, otherOwner)).status, 200);
  const payments = (await f.overview()).data.pendingPayments;
  assert.deepEqual(
    payments.map((p) => p.duplicateReference),
    [true, true],
  );

  const off = await subscribedCafe();
  await off.call("/api/subscription", {
    method: "PUT",
    cookie: off.owner,
    body: { enabled: false },
  });
  assert.equal((await off.transfer({ reference: "666666" })).data.error, "subscription_disabled");
});

test("only the SaaS admin reviews payments", async () => {
  const f = await subscribedCafe();
  await f.transfer({ reference: "777777" });
  const [pending] = (await f.overview()).data.pendingPayments;
  assert.equal((await f.review(pending.id, "approve", {})).status, 403);
  assert.equal(
    (await f.review(pending.id, "approve", { "oai-authenticated-user-id": "someone-else" })).status,
    403,
  );
  assert.equal(
    (await f.call(`/api/saas/payments/${pending.id}/approve`, { method: "POST", cookie: f.owner }))
      .status,
    403,
  );
  const closed = await subscribedCafe({ SAAS_ADMIN_AUTH: undefined });
  await closed.transfer({ reference: "888888" });
  const id = closed.DB.raw.prepare("SELECT id FROM subscription_payments").get().id;
  assert.equal((await closed.review(id, "approve")).status, 403);
  assert.equal((await f.review("subpay:missing", "approve")).status, 404);
});
