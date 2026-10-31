// The html`` tag escapes everything it did not build itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, SafeHtml, escapeHtml } from "../web/src/dom.js";

test("interpolated text is escaped, in content and attributes", () => {
  const name = `<img src=x onerror="alert(1)">'&`;
  assert.equal(
    html`<b title="${name}">${name}</b>`.value,
    '<b title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;</b>',
  );
});

test("nested html`` stays markup; arrays join; null, undefined and false render nothing", () => {
  const items = ["<a>", "b"].map((x) => html`<li>${x}</li>`);
  const list = html`<ul>${items}</ul>`; // prettier-ignore
  assert.equal(list.value, "<ul><li>&lt;a&gt;</li><li>b</li></ul>");
  assert.equal(html`${null}${undefined}${false}${0}${""}`.value, "0");
  assert.equal(html`${[1].length > 0 && html`<i>x</i>`}`.value, "<i>x</i>");
  assert.ok(html`` instanceof SafeHtml);
  assert.equal(escapeHtml(undefined), "");
});
