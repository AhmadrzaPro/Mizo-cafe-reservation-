// docs/openapi.yaml documents exactly the routes the API serves, and its references resolve.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app } from "../worker/src/api.js";

const spec = readFileSync(new URL("../docs/openapi.yaml", import.meta.url), "utf8");

/** "METHOD /path/{param}" for every operation in the spec. */
function documented() {
  const operations = new Set();
  let path = null;
  for (const line of spec.split("\n")) {
    const pathLine = line.match(/^ {2}(\/\S*):$/);
    if (pathLine) path = pathLine[1];
    else if (/^\S/.test(line)) path = null;
    const method = line.match(/^ {4}(get|post|put|patch|delete):$/);
    if (path && method) operations.add(`${method[1].toUpperCase()} ${path}`);
  }
  return operations;
}

/** The same for the Hono app; `:name{regex}` becomes `{name}`, and catch-alls are skipped. */
function served() {
  return new Set(
    app.routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path.replace(/:(\w+)(\{[^}]*\})?/g, "{$1}")}`),
  );
}

test("every served route is documented, and every documented one is served", () => {
  const docs = documented(),
    routes = served();
  assert.ok(routes.size > 40, `only ${routes.size} routes found`);
  assert.deepEqual(
    [...routes].filter((route) => !docs.has(route)),
    [],
    "served but missing from docs/openapi.yaml",
  );
  assert.deepEqual(
    [...docs].filter((route) => !routes.has(route)),
    [],
    "documented but not served",
  );
});

test("every $ref points at a component that exists", () => {
  const refs = [...spec.matchAll(/\$ref: "#\/components\/(\w+)\/(\w+)"/g)];
  assert.ok(refs.length > 50);
  for (const [, section, name] of refs)
    assert.match(
      spec,
      new RegExp(`^ {2}${section}:\\n(?:(?: {4}.*)?\\n)*? {4}${name}:`, "m"),
      `#/components/${section}/${name}`,
    );
});

test("every operation has a unique operationId", () => {
  const ids = [...spec.matchAll(/^ {6}operationId: (\w+)$/gm)].map((m) => m[1]);
  assert.equal(ids.length, documented().size);
  assert.equal(new Set(ids).size, ids.length);
});
