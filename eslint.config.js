import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", "db/"] },
  js.configs.recommended,
  {
    files: ["web/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["worker/**/*.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      // An empty catch marks a deliberate fallback to the code after it.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
