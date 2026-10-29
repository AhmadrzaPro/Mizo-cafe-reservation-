import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
// The page loads exactly one classic script: web/src/main.js bundled as an IIFE.
async function bundleApp() {
  const result = await build({
    entryPoints: [resolve(root, "web/src/main.js")],
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "warning",
  });
  return result.outputFiles[0].text;
}
const read = (path, encoding = "utf8") => readFile(resolve(root, path), encoding);
// Vazirmatn variable font (OFL) from the pinned npm package, served from our own origin.
const fontDir = resolve(dirname(require.resolve("vazirmatn/package.json")), "fonts/webfonts");
const [
  page,
  stylesCss,
  editorCss,
  paymentsCss,
  mapSpacesCss,
  appJs,
  saasPage,
  saasCss,
  saasJs,
  hero,
  font,
] = await Promise.all([
  read("web/index.html"),
  read("web/styles.css"),
  read("web/editor.css"),
  read("web/payments.css"),
  read("web/map-spaces.css"),
  bundleApp(),
  read("web/saas-admin.html"),
  read("web/saas-admin.css"),
  read("web/saas-admin.js"),
  read("web/assets/cafe-hero.webp", null),
  readFile(resolve(fontDir, "Vazirmatn[wght].woff2")),
]);
const hash = (body) => createHash("sha256").update(body).digest("hex").slice(0, 12);
// Each asset is served at its path; pages and stylesheets reference it as `path?v=<hash>`,
// so a changed file gets a new URL and an unchanged one can be cached as immutable.
const assets = {};
function addAsset(path, type, body) {
  const binary = Buffer.isBuffer(body);
  assets[path] = {
    type,
    hash: hash(body),
    ...(binary ? { base64: body.toString("base64") } : { body }),
  };
  return `${path}?v=${assets[path].hash}`;
}
const fontUrl = addAsset("/fonts/vazirmatn.woff2", "font/woff2", font);
const withFont = (css) => css.replaceAll("/fonts/vazirmatn.woff2", fontUrl);
const urls = {
  font: fontUrl,
  styles: addAsset(
    "/styles.css",
    "text/css; charset=utf-8",
    withFont(`${stylesCss}\n${paymentsCss}\n${mapSpacesCss}`),
  ),
  editor: addAsset("/editor.css", "text/css; charset=utf-8", editorCss),
  app: addAsset("/app.js", "text/javascript; charset=utf-8", appJs),
  hero: addAsset("/assets/cafe-hero.webp", "image/webp", hero),
  saasCss: addAsset("/saas-admin.css", "text/css; charset=utf-8", withFont(saasCss)),
  saasJs: addAsset("/saas-admin.js", "text/javascript; charset=utf-8", saasJs),
};
function versioned(html, replacements) {
  for (const [from, to] of replacements) {
    if (!html.includes(from)) throw new Error(`asset reference not found: ${from}`);
    html = html.replaceAll(from, to);
  }
  return html;
}
const mainPage = versioned(page, [
  ['href="/fonts/vazirmatn.woff2"', `href="${urls.font}"`],
  ['href="styles.css"', `href="${urls.styles}"`],
  ['href="editor.css"', `href="${urls.editor}"`],
  ['src="assets/cafe-hero.webp"', `src="${urls.hero}"`],
  ['src="app.js"', `src="${urls.app}"`],
]);
const adminPage = versioned(saasPage, [
  ['href="/fonts/vazirmatn.woff2"', `href="${urls.font}"`],
  ['href="/saas-admin.css"', `href="${urls.saasCss}"`],
  ['src="/saas-admin.js"', `src="${urls.saasJs}"`],
]);
await mkdir(resolve(root, "dist/server"), { recursive: true });
await writeFile(
  resolve(root, "dist/server/site-content.js"),
  `export const page=${JSON.stringify(mainPage)};\nexport const pageHash=${JSON.stringify(hash(mainPage))};\nexport const saasPage=${JSON.stringify(adminPage)};\nexport const assets=${JSON.stringify(assets)};\n`,
);
