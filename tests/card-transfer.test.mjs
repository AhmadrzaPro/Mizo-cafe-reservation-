// Card-to-card deposits: the customer transfers to the café's card and submits the bank reference;
// staff approve or reject it. Works without a gateway and without demo mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/worker.mjs";

const card = "6219861930664833",
  mobile = "09121110000";

async function cardCafe({ demo = false } = {}) {
  const f = await fixture(demo ? {} : { DEMO_MODE: undefined });
  // Staff sign-in needs demo OTP codes; the café itself runs without demo mode.
  f.env.DEMO_MODE = "true";
  const cafe = await f.setupCafe(),
    owner = await f.login(cafe);
  if (!demo) delete f.env.DEMO_MODE;
  const settings = (await f.call(`${cafe.base}/settings`)).data;
  const saved = await f.call(`${cafe.base}/settings`, {
    method: "PUT",
    cookie: owner,
    body: {
      ...settings,
      depositEnabled: true,
      depositAmountRials: 500000,
      cardTransferEnabled: true,
      cardNumber: "۶۲۱۹-۸۶۱۹-۳۰۶۶-۴۸۳۳",
      cardHolder: "کافه نمونه",
    },
  });
  assert.equal(saved.status, 200);
  const transfer = (code, body) =>
    f.call(`/api/reservations/${code}/card-transfer`, {
      method: "POST",
      body: { mobile, ...body },
    });
  const reservation = (code) =>
    f.DB.raw.prepare("SELECT * FROM reservations WHERE tracking_code=?").get(code);
  return { ...f, cafe, owner, saved: saved.data, transfer, reservation };
}

test("settings keep only a valid card, normalised to 16 digits", async () => {
  const f = await cardCafe();
  assert.equal(f.saved.cardNumber, card);
  assert.equal(f.saved.cardTransferEnabled, true);
  assert.equal(f.saved.cardHolder, "کافه نمونه");
  const bad = await f.call(`${f.cafe.base}/settings`, {
    method: "PUT",
    cookie: f.owner,
    body: { ...f.saved, cardNumber: "6219861930664834" },
  });
  assert.equal(bad.data.cardNumber, "");
  assert.equal(bad.data.cardTransferEnabled, false);
});

test("without a gateway, a café with card to card accepts deposit bookings and shows its card", async () => {
  const f = await cardCafe();
  const booked = await f.book(f.cafe);
  assert.equal(booked.status, 201);
  assert.deepEqual(booked.data.payment.cardTransfer, {
    cardNumber: card,
    cardHolder: "کافه نمونه",
  });
  const tracked = await f.call(`/api/reservations/${booked.data.trackingCode}?mobile=${mobile}`);
  assert.equal(tracked.data.payment.cardTransfer.cardNumber, card);
  assert.equal((await f.call(`${f.cafe.base}/settings`)).data.paymentMode, "none");
});

test("a submitted transfer holds the table until staff approve it, then confirms the booking", async () => {
  const f = await cardCafe();
  const code = (await f.book(f.cafe)).data.trackingCode;
  const submitted = await f.transfer(code, { reference: "۱۲۳۴۵۶۷۸۹", cardLast4: "6037" });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.payment.status, "review");
  assert.equal(submitted.data.status, "pending");

  // The hold no longer expires while the café checks its account.
  f.DB.raw
    .prepare(
      "UPDATE reservations SET payment_due_at='2000-01-01T00:00:00.000Z' WHERE tracking_code=?",
    )
    .run(code);
  assert.equal((await f.book(f.cafe, { time: "12:00" })).status, 201);
  assert.equal(f.reservation(code).status, "pending");
  assert.equal((await f.transfer(code, { reference: "999999" })).data.error, "payment_in_review");
  assert.equal(
    (await f.call(`/api/reservations/${code}/cancel`, { method: "POST", body: { mobile } })).data
      .error,
    "payment_in_review",
  );
  const confirmEarly = await f.setStatus(f.cafe, f.owner, code, "confirmed");
  assert.equal(confirmEarly.data.error, "payment_in_review");

  const list = (await f.call("/api/payments", { cookie: f.owner })).data;
  assert.equal(list.transfers.length, 1);
  const [pending] = list.transfers;
  assert.equal(pending.reference, "123456789");
  assert.equal(pending.cardLast4, "6037");
  assert.equal(pending.amountRials, 500000);
  assert.equal(pending.duplicateReference, false);
  assert.equal(list.summary.pendingCount, 2);

  const approved = await f.call(`/api/payments/transfers/${pending.id}/approve`, {
    method: "POST",
    cookie: f.owner,
  });
  assert.equal(approved.data.status, "confirmed");
  const row = f.reservation(code);
  assert.equal(row.payment_status, "paid");
  const transaction = f.DB.raw.prepare("SELECT * FROM payment_transactions").get();
  assert.equal(transaction.provider, "card");
  assert.equal(transaction.reference, "123456789");
  assert.equal(
    (
      await f.call(`/api/payments/transfers/${pending.id}/reject`, {
        method: "POST",
        cookie: f.owner,
      })
    ).data.error,
    "already_reviewed",
  );
  assert.equal((await f.call("/api/payments", { cookie: f.owner })).data.transfers.length, 0);

  // Refunding a card payment records a manual refund, even without demo mode.
  const refund = await f.call(`/api/payments/${transaction.id}/refund`, {
    method: "POST",
    cookie: f.owner,
  });
  assert.equal(refund.data.manual, true);
});

