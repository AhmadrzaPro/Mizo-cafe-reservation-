import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
const root = resolve(import.meta.dirname, "..");
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
] = await Promise.all([
  readFile(resolve(root, "web/index.html"), "utf8"),
  readFile(resolve(root, "web/styles.css"), "utf8"),
  readFile(resolve(root, "web/editor.css"), "utf8"),
  readFile(resolve(root, "web/payments.css"), "utf8"),
  readFile(resolve(root, "web/map-spaces.css"), "utf8"),
  bundleApp(),
  readFile(resolve(root, "web/saas-admin.html"), "utf8"),
  readFile(resolve(root, "web/saas-admin.css"), "utf8"),
  readFile(resolve(root, "web/saas-admin.js"), "utf8"),
  readFile(resolve(root, "web/assets/cafe-hero.webp")),
]);
await mkdir(resolve(root, "dist/server"), { recursive: true });
await writeFile(
  resolve(root, "dist/server/site-content.js"),
  `export const page=${JSON.stringify(page)};\nexport const stylesCss=${JSON.stringify(`${stylesCss}\n${paymentsCss}\n${mapSpacesCss}`)};\nexport const editorCss=${JSON.stringify(editorCss)};\nexport const paymentsCss=${JSON.stringify(paymentsCss)};\nexport const appJs=${JSON.stringify(appJs)};\nexport const saasPage=${JSON.stringify(saasPage)};\nexport const saasCss=${JSON.stringify(saasCss)};\nexport const saasJs=${JSON.stringify(saasJs)};\nexport const heroBase64=${JSON.stringify(hero.toString("base64"))};\n`,
);
