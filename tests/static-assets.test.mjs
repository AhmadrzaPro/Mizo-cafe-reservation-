import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";

const get = (path, headers = {}) =>
  worker.fetch(new Request("https://test.local" + path, { headers }), {}, { waitUntil() {} });
const pageRefs = (html) =>
  [
    ...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|png|webp|jpg|svg|woff2)(?:\?v=\w+)?)"/g),
  ].map((m) => "/" + m[1].replace(/^\//, ""));

test("every script, stylesheet, image and font the page references is served", async () => {
  const page = await (await get("/")).text();
  const refs = pageRefs(page);
  assert.ok(refs.some((ref) => ref.startsWith("/assets/cafe-hero.webp?v=")));
  assert.ok(refs.some((ref) => ref.startsWith("/fonts/vazirmatn.woff2?v=")));
  const types = {
    js: "javascript",
    css: "css",
    png: "png",
    webp: "webp",
    jpg: "jpeg",
    svg: "svg",
    woff2: "woff2",
  };
  for (const ref of refs) {
    const response = await get(ref);
    assert.equal(response.status, 200, ref);
    assert.match(
      response.headers.get("content-type"),
      new RegExp(types[ref.split("?")[0].split(".").pop()]),
      ref,
    );
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable", ref);
    assert.ok((await response.arrayBuffer()).byteLength > 0, ref);
  }
});

test("pages load nothing from other origins", async () => {
  const page = await (await get("/")).text(),
    css = await (await get("/styles.css")).text();
  assert.doesNotMatch(page, /fonts\.googleapis|fonts\.gstatic|(?:src|href)="https?:/);
  assert.doesNotMatch(css, /url\(["']?https?:/);
  assert.match(css, /url\("\/fonts\/vazirmatn\.woff2\?v=\w+"\)/);
});

test("the page revalidates with an ETag and answers 304 when unchanged", async () => {
  const response = await get("/"),
    etag = response.headers.get("etag");
  assert.equal(response.headers.get("cache-control"), "no-cache");
  assert.match(etag, /^"\w+"$/);
  const again = await get("/", { "if-none-match": etag });
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
  assert.equal((await get("/", { "if-none-match": '"stale"' })).status, 200);
});

test("an asset URL without the current version must revalidate", async () => {
  for (const path of ["/styles.css", "/app.js?v=old"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.equal(
      (await get(path, { "if-none-match": response.headers.get("etag") })).status,
      304,
      path,
    );
  }
  assert.equal((await get("/nope.css")).status, 404);
  assert.equal((await get("/constructor")).status, 404);
});

test("the page sends a restrictive content security policy", async () => {
  const headers = (await get("/")).headers,
    csp = headers.get("content-security-policy");
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ])
    assert.ok(csp.includes(directive), directive);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  const page = await (await get("/")).text();
  assert.doesNotMatch(page, /<script(?![^>]*\ssrc=)[^>]*>/, "no inline scripts");
  assert.doesNotMatch(page, /\son[a-z]+=/i, "no inline event handlers");
});
