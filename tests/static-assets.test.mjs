import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";

const get = (path) =>
  worker.fetch(new Request("https://test.local" + path), {}, { waitUntil() {} });

test("every script, stylesheet and image the page references is served", async () => {
  const page = await (await get("/")).text();
  const refs = [...page.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|png|webp|jpg|svg))"/g)].map(
    (m) => "/" + m[1].replace(/^\//, ""),
  );
  assert.ok(refs.includes("/assets/cafe-hero.webp"));
  const types = { js: "javascript", css: "css", png: "png", webp: "webp", jpg: "jpeg", svg: "svg" };
  for (const ref of refs) {
    const response = await get(ref);
    assert.equal(response.status, 200, ref);
    assert.match(
      response.headers.get("content-type"),
      new RegExp(types[ref.split(".").pop()]),
      ref,
    );
    assert.ok((await response.arrayBuffer()).byteLength > 0, ref);
  }
});
