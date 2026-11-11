// Readable booking links: /<café link>/<branch link>. A link name is the owner's choice; without
// one the link uses the internal slug (cafe-…, main, branch-…), which always keeps working.
import { reply } from "./http.js";
import { readSetup } from "./setup.js";

/** First path segments that belong to the app itself, never to a café. */
const RESERVED = new Set([
  "api",
  "admin",
  "saas-admin",
  "assets",
  "fonts",
  "static",
  "index",
  "new",
  "www",
  "mizo",
]);
const LINK = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** A café link may not look like an internal café slug, so the two never collide. */
const internalCafe = (value) => /^(?:cafe|multi)-/.test(value);
/** Nor may a branch link look like an internal branch slug. */
const internalBranch = (value) => value === "main" || value.startsWith("branch-");

/**
 * Reads a link name from a request body: lowercase, trimmed. `""` clears the link.
 * Returns null when the value is not allowed.
 * @param {unknown} value
 * @param {"cafe" | "branch"} kind
 */
export function linkName(value, kind) {
  const link = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!link) return "";
  if (!LINK.test(link) || link.includes("--")) return null;
  if (kind === "cafe" && (RESERVED.has(link) || internalCafe(link))) return null;
  if (kind === "branch" && internalBranch(link)) return null;
  return link;
}

const invalidLink = () =>
  reply(
    {
      error: "invalid_link",
      message:
        "نام لینک باید ۳ تا ۴۰ حرف انگلیسی کوچک، عدد یا خط تیره باشد و با خط تیره شروع یا تمام نشود.",
    },
    400,
  );
const linkTaken = () =>
  reply({ error: "link_taken", message: "این نام لینک قبلاً انتخاب شده است." }, 409);

/** Whether a path's first segment can be a café (an internal slug or a link name). */
const cafePathSegment = (value) => /^[a-z0-9-]{1,64}$/.test(value) && !RESERVED.has(value);

/**
 * A booking link, /<café> or /<café>/<branch> (a trailing slash allowed): its parts, else null.
 * @param {string} pathname
 */
export function bookingLink(pathname) {
  const match = /^\/([a-z0-9-]{1,64})(?:\/([a-z0-9-]{1,64}))?\/?$/.exec(pathname);
  if (!match || !cafePathSegment(match[1])) return null;
  return { cafe: match[1], branch: match[2] || "" };
}

/**
 * Sets or clears the owner's café link name.
 * @param {D1Database} db @param {Record<string, unknown>} body @param {import("./types").Staff} session
 */
export async function updateCafeLink(db, body, session) {
  const link = linkName(body.link, "cafe");
  if (link === null) return invalidLink();
  if (link) {
    const taken = await db
      .prepare("SELECT id FROM cafes WHERE (link_slug=? OR slug=?) AND id<>? LIMIT 1")
      .bind(link, link, session.cafe_id)
      .first();
    if (taken) return linkTaken();
  }
  try {
    await db
      .prepare("UPDATE cafes SET link_slug=? WHERE id=?")
      .bind(link || null, session.cafe_id)
      .run();
  } catch (error) {
    // Two owners choosing the same name at once: the unique index decides.
    if (/UNIQUE/i.test(String(error))) return linkTaken();
    throw error;
  }
  return reply(await readSetup(db, null, session));
}

/**
 * Checks a branch link name for a café: null when free (or cleared), else the refusal to send.
 * @param {D1Database} db @param {string} cafeId @param {string} link @param {string | null} branchId
 */
export async function branchLinkProblem(db, cafeId, link, branchId) {
  const taken = await db
    .prepare("SELECT id FROM branches WHERE cafe_id=? AND link_slug=? AND id<>? LIMIT 1")
    .bind(cafeId, link, branchId || "")
    .first();
  return taken ? linkTaken() : null;
}
export { invalidLink };
