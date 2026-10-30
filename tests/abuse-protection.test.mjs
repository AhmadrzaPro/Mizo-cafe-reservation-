import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../dist/server/index.js";

const HOUR = 3600000,
  DAY = 24 * HOUR,
  owner = "09123456789";
const migrations = readdirSync(new URL("../drizzle/", import.meta.url))
  .filter((x) => x.endsWith(".sql"))
  .sort();
const migrate = (raw, files) => {
  for (const f of files)
    raw.exec(readFileSync(new URL("../drizzle/" + f, import.meta.url), "utf8"));
};

// Same transactional D1-shaped adapter as booking-integrity.test.mjs.
function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  migrate(raw, migrations);
  class Statement {
    constructor(q, args = []) {
      this.q = q;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.q, args);
    }
    async first() {
      return raw.prepare(this.q).get(...this.args) ?? null;
    }
    async all() {
      return { results: raw.prepare(this.q).all(...this.args) };
    }
    async run() {
      return { meta: { changes: Number(raw.prepare(this.q).run(...this.args).changes) } };
    }
  }
  return {
    raw,
    prepare: (q) => new Statement(q),
    async batch(items) {
      raw.exec("BEGIN");
      try {
        const results = items.map((s) => {
          const q = raw.prepare(s.q);
          return q.columns().length
            ? { results: q.all(...s.args) }
            : { meta: { changes: Number(q.run(...s.args).changes) } };
        });
        raw.exec("COMMIT");
        return results;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

async function fixture(overrides = {}) {
  const DB = database(),
    env = { DB, DEMO_MODE: "true", ...overrides },
    pending = [];
  // `ip` sets the default client IP header; pass null to send no IP header at all.
  // `raw` sends a body string as-is, for malformed-JSON cases.
  async function call(path, { method = "GET", body, raw, ip = "198.51.100.1", headers = {} } = {}) {
    const response = await worker.fetch(
      new Request("https://test.local" + path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(ip ? { "CF-Connecting-IP": ip } : {}),
          ...headers,
        },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      }),
      env,
      { waitUntil: (p) => pending.push(p) },
    );
    const data = await response.json();
    await Promise.all(pending.splice(0));
    return { status: response.status, data };
  }
  let setups = 0;
  async function setup(name, ip = "203.0.113.200") {
    const r = await call("/api/setup", {
      method: "POST",
      ip,
      body: {
        cafeName: name,
        city: "تهران",
        branchName: "مرکزی",
        ownerMobile: setups++ ? `0912000000${setups}` : owner,
        ownerName: "مالک",
      },
    });
    assert.equal(r.status, 201);
    const slug = r.data.cafe.slug,
      b = r.data.branches[0].id;
    DB.raw
      .prepare(
        "UPDATE branch_settings SET sms_confirmation_enabled=0,sms_reminder_enabled=0 WHERE branch_id=?",
      )
      .run(b);
    return { slug, b, base: `/api/cafes/${slug}/branches/main`, table: b + ":t1" };
  }
  const a = await setup("کافه الف"),
    b = await setup("کافه دوم");
  // Each booking uses its own date so the same table can be booked repeatedly.
  const booking = (cafe, day, mobile = "09121110000") => ({
    customerName: "مهمان",
    mobile,
    partySize: 2,
    date: `2090-01-${String(day).padStart(2, "0")}`,
    time: "12:00",
    tableIds: [cafe.table],
  });
  const book = (cafe, day, options = {}) =>
    call(cafe.base + "/reservations", {
      method: "POST",
      body: booking(cafe, day, options.mobile),
      ...options,
    });
  const otp = (cafe, options = {}) =>
    call("/api/auth/request", {
      method: "POST",
      body: { cafeSlug: cafe.slug, mobile: owner },
      ...options,
    });
  return { DB, env, call, setup, a, b, book, otp };
}

const isRateLimited = (r) => {
  assert.equal(r.status, 429);
  assert.equal(r.data.error, "rate_limited");
  assert.match(r.data.message, /[؀-ۿ]/);
};

test("the rate-limit migration applies on top of 0013 without touching existing data", () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  const before = migrations.filter((f) => f < "0014");
  assert.ok(migrations.includes("0014_rate_limits.sql"));
  migrate(raw, before);
  raw.exec(
    "INSERT INTO cafes (id,slug,name,created_at) VALUES ('cafe:x','x','کافه','2026-01-01T00:00:00Z')",
  );
  const dump = () =>
    raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .filter((t) => t.name !== "rate_limits")
      .map((t) => [t.name, raw.prepare(`SELECT * FROM "${t.name}"`).all()]);
  const snapshot = JSON.stringify(dump());
  migrate(raw, ["0014_rate_limits.sql"]);
  assert.equal(JSON.stringify(dump()), snapshot);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM rate_limits").get().n, 0);
  assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
});

