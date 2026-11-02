import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", "db/", "playwright-report/", "test-results/"] },
  js.configs.recommended,
  {
    files: ["web/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Markup reaches the page only through setHtml() in web/src/dom.js, fed by the escaping
    // html`` tag; writing raw strings into the DOM anywhere else is an XSS hole waiting to happen.
    files: ["web/src/**/*.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]",
          message: "Use setHtml(element, html`...`) from dom.js.",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment)$/]",
          message: "Use fragment(html`...`) from dom.js.",
        },
        {
          selector: "CallExpression[callee.property.name='write'][callee.object.name='document']",
          message: "document.write is not allowed.",
        },
      ],
    },
  },
  {
    files: ["worker/**/*.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: [
      "scripts/**/*.mjs",
      "tests/**/*.mjs",
      "e2e/**/*.mjs",
      "eslint.config.js",
      "playwright.config.mjs",
    ],
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
