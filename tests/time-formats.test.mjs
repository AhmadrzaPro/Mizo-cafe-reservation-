// Instants are stored as ISO-8601 UTC text everywhere; café schedules stay on Tehran's clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fixture } from "./helpers/worker.mjs";
import { formatPersianDate, formatTehranTime } from "../web/src/format.js";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Café wall-clock values, not instants.
const SCHEDULE = new Set(["reserved_at", "start_date", "end_date", "open_time", "close_time"]);

test("every stored instant is ISO-8601 UTC with milliseconds", async () => {
  const f = await fixture();
  const cafe = await f.setupCafe(),
    owner = await f.login(cafe);
  const booked = await f.book(cafe);
  await f.setStatus(cafe, owner, booked.data.reservation.trackingCode, "confirmed");
  await f.call("/api/auth/sessions", { cookie: owner });

  const tables = f.DB.raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name);
  let checked = 0;
  for (const table of tables)
    for (const { name } of f.DB.raw.prepare(`PRAGMA table_info(\`${table}\`)`).all()) {
      if (!/_at$/.test(name) || SCHEDULE.has(name)) continue;
      for (const row of f.DB.raw
        .prepare(`SELECT \`${name}\` AS value FROM \`${table}\` WHERE \`${name}\` IS NOT NULL`)
        .all()) {
        assert.match(String(row.value), ISO, `${table}.${name} = ${row.value}`);
        checked++;
      }
    }
  assert.ok(checked > 20, `only ${checked} instants were checked`);
});

test("a reminder is scheduled at the UTC instant before the Tehran booking time", async () => {
  const f = await fixture();
  const cafe = await f.setupCafe();
  const booked = await f.book(cafe, { time: "12:00" });
  const row = f.DB.raw
    .prepare(
      "SELECT r.reserved_at,m.scheduled_at FROM sms_messages m JOIN reservations r ON r.id=m.reservation_id WHERE m.kind='reminder'",
    )
    .get();
  assert.equal(booked.status, 201);
  const minutesBefore =
    (Date.parse(`${row.reserved_at}:00+03:30`) - Date.parse(row.scheduled_at)) / 60000;
  assert.match(row.scheduled_at, ISO);
  assert.ok(minutesBefore > 0 && minutesBefore <= 24 * 60, `${minutesBefore} minutes before`);
  assert.equal(minutesBefore % 1, 0);
});

test("migration 0018 converts millisecond sessions, codes and Tehran reminder times", () => {
  const dir = new URL("../drizzle/", import.meta.url),
    files = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort(),
    db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const apply = (file) => db.exec(readFileSync(new URL(file, dir), "utf8"));
  files.filter((file) => file < "0018").forEach(apply);

  const at = Date.parse("2026-10-31T20:15:30.250Z");
  db.exec(`INSERT INTO cafes (id,slug,name,created_at) VALUES ('c1','c1','c','2026-01-01T00:00:00.000Z');
    INSERT INTO branches (id,cafe_id,slug,name,updated_at) VALUES ('b1','c1','main','b','2026-01-01T00:00:00.000Z');
    INSERT INTO staff_members (id,cafe_id,branch_id,mobile,name,role,active,created_at,updated_at) VALUES ('s1','c1',NULL,'09120000000','n','owner',1,'x','x');`);
  db.prepare(
    "INSERT INTO staff_sessions (id,staff_id,token_hash,expires_at,created_at,last_seen_at) VALUES ('ss','s1','h',?,?,?)",
  ).run(at + 1000, at, at);
  db.prepare(
    "INSERT INTO otp_challenges (id,cafe_id,mobile,salt,code_hash,expires_at,attempts,consumed_at,created_at) VALUES ('o','c1','0912','s','h',?,0,NULL,?)",
  ).run(at, at);
  db.exec(`INSERT INTO reservations (id,branch_id,tracking_code,customer_name,mobile,party_size,reserved_at,duration_minutes,created_at,updated_at) VALUES ('r1','b1','T1','n','0912',2,'2026-11-01T19:00',90,'x','x');
    INSERT INTO sms_messages (id,branch_id,reservation_id,kind,mobile,customer_name,message,status,scheduled_at,created_at) VALUES ('m1','b1','r1','reminder','0912','n','m','queued','2026-11-01T17:00','2026-10-31T20:00:00.000Z'),
      ('m2','b1','r1','confirmation','0912','n','m','sent','2026-10-31T20:00:00.000Z','2026-10-31T20:00:00.000Z');`);

  apply(files.find((file) => file.startsWith("0018")));

  assert.deepEqual(
    { ...db.prepare("SELECT expires_at,created_at,last_seen_at FROM staff_sessions").get() },
    {
      expires_at: "2026-10-31T20:15:31.250Z",
      created_at: "2026-10-31T20:15:30.250Z",
      last_seen_at: "2026-10-31T20:15:30.250Z",
    },
  );
  assert.deepEqual(
    { ...db.prepare("SELECT expires_at,consumed_at,created_at,cafe_id FROM otp_challenges").get() },
    {
      expires_at: "2026-10-31T20:15:30.250Z",
      consumed_at: null,
      created_at: "2026-10-31T20:15:30.250Z",
      cafe_id: "c1",
    },
  );
  assert.deepEqual(
    db
      .prepare("SELECT scheduled_at FROM sms_messages ORDER BY id")
      .all()
      .map((row) => row.scheduled_at),
    ["2026-11-01T13:30:00.000Z", "2026-10-31T20:00:00.000Z"],
  );
  assert.equal(
    db.prepare("SELECT type FROM pragma_table_info('staff_sessions') WHERE name='expires_at'").get()
      .type,
    "TEXT",
  );
});

test("the panel shows instants on Tehran's clock and café dates as they are", () => {
  // 20:45 UTC on 31 October is 00:15 on 1 November (10 Aban) in Tehran.
  assert.equal(formatTehranTime("2026-10-31T20:45:00.000Z"), "۰۰:۱۵");
  assert.equal(formatPersianDate("2026-10-31T20:45:00.000Z"), "۱۰ آبان ۱۴۰۵");
  assert.equal(formatPersianDate("2026-10-31"), "۹ آبان ۱۴۰۵");
});
