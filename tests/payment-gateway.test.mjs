// ZarinPal deposits end to end against a fake ZarinPal: start, callback, verification and the
// failure paths. No request leaves the process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/worker.mjs";

const merchant = "00000000-0000-0000-0000-000000000000",
  gatewayEnv = {
    PAYMENT_GATEWAY: "zarinpal",
    ZARINPAL_MERCHANT_ID: merchant,
    ZARINPAL_SANDBOX: "true",
  },
  mobile = "09121110000";

// Replaces fetch with a fake ZarinPal. `verify` decides each verification's answer.
function fakeZarinpal(
  t,
  {
    request = () => ({
      data: { code: 100, authority: `A${"0".repeat(30)}${++authorities}` },
      errors: [],
    }),
    verify = () => ({ data: { code: 100, ref_id: 987654321, card_pan: "6037**1234" }, errors: [] }),
  } = {},
) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body),
      kind = String(url).endsWith("/request.json") ? "request" : "verify";
    calls.push({ url: String(url), kind, body });
    const answer = await (kind === "request" ? request(body) : verify(body));
    return new Response(JSON.stringify(answer), {
      headers: { "content-type": "application/json" },
    });
  });
  return calls;
}
let authorities = 0;

async function depositBooking(env = {}) {
  const f = await fixture({ ...gatewayEnv, ...env });
  const cafe = await f.setupCafe();
  f.DB.raw
    .prepare(
      "UPDATE branch_settings SET deposit_enabled=1,deposit_amount_rials=500000,deposit_mode='fixed' WHERE branch_id=?",
    )
    .run(cafe.branchId);
  const booked = await f.book(cafe);
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  const reservation = () =>
    f.DB.raw
      .prepare("SELECT * FROM reservations WHERE tracking_code=?")
      .get(booked.data.trackingCode);
  const pay = () =>
    f.call(`/api/reservations/${booked.data.trackingCode}/pay`, {
      method: "POST",
      body: { mobile },
    });
  const callback = (authority, status = "OK") =>
    f.call(`/api/payments/zarinpal/callback?Authority=${authority}&Status=${status}`);
  return { ...f, cafe, booked, reservation, pay, callback };
}
const authorityOf = (redirectUrl) => redirectUrl.split("/").pop();

test("with ZarinPal configured, deposit bookings open without demo mode", async (t) => {
  fakeZarinpal(t);
  const f = await depositBooking({ DEMO_MODE: undefined });
  assert.equal(f.booked.data.payment.required, true);
  assert.equal((await f.call(`${f.cafe.base}/settings`)).data.paymentMode, "zarinpal");
});

test("paying starts a ZarinPal payment for the stored deposit and keeps the table held", async (t) => {
  const calls = fakeZarinpal(t);
  const f = await depositBooking();
  const before = f.reservation().payment_due_at;
  const started = await f.pay();
  assert.equal(started.status, 200);
  assert.match(
    started.data.redirectUrl,
    /^https:\/\/sandbox\.zarinpal\.com\/pg\/StartPay\/A0+\d+$/,
  );
  assert.deepEqual(
    { ...calls[0].body, description: undefined },
    {
      merchant_id: merchant,
      amount: 500000,
      currency: "IRR",
      callback_url: "https://test.local/api/payments/zarinpal/callback",
      description: undefined,
      metadata: { mobile },
    },
  );
  assert.match(calls[0].body.description, new RegExp(f.booked.data.trackingCode));
  const attempt = f.DB.raw.prepare("SELECT * FROM payment_attempts").get();
  assert.equal(attempt.status, "pending");
  assert.equal(attempt.amount_rials, 500000);
  assert.ok(f.reservation().payment_due_at >= before);
  assert.ok(Date.parse(f.reservation().payment_due_at) - Date.now() > 9 * 60000);
  assert.equal(f.reservation().payment_status, "pending");
});

test("a verified callback marks the deposit paid once, however often it arrives", async (t) => {
  const calls = fakeZarinpal(t);
  const f = await depositBooking();
  const authority = authorityOf((await f.pay()).data.redirectUrl);
  const results = await Promise.all([f.callback(authority), f.callback(authority)]);
  const locations = results.map((r) => r.headers.get("location"));
  assert.deepEqual(
    results.map((r) => r.status),
    [303, 303],
  );
  assert.ok(
    locations.includes(`/?cafe=${f.cafe.slug}&code=${f.booked.data.trackingCode}&payment=success`),
  );
  const again = await f.callback(authority);
  assert.match(again.headers.get("location"), /payment=success/);
  assert.equal(calls.filter((c) => c.kind === "verify").length, 1);
  assert.deepEqual(calls.find((c) => c.kind === "verify").body, {
    merchant_id: merchant,
    amount: 500000,
    authority,
  });
  const row = f.reservation();
  assert.equal(row.payment_status, "paid");
  assert.equal(row.status, "confirmed");
  const transactions = f.DB.raw.prepare("SELECT * FROM payment_transactions").all();
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].provider, "zarinpal");
  assert.equal(transactions[0].reference, "987654321");
  assert.equal(
    f.DB.raw.prepare("SELECT card_pan FROM payment_attempts").get().card_pan,
    "6037**1234",
  );
});

