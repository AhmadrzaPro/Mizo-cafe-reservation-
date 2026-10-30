// Café API requests run background work for hosts without a cron, throttled per isolate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/worker.mjs";

test("requests send due reminders at most once a minute", async (t) => {
  // Far from any earlier run in this process, so the first request is due to run.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2089-06-01T08:00:00Z") });
  const f = await fixture();
  const cafe = await f.setupCafe();
  const due = () => {
    f.DB.raw
      .prepare(
        "UPDATE sms_messages SET scheduled_at='2000-01-01T00:00' WHERE kind='reminder' AND status='queued'",
      )
      .run();
  };
  const reminders = () =>
    f.DB.raw
      .prepare("SELECT status FROM sms_messages WHERE kind='reminder' ORDER BY created_at")
      .all()
      .map((r) => r.status);

  await f.book(cafe);
  due();
  await f.call(`${cafe.base}/settings`);
  assert.deepEqual(reminders(), ["demo_sent"]);

  await f.book(cafe, { mobile: "09121112222" });
  due();
  t.mock.timers.tick(30000);
  await f.call(`${cafe.base}/settings`);
  assert.deepEqual(
    reminders(),
    ["demo_sent", "queued"],
    "a second request within the minute waits",
  );

  t.mock.timers.tick(30000);
  await f.call(`${cafe.base}/settings`);
  assert.deepEqual(reminders(), ["demo_sent", "demo_sent"]);
});

test("requests clean up expired rate-limit windows at most every ten minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2089-07-01T08:00:00Z") });
  const f = await fixture();
  const cafe = await f.setupCafe();
  const stale = () =>
    f.DB.raw
      .prepare("INSERT INTO rate_limits (key,window_start,count) VALUES (?,0,1)")
      .run(`old:${Math.random()}`);
  const count = () =>
    f.DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE window_start=0").get().n;
  stale();
  await f.call(`${cafe.base}/settings`);
  assert.equal(count(), 0);
  stale();
  t.mock.timers.tick(5 * 60000);
  await f.call(`${cafe.base}/settings`);
  assert.equal(count(), 1);
  t.mock.timers.tick(5 * 60000);
  await f.call(`${cafe.base}/settings`);
  assert.equal(count(), 0);
});

test("a failing background job does not fail the request", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2089-08-01T08:00:00Z") });
  const f = await fixture();
  const cafe = await f.setupCafe();
  t.mock.method(console, "error", () => {});
  f.DB.raw.exec("DROP TABLE rate_limits");
  const r = await f.call(`${cafe.base}/settings`);
  assert.equal(r.status, 200);
});
