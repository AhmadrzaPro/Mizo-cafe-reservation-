// Fails on `!important` in the stylesheets. Specificity decides; the only exception is a
// prefers-reduced-motion block, which must beat every animation and transition it switches off.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../web/css/", import.meta.url).pathname,
  files = readdirSync(root, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".css")),
  problems = [];
for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  // Blank out every reduced-motion block, keeping line numbers.
  const checked = text.replace(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g,
    (block) => block.replace(/[^\n]/g, " "),
  );
  checked.split("\n").forEach((line, i) => {
    if (line.includes("!important")) problems.push(`web/css/${file}:${i + 1}: ${line.trim()}`);
  });
}
if (problems.length) {
  console.error(`!important is not allowed outside prefers-reduced-motion:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log(`${files.length} stylesheets, no stray !important`);