test("a payment cancelled at the bank is not verified and can be retried", async (t) => {
  const calls = fakeZarinpal(t);
  const f = await depositBooking();
  const authority = authorityOf((await f.pay()).data.redirectUrl);
  const back = await f.callback(authority, "NOK");
  assert.match(back.headers.get("location"), /payment=failed/);
  assert.equal(calls.filter((c) => c.kind === "verify").length, 0);
  assert.equal(f.reservation().payment_status, "pending");
  const retry = authorityOf((await f.pay()).data.redirectUrl);
  assert.notEqual(retry, authority);
  assert.match((await f.callback(retry)).headers.get("location"), /payment=success/);
});

test("a rejected verification leaves the deposit unpaid", async (t) => {
  fakeZarinpal(t, { verify: () => ({ data: [], errors: { code: -51, message: "failed" } }) });
  const f = await depositBooking();
  const authority = authorityOf((await f.pay()).data.redirectUrl);
  assert.match((await f.callback(authority)).headers.get("location"), /payment=failed/);
  assert.equal(f.reservation().payment_status, "pending");
  assert.equal(f.DB.raw.prepare("SELECT error FROM payment_attempts").get().error, "verify_-51");
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM payment_transactions").get().n, 0);
});

test("when verification cannot reach ZarinPal, returning to the callback verifies again", async (t) => {
  let down = true;
  const calls = fakeZarinpal(t, {
    verify: () => {
      if (down) throw new TypeError("network down");
      return { data: { code: 101, ref_id: 55, card_pan: "" }, errors: [] };
    },
  });
  const f = await depositBooking();
  const authority = authorityOf((await f.pay()).data.redirectUrl);
  t.mock.method(console, "error", () => {});
  assert.match((await f.callback(authority)).headers.get("location"), /payment=pending/);
  assert.equal(f.reservation().payment_status, "pending");
  down = false;
  assert.match((await f.callback(authority)).headers.get("location"), /payment=success/);
  assert.equal(calls.filter((c) => c.kind === "verify").length, 2);
  assert.equal(f.reservation().payment_status, "paid");
});

test("a hold that expired while the customer was at the bank is not verified", async (t) => {
  const calls = fakeZarinpal(t);
  const f = await depositBooking();
  const authority = authorityOf((await f.pay()).data.redirectUrl);
  f.DB.raw
    .prepare(
      "UPDATE reservations SET payment_due_at='2000-01-01T00:00:00.000Z' WHERE tracking_code=?",
    )
    .run(f.booked.data.trackingCode);
  assert.match((await f.callback(authority)).headers.get("location"), /payment=failed/);
  assert.equal(calls.filter((c) => c.kind === "verify").length, 0);
  assert.equal(
    f.DB.raw.prepare("SELECT error FROM payment_attempts").get().error,
    "reservation_not_payable",
  );
});

test("money verified after the hold was released is recorded for a manual refund", async (t) => {
  let f;
  fakeZarinpal(t, {
    verify: () => {
      // The expiry job cancels the reservation while verification is in flight.
      f.DB.raw
        .prepare(
          "UPDATE reservations SET status='cancelled',payment_status='failed' WHERE tracking_code=?",
        )
        .run(f.booked.data.trackingCode);
      return { data: { code: 100, ref_id: 777, card_pan: "" }, errors: [] };
    },
  });
  f = await depositBooking();
  const authority = authorityOf((await f.pay()).data.redirectUrl);
  assert.match((await f.callback(authority)).headers.get("location"), /payment=late/);
  const row = f.reservation();
  assert.equal(row.status, "cancelled");
  assert.equal(row.payment_status, "paid");
  assert.equal(f.DB.raw.prepare("SELECT status FROM payment_attempts").get().status, "paid_late");

  const owner = await f.login(f.cafe);
  const list = await f.call("/api/payments", { cookie: owner });
  assert.equal(list.data.mode, "zarinpal");
  const [payment] = list.data.transactions;
  assert.equal(payment.provider, "zarinpal");
  const refund = await f.call(`/api/payments/${payment.id}/refund`, {
    method: "POST",
    cookie: owner,
  });
  assert.equal(refund.data.manual, true);
  const refundRow = f.DB.raw
    .prepare("SELECT provider,reference FROM payment_transactions WHERE type='refund'")
    .get();
  assert.equal(refundRow.provider, "manual");
  assert.match(refundRow.reference, /^REF-MANUAL-/);
  assert.equal(f.reservation().payment_status, "refunded");
});

test("gateway errors and unknown callbacks fail safely", async (t) => {
  fakeZarinpal(t, { request: () => ({ data: [], errors: { code: -9, message: "validation" } }) });
  const f = await depositBooking();
  t.mock.method(console, "error", () => {});
  const started = await f.pay();
  assert.equal(started.status, 502);
  assert.equal(started.data.error, "gateway_unavailable");
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM payment_attempts").get().n, 0);

  for (const path of [
    "/api/payments/zarinpal/callback?Authority=A999&Status=OK",
    "/api/payments/zarinpal/callback",
    "/api/payments/idpay/callback?Authority=A1&Status=OK",
  ]) {
    const r = await f.call(path);
    assert.equal(r.status, 303, path);
    assert.equal(r.headers.get("location"), "/?payment=failed", path);
  }
});
