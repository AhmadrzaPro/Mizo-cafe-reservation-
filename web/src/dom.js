/**
 * The page element with this id, typed from web/index.html (see web/src/element-ids.d.ts): an id
 * that is not in the page fails the type check.
 * @template {keyof import("./element-ids").ElementIds} K
 * @param {K} id
 * @returns {import("./element-ids").ElementIds[K]}
 */
export const byId = (id) => /** @type {any} */ (document.getElementById(id));
