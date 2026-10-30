// Serves the built Worker for the browser tests: Node HTTP in front of worker.fetch, an in-memory
// D1 (SQLite) with every migration, demo mode, and a fake ZarinPal. Test-only; never deployed.
import { createServer } from "node:http";
import worker from "../dist/server/index.js";
import { database } from "../tests/helpers/worker.mjs";

const port = Number(process.env.E2E_PORT || 8790),
  DB = database(),
  env = {
    DB,
    DEMO_MODE: "true",
    SAAS_ADMIN_AUTH: "oai-header",
    SUBSCRIPTION_CARD_NUMBER: "6219861930664833",
    PAYMENT_GATEWAY: "zarinpal",
    ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000",
    ZARINPAL_SANDBOX: "true",
    // Every test creates cafés and bookings from the same address.
    RATE_LIMIT_OTP_PER_IP_HOUR: "100000",
    RATE_LIMIT_OTP_VERIFY_PER_IP_HOUR: "100000",
    RATE_LIMIT_SETUP_PER_IP_DAY: "100000",
    RATE_LIMIT_RESERVATIONS_PER_IP_HOUR: "100000",
    RATE_LIMIT_TRACKING_PER_IP_HOUR: "100000",
  };

// ZarinPal answers locally; the browser's trip to the bank is intercepted in the tests.
let authorities = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes("zarinpal.com")) return realFetch(url, init);
  const answer = String(url).endsWith("/request.json")
    ? { data: { code: 100, authority: `A${String(++authorities).padStart(35, "0")}` }, errors: [] }
    : { data: { code: 100, ref_id: 123456789, card_pan: "6037****1234" }, errors: [] };
  return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
};

// Test hooks for states that otherwise take days.
const hooks = {
  "/__e2e/trial-ended": (params) =>
    DB.raw
      .prepare(
        "UPDATE saas_subscriptions SET trial_ends_at=? WHERE cafe_id=(SELECT id FROM cafes WHERE slug=?)",
      )
      .run(
        new Date(Date.now() - Number(params.get("days")) * 86400000).toISOString(),
        params.get("cafe"),
      ),
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (hooks[url.pathname]) {
    hooks[url.pathname](url.searchParams);
    res.end("ok");
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const response = await worker.fetch(
    new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
    }),
    env,
    { waitUntil() {} },
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`e2e server on ${port}`));
