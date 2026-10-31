/**
 * The page element with this id, typed from web/index.html (see web/src/element-ids.d.ts): an id
 * that is not in the page fails the type check.
 * @template {keyof import("./element-ids").ElementIds} K
 * @param {K} id
 * @returns {import("./element-ids").ElementIds[K]}
 */
export const byId = (id) => /** @type {any} */ (document.getElementById(id));

// Markup for the page is built only with the html`` tag and written only with setHtml():
// every interpolated value is escaped unless it is itself html``, so text from customers or
// staff can never become markup. ESLint forbids innerHTML everywhere else.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>'"]/g, (char) => ESCAPES[char]);

/** Markup already built safely by html``. */
export class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/** @param {unknown} value @returns {string} */
function part(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(part).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(value);
}

/**
 * Builds markup, escaping every interpolated value; arrays are joined, and null, undefined and
 * false render nothing, so conditions can be written inline.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => (out += part(value) + strings[i + 1]));
  return new SafeHtml(out);
}

/** The one place markup reaches the page. @param {Element} element @param {SafeHtml | ""} markup */
export function setHtml(element, markup) {
  // eslint-disable-next-line no-restricted-syntax -- the single sanctioned sink
  element.innerHTML = markup === "" ? "" : markup.value;
}

/** Markup turned into nodes, ready to append. @param {SafeHtml} markup */
export function fragment(markup) {
  const template = document.createElement("template");
  setHtml(template, markup);
  return template.content;
}