test("OTP requests are limited per IP and allowed again after the window", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { a, otp } = await fixture();
  for (let i = 0; i < 10; i++) assert.equal((await otp(a)).status, 200);
  isRateLimited(await otp(a));
  assert.equal((await otp(a, { ip: "198.51.100.2" })).status, 200);
  t.mock.timers.tick(HOUR);
  assert.equal((await otp(a)).status, 200);
});

test("cafe setup is limited per IP per day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { setup, call } = await fixture();
  // The fixture already created two cafés from 203.0.113.200.
  for (let i = 0; i < 3; i++) await setup("کافه " + i);
  const sixth = await call("/api/setup", {
    method: "POST",
    ip: "203.0.113.200",
    body: { cafeName: "کافه شش", city: "تهران", branchName: "مرکزی", ownerMobile: "09129999999" },
  });
  isRateLimited(sixth);
  await setup("کافه دیگر", "203.0.113.201");
  t.mock.timers.tick(DAY);
  await setup("کافه فردا");
});

test("public bookings are limited per IP per café and allowed again after the window", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { a, b, book } = await fixture();
  for (let day = 1; day <= 10; day++)
    assert.equal(
      (await book(a, day, { mobile: `0912111${String(day).padStart(4, "0")}` })).status,
      201,
    );
  isRateLimited(await book(a, 11, { mobile: "09122220011" }));
  assert.equal((await book(b, 11, { mobile: "09122220011" })).status, 201);
  assert.equal((await book(a, 12, { mobile: "09122220012", ip: "198.51.100.9" })).status, 201);
  t.mock.timers.tick(HOUR);
  assert.equal((await book(a, 13, { mobile: "09122220013" })).status, 201);
});

test("a mobile can hold at most three active future reservations per branch", async () => {
  const { a, b, book, call, DB } = await fixture();
  for (let day = 1; day <= 3; day++) assert.equal((await book(a, day)).status, 201);
  const rows = () =>
    ["reservations", "reservation_tables", "reservation_locks", "customers", "sms_messages"].map(
      (table) => DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
    );
  const before = rows();
  const fourth = await book(a, 4);
  assert.equal(fourth.status, 429);
  assert.equal(fourth.data.error, "active_reservation_limit");
  assert.match(fourth.data.message, /[؀-ۿ]/);
  // A capped booking writes nothing.
  assert.deepEqual(rows(), before);
  assert.equal((await book(b, 4)).status, 201);
  // Cancelling one frees a slot.
  const first = DB.raw
    .prepare("SELECT tracking_code FROM reservations WHERE reserved_at LIKE '2090-01-01%'")
    .get().tracking_code;
  assert.equal(
    (
      await call(`/api/reservations/${first}/cancel`, {
        method: "POST",
        body: { mobile: "09121110000" },
      })
    ).status,
    200,
  );
  assert.equal((await book(a, 4)).status, 201);
  // Past reservations are not active future ones.
  DB.raw
    .prepare(
      "UPDATE reservations SET reserved_at='2020-01-02T12:00' WHERE reserved_at LIKE '2090-01-02%'",
    )
    .run();
  assert.equal((await book(a, 5)).status, 201);
});

test("concurrent requests at the edge of a limit cannot both pass", async () => {
  const { a, book, otp } = await fixture();
  for (let i = 0; i < 9; i++) assert.equal((await otp(a, { ip: "198.51.100.50" })).status, 200);
  const otps = await Promise.all([
    otp(a, { ip: "198.51.100.50" }),
    otp(a, { ip: "198.51.100.50" }),
  ]);
  assert.deepEqual(otps.map((r) => r.status).sort(), [200, 429]);

  for (let day = 1; day <= 9; day++)
    assert.equal(
      (
        await book(a, day, {
          ip: "198.51.100.60",
          mobile: `0912333${String(day).padStart(4, "0")}`,
        })
      ).status,
      201,
    );
  const ipEdge = await Promise.all([
    book(a, 10, { ip: "198.51.100.60", mobile: "09123330010" }),
    book(a, 11, { ip: "198.51.100.60", mobile: "09123330011" }),
  ]);
  assert.deepEqual(ipEdge.map((r) => r.status).sort(), [201, 429]);

  for (let day = 12; day <= 13; day++)
    assert.equal((await book(a, day, { ip: "198.51.100.70", mobile: "09124440000" })).status, 201);
  const mobileEdge = await Promise.all([
    book(a, 14, { ip: "198.51.100.71", mobile: "09124440000" }),
    book(a, 15, { ip: "198.51.100.72", mobile: "09124440000" }),
  ]);
  assert.deepEqual(mobileEdge.map((r) => r.status).sort(), [201, 429]);
});

