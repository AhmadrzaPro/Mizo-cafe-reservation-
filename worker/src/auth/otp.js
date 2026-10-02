import { staffSessionPublic } from "./session.js";
import { reply, replyWithHeaders } from "../http.js";
import { isDemo } from "../util/env.js";
import { randomId, safeSlug, secureCode, sha256 } from "../util/ids.js";
import { normalizeDigits, normalizeMobile } from "../util/mobile.js";
export async function sendOtp(env, mobile, code) {
  if (!env.KAVENEGAR_API_KEY || !env.KAVENEGAR_TEMPLATE) throw new Error("sms_not_configured");
  const endpoint = `https://api.kavenegar.com/v1/${encodeURIComponent(env.KAVENEGAR_API_KEY)}/verify/lookup.json?receptor=${encodeURIComponent(mobile)}&token=${encodeURIComponent(code)}&template=${encodeURIComponent(env.KAVENEGAR_TEMPLATE)}`,
    response = await fetch(endpoint, { method: "POST" });
  if (!response.ok) throw new Error("kavenegar_failed");
  return { mode: "kavenegar" };
}
export async function requestOtp(env, body) {
  const mobile = normalizeMobile(body.mobile),
    slug = body.cafeSlug;
  if (!mobile || !safeSlug(slug))
    return reply({ error: "invalid_login", message: "شماره موبایل و کافه را مشخص کنید." }, 400);
  if (!isDemo(env) && (!env.KAVENEGAR_API_KEY || !env.KAVENEGAR_TEMPLATE))
    return reply(
      { error: "sms_not_configured", message: "سرویس ورود پیامکی هنوز تنظیم نشده است." },
      503,
    );
  const staff = await env.DB.prepare(
    "SELECT s.id,s.cafe_id FROM staff_members s JOIN cafes c ON c.id=s.cafe_id WHERE c.slug=? AND s.mobile=? AND s.active=1",
  )
    .bind(slug, mobile)
    .first();
  if (!staff)
    return reply({ error: "not_invited", message: "این شماره در تیم این کافه فعال نیست." }, 403);
  const now = Date.now(),
    recent = await env.DB.prepare(
      "SELECT COUNT(*) AS count,MAX(created_at) AS last FROM otp_challenges WHERE cafe_id=? AND mobile=? AND created_at>?",
    )
      .bind(staff.cafe_id, mobile, now - 3600000)
      .first();
  if (!isDemo(env) && recent.last && now - Number(recent.last) < 60000)
    return reply({ error: "too_soon", message: "برای ارسال دوباره کد یک دقیقه صبر کنید." }, 429);
  if (Number(recent.count) >= 20)
    return reply(
      { error: "rate_limited", message: "تعداد درخواست‌ها زیاد است؛ بعداً تلاش کنید." },
      429,
    );
  const code = secureCode(),
    salt = crypto.randomUUID(),
    challengeId = randomId("otp"),
    codeHash = await sha256(`${salt}:${code}`);
  let delivery;
  try {
    delivery = isDemo(env) ? { mode: "demo" } : await sendOtp(env, mobile, code);
  } catch {
    return reply({ error: "sms_unavailable", message: "ارسال پیامک انجام نشد." }, 503);
  }
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE otp_challenges SET consumed_at=? WHERE cafe_id=? AND mobile=? AND consumed_at IS NULL",
    ).bind(now, staff.cafe_id, mobile),
    env.DB.prepare(
      "INSERT INTO otp_challenges (id,cafe_id,mobile,salt,code_hash,expires_at,attempts,consumed_at,created_at) VALUES (?,?,?,?,?,?,0,NULL,?)",
    ).bind(challengeId, staff.cafe_id, mobile, salt, codeHash, now + 120000, now),
  ]);
  return reply({
    challengeId,
    expiresIn: 120,
    requiresBootstrap: false,
    delivery: delivery.mode,
    ...(isDemo(env) ? { demoCode: code } : {}),
  });
}
export async function verifyOtp(env, body) {
  const mobile = normalizeMobile(body.mobile),
    code = normalizeDigits(body.code).replace(/\D/g, ""),
    now = Date.now();
  const challenge = await env.DB.prepare(
    "SELECT o.* FROM otp_challenges o JOIN cafes c ON c.id=o.cafe_id WHERE o.id=? AND c.slug=?",
  )
    .bind(String(body.challengeId || ""), String(body.cafeSlug || ""))
    .first();
  if (
    !mobile ||
    !challenge ||
    challenge.mobile !== mobile ||
    challenge.consumed_at ||
    Number(challenge.expires_at) <= now
  )
    return reply({ error: "expired_code", message: "کد منقضی یا نامعتبر است." }, 400);
  const attempt = await env.DB.prepare(
    "UPDATE otp_challenges SET attempts=attempts+1 WHERE id=? AND attempts<5 AND consumed_at IS NULL AND expires_at>?",
  )
    .bind(challenge.id, now)
    .run();
  if (!attempt.meta?.changes) return reply({ error: "too_many_attempts" }, 429);
  if ((await sha256(`${challenge.salt}:${code}`)) !== challenge.code_hash)
    return reply({ error: "wrong_code", message: "کد واردشده صحیح نیست." }, 400);
  const staff = await env.DB.prepare(
    "SELECT s.*,c.slug AS cafe_slug FROM staff_members s JOIN cafes c ON c.id=s.cafe_id WHERE s.cafe_id=? AND s.mobile=? AND s.active=1",
  )
    .bind(challenge.cafe_id, mobile)
    .first();
  if (!staff) return reply({ error: "not_invited" }, 403);
  // Conditional consumption prevents two concurrent verifications from reusing one code.
  const consumed = await env.DB.prepare(
    "UPDATE otp_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?",
  )
    .bind(now, challenge.id, now)
    .run();
  if (!consumed.meta?.changes) return reply({ error: "expired_code" }, 400);
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`,
    tokenHash = await sha256(token);
  await env.DB.prepare(
    "INSERT INTO staff_sessions (id,staff_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(randomId("session"), staff.id, tokenHash, now + 604800000, now, now)
    .run();
  return replyWithHeaders({ authenticated: true, staff: staffSessionPublic(staff) }, 200, {
    "set-cookie": `mizo_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
  });
}
