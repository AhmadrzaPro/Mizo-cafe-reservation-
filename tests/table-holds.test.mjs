// Table holds: a table kept for the customer filling in the booking form, enforced by the server
// and the database, used up by their own booking and given back when they leave.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";
import { fixture } from "./helpers/worker.mjs";

const DATE = "2090-03-04",
  TIME = "12:00",
  ME = { "CF-Connecting-IP": "203.0.113.10" },
  OTHER = { "CF-Connecting-IP": "203.0.113.20" };

async function setup(env) {
  const f = await fixture(env),
    cafe = await f.setupCafe();
  const hold = (headers = ME, table = cafe.table, time = TIME) =>
    f.call(`${cafe.base}/holds`, {
      method: "POST",
      headers,
      body: { date: DATE, time, partySize: 2, tableId: table },
    });
  const book = (headers, holdToken, mobile = "09121110000") =>
    f.call(`${cafe.base}/reservations`, {
      method: "POST",
      headers,
      body: {
        customerName: "مهمان",
        mobile,
        partySize: 2,
        date: DATE,
        time: TIME,
        tableIds: [cafe.table],
        holdToken,
      },
    });
  const free = async (time = TIME) =>
    (await f.call(`${cafe.base}/availability?date=${DATE}&party_size=2`)).data.slots
      .find((slot) => slot.time === time)
      .tableIds.includes(cafe.table);
  return { f, cafe, hold, book, free };
}

test("a held table is not free to anyone else, and only one customer can hold it", async () => {
  const { hold, free } = await setup();
  assert.equal(await free(), true);
  const mine = await hold();
  assert.equal(mine.status, 201);
  assert.match(mine.data.token, /^[0-9a-f]{64}$/);
  assert.equal(await free(), false, "availability leaves the held table out");
  assert.equal(await free("16:00"), true, "a later, non-overlapping time is unaffected");
  const theirs = await hold(OTHER);
  assert.equal(theirs.status, 409);
  assert.equal(theirs.data.error, "table_unavailable");
});

test("two customers asking at the same moment cannot both hold the table", async () => {
  const { hold } = await setup();
  const results = await Promise.all([
    hold(ME),
    hold(OTHER),
    hold({ "CF-Connecting-IP": "203.0.113.30" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
});

test("the holder books with their token; anyone else is refused by the database", async () => {
  const { f, hold, book } = await setup();
  const { token } = (await hold()).data;
  const other = await book(OTHER, undefined, "09129990000");
  assert.equal(other.status, 409, "someone without the hold cannot take the table");
  assert.equal(other.data.error, "slot_taken");
  const mine = await book(ME, token);
  assert.equal(mine.status, 201);
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM table_holds").get().n, 0, "used up");
});

test("leaving the form releases the hold; a wrong token releases nothing", async () => {
  const { f, cafe, hold, free } = await setup();
  const { holdId, token } = (await hold()).data,
    release = (body) =>
      f.call(`${cafe.base}/holds/${holdId}`, { method: "DELETE", headers: ME, body });
  assert.equal((await release({ token: "0".repeat(64) })).status, 404);
  assert.equal(await free(), false);
  assert.equal((await release({ token })).status, 200);
  assert.equal(await free(), true);
});

test("an expired hold is ignored everywhere and cleaned up in the background", async () => {
  const { f, hold, book, free } = await setup();
  await hold();
  f.DB.raw.prepare("UPDATE table_holds SET expires_at='2000-01-01T00:00:00.000Z'").run();
  assert.equal(await free(), true);
  assert.equal((await book(OTHER, undefined, "09129990000")).status, 201);
  const pending = [];
  await worker.scheduled({}, f.env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM table_holds").get().n, 0);
});

test("one client holds at most two tables at once, and holds are rate limited", async () => {
  const { f, cafe, hold } = await setup({ RATE_LIMIT_HOLDS_PER_IP_HOUR: "4" });
  // A second table of the default map's main area.
  const second = `${cafe.branchId}:t3`,
    third = `${cafe.branchId}:t4`;
  assert.equal((await hold(ME, cafe.table)).status, 201);
  assert.equal((await hold(ME, second)).status, 201);
  const capped = await hold(ME, third);
  assert.equal(capped.status, 429);
  assert.equal(capped.data.error, "too_many_holds");
  assert.equal((await hold(ME, third, "18:00")).status, 429);
  const limited = await hold(ME, third, "19:00");
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error, "rate_limited");
  void f;
});

test("holds only take real, reservable tables of the branch, within opening hours", async () => {
  const { f, cafe, hold } = await setup();
  const other = await f.setupCafe("کافه دیگر", "09127778888");
  assert.equal((await hold(ME, other.table)).data.error, "invalid_table");
  assert.equal((await hold(ME, `${cafe.branchId}:missing`)).data.error, "invalid_table");
  assert.equal((await hold(ME, cafe.table, "03:00")).data.error, "outside_hours");
  const bad = await f.call(`${cafe.base}/holds`, {
    method: "POST",
    headers: ME,
    body: { date: DATE, time: TIME, partySize: 99, tableId: cafe.table },
  });
  assert.equal(bad.data.error, "invalid_party_size");
});

test("the owner can switch the Virtual Cafe off for a branch where the platform offers it", async () => {
  const { f, cafe } = await setup({ VIRTUAL_CAFE: "all" });
  const owner = await f.login(cafe);
  let settings = (await f.call(`${cafe.base}/settings`)).data;
  assert.equal(settings.virtualCafeOffered, true);
  assert.equal(settings.virtualCafeEnabled, true, "on by default where offered");
  const saved = await f.call(`${cafe.base}/settings`, {
    method: "PUT",
    cookie: owner,
    body: { ...settings, virtualCafeEnabled: false },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.virtualCafeEnabled, false);
  assert.equal(
    saved.data.virtualCafeOffered,
    true,
    "the answer to a save carries the computed fields",
  );
  settings = (await f.call(`${cafe.base}/settings`)).data;
  assert.equal(settings.virtualCafeEnabled, false);
});
