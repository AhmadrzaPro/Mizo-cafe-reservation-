export const safeSlug = (value) => /^[a-z0-9-]{1,64}$/.test(value || "");
export const idPart = (value) =>
  String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 80);
export function trackingCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `RMA-${Array.from(bytes, (b) => chars[b % chars.length]).join("")}`;
}
export function randomId(prefix) {
  return `${prefix}:${crypto.randomUUID()}`;
}
export async function sha256(value) {
  const bytes = new TextEncoder().encode(value),
    digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function secureCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}