test("a rejected transfer cancels the booking and frees the table", async () => {
  const f = await cardCafe();
  const code = (await f.book(f.cafe)).data.trackingCode;
  await f.transfer(code, { reference: "55555" });
  const [pending] = (await f.call("/api/payments", { cookie: f.owner })).data.transfers;
  const rejected = await f.call(`/api/payments/transfers/${pending.id}/reject`, {
    method: "POST",
    cookie: f.owner,
  });
  assert.equal(rejected.data.approved, false);
  const row = f.reservation(code);
  assert.equal(row.status, "cancelled");
  assert.equal(row.payment_status, "failed");
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM reservation_locks").get().n, 0);
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM payment_transactions").get().n, 0);
});

test("transfers are validated, flagged when a reference repeats, and reviewed only by allowed staff", async () => {
  const f = await cardCafe();
  const reception = await (async () => {
    f.env.DEMO_MODE = "true";
    const cookie = await f.staffSession(f.cafe, f.owner, "reception", "09120000001");
    delete f.env.DEMO_MODE;
    return cookie;
  })();
  const first = (await f.book(f.cafe)).data.trackingCode,
    second = (await f.book(f.cafe, { mobile: "09121112222" })).data.trackingCode;
  assert.equal((await f.transfer(first, { reference: "12" })).data.error, "invalid_reference");
  assert.equal(
    (await f.transfer(first, { reference: "123456", cardLast4: "12" })).data.error,
    "invalid_card_last4",
  );
  assert.equal((await f.transfer(first, { reference: "123456" })).status, 200);
  assert.equal(
    (
      await f.call(`/api/reservations/${second}/card-transfer`, {
        method: "POST",
        body: { mobile: "09121112222", reference: "123456" },
      })
    ).status,
    200,
  );
  const list = (await f.call("/api/payments", { cookie: f.owner })).data;
  assert.deepEqual(
    list.transfers.map((t) => t.duplicateReference),
    [true, true],
  );
  const [one] = list.transfers;
  assert.equal(
    (
      await f.call(`/api/payments/transfers/${one.id}/approve`, {
        method: "POST",
        cookie: reception,
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(`/api/payments/transfers/${one.id}/approve`, { method: "POST" })).status,
    401,
  );

  const other = await f.setupCafe("کافه دیگر", "09123450000");
  f.env.DEMO_MODE = "true";
  const otherOwner = await f.login(other, "09123450000");
  delete f.env.DEMO_MODE;
  assert.equal(
    (
      await f.call(`/api/payments/transfers/${one.id}/approve`, {
        method: "POST",
        cookie: otherOwner,
      })
    ).status,
    404,
  );
});

test("a branch without card to card refuses transfers", async () => {
  const f = await cardCafe({ demo: true });
  await f.call(`${f.cafe.base}/settings`, {
    method: "PUT",
    cookie: f.owner,
    body: { ...f.saved, cardTransferEnabled: false },
  });
  const booked = await f.book(f.cafe);
  assert.equal(booked.data.payment.cardTransfer, null);
  assert.equal(
    (await f.transfer(booked.data.trackingCode, { reference: "123456" })).data.error,
    "card_transfer_disabled",
  );
});
