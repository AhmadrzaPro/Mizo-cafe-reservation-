import { assets, page, pageHash, saasPage } from "./site-content.js";
import { requireSaasAdmin } from "./saas-admin.js";
// Everything the pages load comes from this origin. Inline style attributes stay allowed because
// rendered markup sets positions and sizes with style="…"; scripts are limited to our own files.
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
const securityHeaders = {
  "content-security-policy": contentSecurityPolicy,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
};
export function decodeBase64(value) {
  const binary = atob(value),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
// Answers 304 when the client already holds this version.
function notModified(request, etag, headers) {
  const match = request.headers.get("if-none-match") || "";
  return match.split(",").some((value) => value.trim().replace(/^W\//, "") === etag)
    ? new Response(null, { status: 304, headers: { ...headers, etag } })
    : null;
}
export async function serveStatic(request, env, url) {
  if (url.pathname === "/saas-admin") {
    if (!(await requireSaasAdmin(env, request)))
      return new Response("دسترسی به این بخش مجاز نیست.", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    return new Response(saasPage, {
      headers: {
        ...securityHeaders,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    // The page itself is revalidated on every load so a deploy is picked up at once.
    const etag = `"${pageHash}"`,
      headers = { ...securityHeaders, "cache-control": "no-cache" };
    return (
      notModified(request, etag, headers) ||
      new Response(page, {
        headers: { ...headers, etag, "content-type": "text/html; charset=utf-8" },
      })
    );
  }
  const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null;
  if (!asset) return new Response("Not found", { status: 404 });
  // A URL carrying the current hash never changes content; any other URL must revalidate.
  const etag = `"${asset.hash}"`,
    headers = {
      "x-content-type-options": "nosniff",
      "cache-control":
        url.searchParams.get("v") === asset.hash
          ? "public, max-age=31536000, immutable"
          : "public, max-age=0, must-revalidate",
    };
  return (
    notModified(request, etag, headers) ||
    new Response(asset.base64 ? decodeBase64(asset.base64) : asset.body, {
      headers: { ...headers, etag, "content-type": asset.type },
    })
  );
}
