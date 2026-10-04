import { reply } from "./http.js";

const HOUR = 3600000,
  DAY = 24 * HOUR,
  // Iran has no daylight saving time since 2022, so daily windows start at a fixed UTC+03:30 midnight.
  TEHRAN_OFFSET = 3.5 * HOUR;

// Each limit is configurable through the named env variable; invalid or missing values use the default.
export const limits = {
  otpPerIp: { env: "RATE_LIMIT_OTP_PER_IP_HOUR", fallback: 10, windowMs: HOUR, offsetMs: 0 },
  setupPerIp: {
    env: "RATE_LIMIT_SETUP_PER_IP_DAY",
    fallback: 5,
    windowMs: DAY,
    offsetMs: TEHRAN_OFFSET,
  },
  reservationsPerIp: {
    env: "RATE_LIMIT_RESERVATIONS_PER_IP_HOUR",
    fallback: 10,
    windowMs: HOUR,
    offsetMs: 0,
  },
  smsPerCafe: {
    env: "SMS_DAILY_CAP_PER_CAFE",
    fallback: 300,
    windowMs: DAY,
    offsetMs: TEHRAN_OFFSET,
  },
};

export function limitValue(env, name, fallback) {
  const value = Number(env?.[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function windowStart(now, windowMs, offsetMs = 0) {
  return Math.floor((now + offsetMs) / windowMs) * windowMs - offsetMs;
}

// Atomically counts one hit and reports whether it fits the limit. A single conditional upsert
// means concurrent requests cannot both take the last slot; a blocked hit is not counted.
export async function consumeLimit(env, policy, subject, now = Date.now()) {
  const max = limitValue(env, policy.env, policy.fallback),
    result = await env.DB.prepare(
      "INSERT INTO rate_limits (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key,window_start) DO UPDATE SET count=rate_limits.count+1 WHERE rate_limits.count<?",
    )
      .bind(subject, windowStart(now, policy.windowMs, policy.offsetMs), max)
      .run();
  return Boolean(result.meta?.changes);
}

export const rateLimitedReply = () =>
  reply({ error: "rate_limited", message: "تعداد درخواست‌ها زیاد است؛ بعداً تلاش کنید." }, 429);

// The longest window is one day, so anything older than two days can never be read again.
export async function cleanupRateLimits(db, now = Date.now()) {
  await db
    .prepare("DELETE FROM rate_limits WHERE window_start<?")
    .bind(now - 2 * DAY)
    .run();
}

// Hosts without a cron trigger never call `scheduled`, so requests also clean up, at most every
// ten minutes per isolate.
let lastCleanup = 0;
export function cleanupRateLimitsOccasionally(db, now = Date.now()) {
  if (now - lastCleanup < 600000) return Promise.resolve();
  lastCleanup = now;
  return cleanupRateLimits(db, now);
}
