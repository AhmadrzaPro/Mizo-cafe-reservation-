// Readable booking links, /<café>/<branch>: the owner's link names, their rules, how the page and
// the profile resolve them, and the old ?cafe= links that must keep working.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingLink, linkName } from "../worker/src/links.js";
import { fixture } from "./helpers/worker.mjs";

const OTHER_OWNER = "09121112233";

test("a link name is short, lowercase Latin, and never looks like an internal slug", () => {
  assert.equal(linkName("  Lamiz ", "cafe"), "lamiz");
  assert.equal(linkName("cafe-lamiz-2", "branch"), "cafe-lamiz-2");
  assert.equal(linkName("", "cafe"), "", "empty clears the link");
  for (const bad of ["ab", "-lamiz", "lamiz-", "la--miz", "لامیز", "la miz", "a".repeat(41)])
    assert.equal(linkName(bad, "cafe"), null, bad);
  for (const reserved of ["api", "saas-admin", "assets", "fonts", "cafe-abc", "multi-abc"])
    assert.equal(linkName(reserved, "cafe"), null, reserved);
  assert.equal(linkName("main", "branch"), null);
  assert.equal(linkName("branch-x1", "branch"), null);
  assert.equal(linkName("vanak", "branch"), "vanak");
});

test("the page is served at /<café> and /<café>/<branch>, but not at the app's own paths", () => {
  assert.deepEqual(bookingLink("/lamiz"), { cafe: "lamiz", branch: "" });
  assert.deepEqual(bookingLink("/lamiz/vanak/"), { cafe: "lamiz", branch: "vanak" });
  for (const path of ["/", "/api", "/assets", "/app.js", "/a/b/c", "/Lamiz", "/saas-admin"])
    assert.equal(bookingLink(path), null, path);
});

test("the owner names the café and a branch, and the profile resolves either name", async () => {
  const f = await fixture(),
    cafe = await f.setupCafe(),
    owner = await f.login(cafe);
  let saved = await f.call("/api/cafe/link", {
    method: "PATCH",
    cookie: owner,
    body: { link: "Lamiz" },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.cafe.link, "lamiz");
  const branch = await f.call("/api/branches", {
    method: "POST",
    cookie: owner,
    body: { name: "ونک", city: "تهران", link: "vanak" },
  });
  assert.equal(branch.status, 201);
  const vanak = branch.data.branches.find((b) => b.name === "ونک");
  assert.equal(vanak.link, "vanak");

  // The link name and the internal slug both open the same café.
  const byLink = (await f.call("/api/setup?cafe=lamiz")).data;
  assert.equal(byLink.cafe.slug, cafe.slug);
  assert.equal((await f.call(`/api/setup?cafe=${cafe.slug}`)).data.cafe.link, "lamiz");
  assert.ok(byLink.branches.some((b) => b.slug === vanak.slug && b.link === "vanak"));

  // Editing the branch without a link keeps it; an empty one clears it.
  saved = await f.call(`/api/branches/${vanak.slug}`, {
    method: "PATCH",
    cookie: owner,
    body: { name: "ونک", city: "تهران" },
  });
  assert.equal(saved.data.branches.find((b) => b.slug === vanak.slug).link, "vanak");
  saved = await f.call(`/api/branches/${vanak.slug}`, {
    method: "PATCH",
    cookie: owner,
    body: { name: "ونک", city: "تهران", link: "" },
  });
  assert.equal(saved.data.branches.find((b) => b.slug === vanak.slug).link, "");
});

test("a link name is refused when invalid or taken, by another café or another branch", async () => {
  const f = await fixture(),
    first = await f.setupCafe(),
    second = await f.setupCafe("کافه دوم", OTHER_OWNER),
    owner = await f.login(first),
    other = await f.login(second, OTHER_OWNER);
  const setLink = (cookie, link) =>
    f.call("/api/cafe/link", { method: "PATCH", cookie, body: { link } });
  assert.equal((await setLink(owner, "lamiz")).status, 200);
  const taken = await setLink(other, "lamiz");
  assert.equal(taken.status, 409);
  assert.equal(taken.data.error, "link_taken");
  assert.equal((await setLink(other, second.slug)).status, 400, "an internal slug is reserved");
  assert.equal((await setLink(other, "api")).data.error, "invalid_link");
  assert.equal((await setLink(owner, "lamiz")).status, 200, "keeping its own name is fine");

  // Branch link names are unique within a café, and only the owner sets the café's.
  const add = (link) =>
    f.call("/api/branches", {
      method: "POST",
      cookie: owner,
      body: { name: "شعبه", city: "تهران", link },
    });
  assert.equal((await add("vanak")).status, 201);
  assert.equal((await add("vanak")).data.error, "link_taken");
  assert.equal((await add("main")).data.error, "invalid_link");
  assert.equal((await setLink("", "anything")).status, 403);
});

test("the booking page opens at a café's link, and an unknown café answers 404", async () => {
  const f = await fixture(),
    cafe = await f.setupCafe(),
    owner = await f.login(cafe);
  await f.call("/api/cafe/link", { method: "PATCH", cookie: owner, body: { link: "lamiz" } });
  for (const path of ["/lamiz", "/lamiz/main", `/${cafe.slug}/main`]) {
    const page = await f.call(path);
    assert.equal(page.status, 200, path);
    assert.match(String(page.data), /<script src="\/app\.js\?v=/);
  }
  const missing = await f.call("/no-such-cafe/main");
  assert.equal(missing.status, 404);
  assert.match(String(missing.data), /<script src="\/app\.js\?v=/, "the page explains it");
  // The old ?cafe= link keeps working.
  assert.equal((await f.call(`/?cafe=${cafe.slug}`)).status, 200);
});