test("the daily SMS cap skips messages without failing bookings, per café", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { a, b, book, call, DB } = await fixture({ SMS_DAILY_CAP_PER_CAFE: "2" });
  DB.raw
    .prepare("UPDATE branch_settings SET sms_confirmation_enabled=1,sms_reminder_enabled=1")
    .run();
  const sent = [];
  for (let day = 1; day <= 2; day++) {
    const r = await book(a, day, { mobile: `0912555000${day}` });
    assert.equal(r.status, 201);
    sent.push(r.data.notifications.confirmation);
  }
  assert.deepEqual(sent, ["demo_sent", "demo_sent"]);
  const third = await book(a, 3, { mobile: "09125550003" });
  assert.equal(third.status, 201);
  assert.equal(third.data.status, "confirmed");
  assert.equal(third.data.notifications.confirmation, "skipped");
  const row = DB.raw
    .prepare(
      "SELECT status,error FROM sms_messages WHERE kind='confirmation' AND mobile='09125550003'",
    )
    .get();
  assert.deepEqual({ ...row }, { status: "skipped", error: "daily_cap" });
  // Another café keeps its own budget.
  assert.equal(
    (await book(b, 3, { mobile: "09125550003" })).data.notifications.confirmation,
    "demo_sent",
  );
  // Reminders count against the same cap.
  DB.raw
    .prepare("UPDATE sms_messages SET scheduled_at='2000-01-01T00:00' WHERE kind='reminder'")
    .run();
  await call(a.base + "/availability?date=2090-01-20&party_size=2");
  const reminders = DB.raw
    .prepare(
      "SELECT m.status FROM sms_messages m JOIN branches b ON b.id=m.branch_id WHERE m.kind='reminder' AND b.id=?",
    )
    .all(a.b)
    .map((r) => r.status);
  assert.deepEqual(reminders, ["skipped", "skipped", "skipped"]);
  // The next day has a fresh budget.
  t.mock.timers.tick(DAY);
  assert.equal(
    (await book(a, 4, { mobile: "09125550004" })).data.notifications.confirmation,
    "demo_sent",
  );
});

test("a missing or malformed IP header is limited as one shared client", async () => {
  const { a, otp } = await fixture();
  for (let i = 0; i < 5; i++) assert.equal((await otp(a, { ip: null })).status, 200);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await otp(a, { ip: null, headers: { "CF-Connecting-IP": "not an ip" } })).status,
      200,
    );
  isRateLimited(await otp(a, { ip: null }));
  isRateLimited(await otp(a, { ip: null, headers: { "CF-Connecting-IP": "<script>" } }));
  assert.equal((await otp(a, { ip: "198.51.100.80" })).status, 200);
});

test("the client IP header is configurable and other headers cannot bypass it", async () => {
  const { a, otp } = await fixture({ CLIENT_IP_HEADER: "X-Forwarded-For" });
  for (let i = 0; i < 10; i++)
    assert.equal(
      (await otp(a, { ip: `198.51.100.${i}`, headers: { "X-Forwarded-For": "1.2.3.4, 10.0.0.1" } }))
        .status,
      200,
    );
  // Rotating CF-Connecting-IP or the client-controlled left part of the list does not help.
  isRateLimited(
    await otp(a, { ip: "198.51.100.99", headers: { "X-Forwarded-For": "9.9.9.9, 10.0.0.1" } }),
  );
  assert.equal((await otp(a, { headers: { "X-Forwarded-For": "10.0.0.2" } })).status, 200);
});

test("limits are configurable through env variables", async () => {
  const { a, otp } = await fixture({ RATE_LIMIT_OTP_PER_IP_HOUR: "2" });
  assert.equal((await otp(a)).status, 200);
  assert.equal((await otp(a)).status, 200);
  isRateLimited(await otp(a));
  const fallback = await fixture({ RATE_LIMIT_OTP_PER_IP_HOUR: "abc" });
  for (let i = 0; i < 10; i++) assert.equal((await fallback.otp(fallback.a)).status, 200);
  isRateLimited(await fallback.otp(fallback.a));
});

test("the scheduled handler removes expired rate-limit windows", async () => {
  const { DB, env } = await fixture();
  DB.raw
    .prepare("INSERT INTO rate_limits (key,window_start,count) VALUES ('old',?,1)")
    .run(Date.now() - 3 * DAY);
  const before = DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_limits").get().n;
  const pending = [];
  await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE key='old'").get().n, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM rate_limits").get().n, before - 1);
});

