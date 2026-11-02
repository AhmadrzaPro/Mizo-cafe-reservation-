// Runs the built Worker against an in-memory SQLite database shaped like D1, with every migration
// applied. Each fixture is independent.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../../dist/server/index.js";

const migrationsDir = new URL("../../drizzle/", import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(new URL(file, migrationsDir), "utf8"));

export function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const sql of migrations) raw.exec(sql);
  class Statement {
    constructor(query, args = []) {
      this.query = query;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.query, args);
    }
    async first() {
      return raw.prepare(this.query).get(...this.args) ?? null;
    }
    async all() {
      return { results: raw.prepare(this.query).all(...this.args) };
    }
    async run() {
      return { meta: { changes: Number(raw.prepare(this.query).run(...this.args).changes) } };
    }
  }
  return {
    raw,
    prepare: (query) => new Statement(query),
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = statements.map((statement) => {
          const prepared = raw.prepare(statement.query);
          return prepared.columns().length
            ? { results: prepared.all(...statement.args) }
            : { meta: { changes: Number(prepared.run(...statement.args).changes) } };
        });
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export const ownerMobile = "09123456789";

export async function fixture(envOverrides = {}) {
  const DB = database(),
    env = { DB, DEMO_MODE: "true", ...envOverrides };
  let requests = 0;
  // Each request gets its own client IP so per-IP limits never interfere with these tests.
  async function call(path, { method = "GET", body, cookie, headers = {} } = {}) {
    const pending = [],
      response = await worker.fetch(
        new Request("https://test.local" + path, {
          method,
          headers: {
            "content-type": "application/json",
            "CF-Connecting-IP": `198.18.${Math.floor(requests / 250) % 250}.${requests++ % 250}`,
            ...(cookie ? { cookie } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
        { waitUntil: (promise) => pending.push(promise) },
      );
    await Promise.all(pending);
    const text = await response.text();
    let data = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Pages and plain-text errors stay as text.
    }
    return { status: response.status, data, headers: response.headers };
  }
  async function setupCafe(name = "کافه آزمایشی", mobile = ownerMobile) {
    const r = await call("/api/setup", {
      method: "POST",
      body: {
        cafeName: name,
        city: "تهران",
        branchName: "مرکزی",
        ownerMobile: mobile,
        ownerName: "مالک",
      },
    });
    if (r.status !== 201) throw new Error(`setup failed: ${JSON.stringify(r.data)}`);
    const slug = r.data.cafe.slug,
      branchId = r.data.branches[0].id;
    return {
      slug,
      branchId,
      base: `/api/cafes/${slug}/branches/main`,
      table: `${branchId}:t1`,
    };
  }
  async function login(cafe, mobile = ownerMobile) {
    const otp = await call("/api/auth/request", {
      method: "POST",
      body: { cafeSlug: cafe.slug, mobile },
    });
    const verified = await worker.fetch(
      new Request("https://test.local/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json", "CF-Connecting-IP": "198.19.0.1" },
        body: JSON.stringify({
          cafeSlug: cafe.slug,
          mobile,
          code: otp.data.demoCode,
          challengeId: otp.data.challengeId,
        }),
      }),
      env,
      { waitUntil() {} },
    );
    if (verified.status !== 200) throw new Error(`login failed for ${mobile}`);
    return verified.headers.get("set-cookie").split(";")[0];
  }
  // Invites a staff member as the owner and returns their session cookie.
  async function staffSession(cafe, owner, role, mobile) {
    const r = await call("/api/staff", {
      method: "POST",
      cookie: owner,
      body: { name: "همکار", mobile, role, branchId: cafe.branchId },
    });
    if (r.status !== 200) throw new Error(`invite failed: ${JSON.stringify(r.data)}`);
    return login(cafe, mobile);
  }
  let day = 0;
  // Books a table on its own future date so bookings never collide.
  function book(cafe, { mobile = "09121110000", partySize = 2, time = "12:00" } = {}) {
    day++;
    return call(`${cafe.base}/reservations`, {
      method: "POST",
      body: {
        customerName: "مهمان",
        mobile,
        partySize,
        date: `2090-${String(1 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`,
        time,
        tableIds: [cafe.table],
      },
    });
  }
  const setStatus = (cafe, cookie, trackingCode, status) =>
    call(`${cafe.base}/operations/reservations/${trackingCode}`, {
      method: "PATCH",
      cookie,
      body: { status },
    });
  return { DB, env, call, setupCafe, login, staffSession, book, setStatus };
}
