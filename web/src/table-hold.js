// Holding the chosen table while the customer fills in the booking form. The server keeps it for
// a few minutes (worker/src/holds.js), so nobody else can take it meanwhile; the booking then
// uses the hold up. Going back releases it.
import { cafeBaseUrl } from "./api.js";
import { byId } from "./dom.js";
import { faDigits } from "./format.js";
import { state } from "./state.js";

/** @type {ReturnType<typeof setInterval> | null} */
let countdown = null;

/**
 * Holds `tableId` for the date, time and party size being booked.
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
export async function holdTable(tableId) {
  await releaseHold();
  try {
    const response = await fetch(`${cafeBaseUrl()}/holds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: state.date,
          time: state.time,
          partySize: state.guests,
          tableId,
        }),
      }),
      data = await response.json();
    if (!response.ok)
      return {
        ok: false,
        status: response.status,
        message: data.message || "نگه‌داشتن میز ممکن نشد؛ دوباره تلاش کنید.",
      };
    state.hold = { id: data.holdId, token: data.token, tableId, expiresAt: data.expiresAt };
    return { ok: true };
  } catch {
    return { ok: false, status: 0, message: "اتصال برقرار نشد؛ دوباره تلاش کنید." };
  }
}

/** Gives the held table back, when the customer leaves the form without booking. */
export async function releaseHold() {
  const hold = state.hold;
  state.hold = null;
  stopCountdown();
  if (!hold) return;
  try {
    await fetch(`${cafeBaseUrl()}/holds/${encodeURIComponent(hold.id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: hold.token }),
      keepalive: true,
    });
  } catch {
    // The hold expires on its own within minutes.
  }
}

/** The booking used the hold up; nothing to release. */
export function forgetHold() {
  state.hold = null;
  stopCountdown();
}

/** Shows, on the booking form, how long the table stays held. */
export function startCountdown() {
  stopCountdown();
  const line = byId("holdCountdown"),
    tick = () => {
      const left = state.hold ? Date.parse(state.hold.expiresAt) - Date.now() : 0;
      line.hidden = !state.hold;
      if (!state.hold) return;
      if (left <= 0) {
        line.dataset.expired = "true";
        line.textContent =
          "مهلت نگه‌داشتن میز تمام شد؛ اگر میز هنوز آزاد باشد، رزرو همچنان ثبت می‌شود.";
        stopCountdown();
        return;
      }
      const seconds = Math.ceil(left / 1000);
      line.dataset.expired = "false";
      line.textContent = `این میز تا ${faDigits(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`)} دیگر برای شما نگه داشته شده است.`;
    };
  tick();
  countdown = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdown) clearInterval(countdown);
  countdown = null;
}