test("OTP verification is limited per IP across challenges", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { a, call } = await fixture();
  const verify = (ip) =>
    call("/api/auth/verify", {
      method: "POST",
      ip,
      body: { cafeSlug: a.slug, mobile: owner, challengeId: "otp:none", code: "000000" },
    });
  for (let i = 0; i < 30; i++) assert.equal((await verify()).status, 400);
  isRateLimited(await verify());
  assert.equal((await verify("198.51.100.2")).status, 400);
  t.mock.timers.tick(HOUR);
  assert.equal((await verify()).status, 400);
});

test("reservation tracking is limited per IP, including misses", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { a, book, call } = await fixture();
  const created = await book(a, 1);
  assert.equal(created.status, 201);
  const path = `/api/reservations/${created.data.trackingCode}`;
  for (let i = 0; i < 29; i++)
    assert.equal(
      (await call("/api/reservations/RMA-NOPE00", { method: "POST", body: { mobile: owner } }))
        .status,
      404,
    );
  assert.equal((await call(path, { method: "POST", body: { mobile: "09121110000" } })).status, 200);
  isRateLimited(await call(path, { method: "POST", body: { mobile: "09121110000" } }));
  isRateLimited(await call(`${path}/cancel`, { method: "POST", body: { mobile: "09121110000" } }));
  assert.equal(
    (await call(path, { method: "POST", body: { mobile: "09121110000" }, ip: "198.51.100.2" }))
      .status,
    200,
  );
  t.mock.timers.tick(HOUR);
  assert.equal((await call(path, { method: "POST", body: { mobile: "09121110000" } })).status, 200);
});

test("malformed or non-object JSON bodies return 400, not a server error", async () => {
  const { a, call } = await fixture();
  for (const raw of ["{not json", "null", "[]", '"text"', ""]) {
    const r = await call(a.base + "/reservations", { method: "POST", raw });
    assert.equal(r.status, 400, raw);
    assert.equal(r.data.error, "invalid_json");
    assert.match(r.data.message, /[؀-ۿ]/);
  }
  assert.equal((await call("/api/auth/verify", { method: "POST", raw: "{" })).status, 400);
});

test("an unexpected failure returns 500 internal_error", async (t) => {
  const { env, call } = await fixture();
  t.mock.method(console, "error", () => {});
  env.DB.prepare = () => {
    throw new Error("boom");
  };
  const r = await call("/api/auth/verify", { method: "POST", body: {} });
  assert.equal(r.status, 500);
  assert.equal(r.data.error, "internal_error");
});

test("public bodies with wrong types or oversized fields return 400 invalid_request", async () => {
  const { a, book, call } = await fixture();
  for (const [path, body, field] of [
    [a.base + "/reservations", { customerName: { x: 1 } }, "customerName"],
    [a.base + "/reservations", { tableIds: "t1" }, "tableIds"],
    [a.base + "/reservations", { tableIds: Array(11).fill("t") }, "tableIds"],
    [a.base + "/reservations", { notes: "x".repeat(1001) }, "notes"],
    ["/api/auth/request", { cafeSlug: a.slug, mobile: ["0912"] }, "mobile"],
    ["/api/auth/verify", { cafeSlug: a.slug, code: true }, "code"],
    ["/api/setup", { cafeName: "x".repeat(201) }, "cafeName"],
    ["/api/reservations/RMA-AAAAAA/cancel", { mobile: { x: 1 } }, "mobile"],
  ]) {
    const r = await call(path, { method: "POST", body, ip: "198.51.100.9" });
    assert.equal(r.status, 400, path);
    assert.equal(r.data.error, "invalid_request", path);
    assert.ok(r.data.fields.includes(field), `${path} ${r.data.fields}`);
    assert.match(r.data.message, /[؀-ۿ]/);
  }
  // Business errors keep their specific codes, and a valid booking still succeeds.
  const missingName = await call(a.base + "/reservations", {
    method: "POST",
    body: { mobile: "09121110000" },
  });
  assert.equal(missingName.data.error, "name_required");
  assert.equal((await book(a, 3)).status, 201);
});

test("an unsupported method on an existing route returns 405", async () => {
  const { a, call } = await fixture();
  for (const [path, method] of [
    [a.base + "/availability?date=2090-01-02", "POST"],
    [a.base + "/map", "DELETE"],
    ["/api/setup", "DELETE"],
    ["/api/reservations/RMA-AAAAAA", "PATCH"],
    ["/api/reservations/RMA-AAAAAA?mobile=09121110000", "GET"],
  ])
    assert.equal(
      (await call(path, { method, body: method === "GET" ? undefined : {} })).status,
      405,
      `${method} ${path}`,
    );
  assert.equal((await call("/api/nope")).status, 404);
});
