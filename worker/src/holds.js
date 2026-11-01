// Table holds: while a customer fills in the booking form, the chosen table is kept for them for a
// few minutes. A hold is created by one conditional INSERT that checks overlapping holds and
// reservations in the same statement, so two customers can never hold the same table at once. The
// database trigger `reservation_table_held` stops anyone else from booking a held table; the
// holder's own booking removes the hold in the same transaction (see createReservation).
import { bookingTimeError } from "./availability.js";
import { reply } from "./http.js";
import { onlineBookingPaused } from "./subscription.js";
import { dayRules } from "./settings.js";
import { isoInstant, minutes, timeAt, validDate, validTime } from "./util/dates.js";
import { randomId, sha256 } from "./util/ids.js";

/** How long a table stays held for the customer filling in the form. */
export const HOLD_MINUTES = 5;
/** Holds one client may have at once in a branch: enough to change one's mind, not to block. */
const HOLDS_PER_CLIENT = 2;

/**
 * Holds one table for a public booking in progress.
 * @param {import("./types").Env} env
 * @param {import("./types").Branch} branch
 * @param {{ date?: unknown, time?: unknown, partySize?: unknown, tableId?: unknown }} body
 * @param {ReturnType<typeof import("./settings.js").normalizeSettings>} settings
 * @param {string} clientKey Who asks (their IP), to cap holds per client.
 */
export async function createHold(env, branch, body, settings, clientKey) {
  const db = env.DB,
    date = String(body.date || ""),
    time = String(body.time || ""),
    partySize = Number(body.partySize),
    tableId = String(body.tableId || "");
  if (!settings.reservationsEnabled)
    return reply({ error: "reservations_disabled", message: "رزرو آنلاین موقتاً متوقف است." }, 409);
  if (await onlineBookingPaused(db, branch.cafe_id))
    return reply(
      {
        error: "online_booking_paused",
        message: "رزرو آنلاین این کافه موقتاً در دسترس نیست؛ لطفاً با کافه تماس بگیرید.",
      },
      409,
    );
  if (!validDate(date) || !validTime(time))
    return reply({ error: "invalid_datetime", message: "تاریخ یا ساعت معتبر نیست." }, 400);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > settings.maxPartySize)
    return reply({ error: "invalid_party_size", message: "تعداد مهمان‌ها معتبر نیست." }, 400);
  const rules = await dayRules(db, branch, date);
  if (bookingTimeError(date, time, settings.reservationDuration, rules))
    return reply(
      {
        error: "outside_hours",
        message: rules.reason || "زمان گذشته یا خارج از ساعت کاری قابل رزرو نیست.",
      },
      409,
    );
  // The same tables a booking may use: this branch, reservable, in service, in a shown area.
  const table = await db
    .prepare(
      "SELECT t.id,t.capacity FROM cafe_tables t JOIN areas a ON a.id=t.area_id WHERE t.id=? AND a.branch_id=? AND t.reservable=1 AND t.operational_status='available' AND (?='both' OR a.kind=?)",
    )
    .bind(tableId, branch.id, branch.space_mode || "indoor", branch.space_mode || "indoor")
    .first();
  if (!table) return reply({ error: "invalid_table", message: "میز انتخاب‌شده معتبر نیست." }, 400);
  if (Number(table.capacity) < partySize)
    return reply(
      { error: "insufficient_capacity", message: "ظرفیت میز برای تعداد مهمان‌ها کافی نیست." },
      400,
    );

  const now = isoInstant(),
    startsAt = `${date}T${time}`,
    endsAt = timeAt(date, minutes(time) + settings.reservationDuration + settings.bufferMinutes),
    expiresAt = isoInstant(Date.now() + HOLD_MINUTES * 60000),
    id = randomId("hold"),
    token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""),
    // One statement: the hold is written only if no live hold or active reservation overlaps it
    // and the client is under its cap. D1 runs each statement atomically.
    result = await db
      .prepare(
        `INSERT INTO table_holds (id,branch_id,table_id,starts_at,ends_at,token_hash,client_key,expires_at,created_at)
         SELECT ?,?,?,?,?,?,?,?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM table_holds h WHERE h.table_id=? AND h.expires_at>? AND h.starts_at<? AND h.ends_at>?
         ) AND NOT EXISTS (
           SELECT 1 FROM reservation_tables rt JOIN reservations r ON r.id=rt.reservation_id
           WHERE rt.table_id=? AND r.status NOT IN ('cancelled','completed','no_show')
             AND datetime(r.reserved_at)<datetime(?)
             AND datetime(r.reserved_at,'+'||(r.duration_minutes+r.buffer_minutes)||' minutes')>datetime(?)
         ) AND (
           SELECT COUNT(*) FROM table_holds c WHERE c.client_key=? AND c.branch_id=? AND c.expires_at>?
         )<?`,
      )
      .bind(
        id,
        branch.id,
        tableId,
        startsAt,
        endsAt,
        await sha256(token),
        clientKey,
        expiresAt,
        now,
        tableId,
        now,
        endsAt,
        startsAt,
        tableId,
        endsAt,
        startsAt,
        clientKey,
        branch.id,
        now,
        HOLDS_PER_CLIENT,
      )
      .run();
  if (!result.meta?.changes) {
    const own = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM table_holds WHERE client_key=? AND branch_id=? AND expires_at>?",
      )
      .bind(clientKey, branch.id, now)
      .first();
    return Number(own?.count) >= HOLDS_PER_CLIENT
      ? reply(
          {
            error: "too_many_holds",
            message: "چند میز را هم‌زمان نگه داشته‌اید؛ یکی را رها کنید یا چند دقیقه صبر کنید.",
          },
          429,
        )
      : reply(
          {
            error: "table_unavailable",
            message: "این میز همین الان رزرو یا نگه داشته شد؛ لطفاً میز دیگری انتخاب کنید.",
          },
          409,
        );
  }
  return reply({ holdId: id, token, tableId, expiresAt, holdMinutes: HOLD_MINUTES }, 201);
}

/**
 * Releases a hold early, when the customer goes back to choose again. Only the holder, who has the
 * token, can release it.
 * @param {D1Database} db
 * @param {import("./types").Branch} branch
 * @param {string} holdId
 * @param {unknown} token
 */
export async function releaseHold(db, branch, holdId, token) {
  const result = await db
    .prepare("DELETE FROM table_holds WHERE id=? AND branch_id=? AND token_hash=?")
    .bind(holdId, branch.id, await sha256(String(token || "")))
    .run();
  return result.meta?.changes
    ? reply({ released: true })
    : reply({ error: "hold_not_found", message: "این میز دیگر برای شما نگه داشته نشده است." }, 404);
}

/** The statement a booking runs first, in its own transaction, to use up the customer's hold. */
export async function consumeHoldStatement(db, branch, token) {
  return db
    .prepare("DELETE FROM table_holds WHERE branch_id=? AND token_hash=?")
    .bind(branch.id, await sha256(String(token)));
}

/** Background job: expired holds are ignored everywhere already; this only frees the rows. */
export async function cleanupHolds(db, now = Date.now()) {
  await db.prepare("DELETE FROM table_holds WHERE expires_at<=?").bind(isoInstant(now)).run();
}
