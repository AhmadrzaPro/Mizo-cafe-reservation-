// Migration 0017 makes the subscription required for cafés that existed before it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../drizzle/", import.meta.url),
  files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort(),
  run = (db, file) => db.exec(readFileSync(new URL(file, dir), "utf8"));

test("0017 starts a 14-day trial for cafés without a subscription or with it off, and keeps the rest", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of files.filter((f) => f < "0017")) run(db, file);
  const cafe = (id) =>
    db
      .prepare("INSERT INTO cafes (id,slug,name,created_at) VALUES (?,?,?,'2026-01-01')")
      .run(id, id.slice(5), id);
  const sub = (id, enabled, status, trialEnds, periodEnds) =>
    db
      .prepare(
        "INSERT INTO saas_subscriptions (cafe_id,enabled,plan,status,monthly_price_rials,trial_ends_at,current_period_ends_at,created_at,updated_at) VALUES (?,?,'standard',?,0,?,?,'2026-01-01','2026-01-01')",
      )
      .run(id, enabled, status, trialEnds, periodEnds);
  for (const id of ["cafe:none", "cafe:off", "cafe:paid", "cafe:trial"]) cafe(id);
  sub("cafe:off", 0, "inactive", null, null);
  sub("cafe:paid", 1, "active", null, "2099-01-01T00:00:00.000Z");
  sub("cafe:trial", 1, "trial", "2099-02-01T00:00:00.000Z", null);

  run(
    db,
    files.find((f) => f.startsWith("0017")),
  );
  const rows = Object.fromEntries(
    db
      .prepare("SELECT * FROM saas_subscriptions")
      .all()
      .map((r) => [r.cafe_id, r]),
  );
  const days = (iso) => (Date.parse(iso) - Date.now()) / 86400000;
  for (const id of ["cafe:none", "cafe:off"]) {
    assert.equal(rows[id].enabled, 1, id);
    assert.equal(rows[id].status, "trial", id);
    assert.ok(days(rows[id].trial_ends_at) > 13.9 && days(rows[id].trial_ends_at) <= 14, id);
  }
  assert.equal(rows["cafe:paid"].current_period_ends_at, "2099-01-01T00:00:00.000Z");
  assert.equal(rows["cafe:paid"].status, "active");
  assert.equal(rows["cafe:trial"].trial_ends_at, "2099-02-01T00:00:00.000Z");
  const events = db.prepare("SELECT cafe_id FROM subscription_events ORDER BY cafe_id").all();
  assert.deepEqual(
    events.map((e) => e.cafe_id),
    ["cafe:none", "cafe:off"],
  );
});
