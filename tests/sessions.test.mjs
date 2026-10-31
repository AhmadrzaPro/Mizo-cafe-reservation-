// Staff sessions: last use, signing out everywhere, deactivation and cleanup.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";
import { fixture } from "./helpers/worker.mjs";

const MINUTE = 60000;
const session = (f, cookie) => f.call("/api/auth/session", { cookie });

test("a session's last use is recorded, at most every five minutes", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2089-01-01T08:00:00Z") });
  const f = await fixture();
  const cafe = await f.setupCafe(),
    cookie = await f.login(cafe);
  const lastSeen = () =>
    Date.parse(f.DB.raw.prepare("SELECT last_seen_at FROM staff_sessions").get().last_seen_at);
  const start = lastSeen();
  t.mock.timers.tick(2 * MINUTE);
  await session(f, cookie);
  assert.equal(lastSeen(), start);
  t.mock.timers.tick(4 * MINUTE);
  await session(f, cookie);
  assert.equal(lastSeen(), start + 6 * MINUTE);
});

test("staff see their own devices and can sign out of all of them", async () => {
  const f = await fixture();
  const cafe = await f.setupCafe(),
    phone = await f.login(cafe),
    laptop = await f.login(cafe),
    reception = await f.staffSession(cafe, phone, "reception", "09120000001");
  const list = (await f.call("/api/auth/sessions", { cookie: laptop })).data.sessions;
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((s) => s.current).sort(), [false, true]);
  assert.equal((await f.call("/api/auth/sessions", { cookie: reception })).data.sessions.length, 1);

  const out = await f.call("/api/auth/logout-all", { method: "POST", cookie: laptop });
  assert.equal(out.data.endedSessions, 2);
  assert.equal((await session(f, phone)).data.authenticated, false);
  assert.equal((await session(f, laptop)).data.authenticated, false);
  assert.equal(
    (await session(f, reception)).data.authenticated,
    true,
    "other staff stay signed in",
  );
  assert.equal((await f.call("/api/auth/sessions")).status, 401);
  assert.equal((await f.call("/api/auth/logout-all", { method: "POST" })).status, 401);
});

test("deactivating a staff member deletes their sessions", async () => {
  const f = await fixture();
  const cafe = await f.setupCafe(),
    owner = await f.login(cafe);
  await f.staffSession(cafe, owner, "barista", "09120000002");
  const member = (await f.call("/api/staff", { cookie: owner })).data.staff.find(
    (s) => s.role === "barista",
  );
  const count = () =>
    f.DB.raw.prepare("SELECT COUNT(*) AS n FROM staff_sessions WHERE staff_id=?").get(member.id).n;
  assert.equal(count(), 1);
  await f.call(`/api/staff/${member.id}`, {
    method: "PATCH",
    cookie: owner,
    body: { ...member, branchId: cafe.branchId, active: false },
  });
  assert.equal(count(), 0);
});

test("the scheduled job removes expired sessions and old OTP challenges", async () => {
  const f = await fixture();
  const cafe = await f.setupCafe(),
    live = await f.login(cafe);
  await f.login(cafe);
  f.DB.raw
    .prepare(
      "UPDATE staff_sessions SET expires_at='1970-01-01T00:00:00.001Z' WHERE rowid=(SELECT MAX(rowid) FROM staff_sessions)",
    )
    .run();
  f.DB.raw.prepare("UPDATE otp_challenges SET expires_at='1970-01-01T00:00:00.001Z'").run();
  const pending = [];
  await worker.scheduled({}, f.env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM staff_sessions").get().n, 1);
  assert.equal(f.DB.raw.prepare("SELECT COUNT(*) AS n FROM otp_challenges").get().n, 0);
  assert.equal((await session(f, live)).data.authenticated, true);
});
