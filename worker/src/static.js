import {
  appJs,
  editorCss,
  heroBase64,
  page,
  saasCss,
  saasJs,
  saasPage,
  stylesCss,
} from "./site-content.js";
import { requireSaasAdmin } from "./saas-admin.js";
export const textTypes = {
  "/": "text/html; charset=utf-8",
  "/index.html": "text/html; charset=utf-8",
  "/styles.css": "text/css; charset=utf-8",
  "/editor.css": "text/css; charset=utf-8",
  "/payments.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/saas-admin": "text/html; charset=utf-8",
  "/saas-admin.css": "text/css; charset=utf-8",
  "/saas-admin.js": "text/javascript; charset=utf-8",
};
export function decodeBase64(value) {
  const binary = atob(value),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export async function serveStatic(request, env, url) {
  if (url.pathname === "/saas-admin") {
    if (!env.DB || !(await requireSaasAdmin(env.DB, request)))
      return new Response("دسترسی به این بخش مجاز نیست.", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    return new Response(saasPage, {
      headers: {
        "content-type": textTypes["/saas-admin"],
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  }
  if (url.pathname === "/assets/cafe-hero.png")
    return new Response(decodeBase64(heroBase64), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" },
    });
  const content =
    url.pathname === "/" || url.pathname === "/index.html"
      ? page
      : url.pathname === "/styles.css"
        ? stylesCss
        : url.pathname === "/editor.css"
          ? editorCss
          : url.pathname === "/app.js"
            ? appJs
            : url.pathname === "/saas-admin.css"
              ? saasCss
              : url.pathname === "/saas-admin.js"
                ? saasJs
                : null;
  if (content === null) return new Response("Not found", { status: 404 });
  return new Response(content, {
    headers: {
      "content-type": textTypes[url.pathname] || textTypes["/"],
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}
