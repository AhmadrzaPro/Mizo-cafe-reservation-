// Every environment variable the Worker reads is documented and listed in .env.example.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url),
  read = (path) => readFileSync(new URL(path, root), "utf8"),
  source = readdirSync(new URL("worker/src/", root), { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".js"))
    .map((file) => read(`worker/src/${file}`))
    .join("\n");

test("every variable the Worker reads is in docs/configuration.md and .env.example", () => {
  const used = new Set([
    ...[...source.matchAll(/env\??\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]),
    // Rate limits are looked up by name.
    ...[...source.matchAll(/"([A-Z][A-Z0-9_]*_(?:PER|CAP)_[A-Z0-9_]+)"/g)].map((m) => m[1]),
  ]);
  assert.ok(used.size > 20, `only ${used.size} variables found`);
  const docs = read("docs/configuration.md"),
    example = read(".env.example");
  for (const name of used) {
    assert.ok(docs.includes(`\`${name}\``), `${name} is not in docs/configuration.md`);
    if (name !== "DB")
      assert.match(example, new RegExp(`^#? ?${name}=`, "m"), `${name} is not in .env.example`);
  }
});
