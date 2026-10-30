// Shared browser-test helpers. Every page fails its test on a script error, a console error or a
// Content-Security-Policy violation.
import { test as base, expect } from "@playwright/test";

export { expect };

export const GUEST = "09121110000";

export const test = base.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    // Runs in the page, where the CSP reports violations as events.
    await page.addInitScript(() =>
      globalThis.document.addEventListener("securitypolicyviolation", (event) =>
        console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`),
      ),
    );
    await use(page);
    expect(problems, "the page logged errors").toEqual([]);
  },
});

let cafes = 0;
/**
 * Creates a café through the public setup API and returns its slug, owner and URLs. Each café gets
 * its own owner mobile, because setup allows only a few new cafés per owner.
 */
export async function createCafe(request, name = `کافه آزمون ${++cafes}`) {
  const owner = `0912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const response = await request.post("/api/setup", {
    data: {
      cafeName: name,
      city: "تهران",
      branchName: "مرکزی",
      ownerMobile: owner,
      ownerName: "مالک",
    },
  });
  expect(response.status()).toBe(201);
  const data = await response.json();
  return {
    name,
    owner,
    slug: data.cafe.slug,
    branchId: data.branches[0].id,
    url: `/?cafe=${data.cafe.slug}`,
    api: `/api/cafes/${data.cafe.slug}/branches/main`,
  };
}

/**
 * Calls the API from inside the page, so the browser's own (Secure) session cookie is sent. The
 * test request context does not send Secure cookies to http://127.0.0.1.
 */
export async function api(page, method, path, body) {
  if (page.url() === "about:blank") await page.goto("/");
  const result = await page.evaluate(
    async ([method, path, body]) => {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    },
    [method, path, body],
  );
  expect(result.status, `${method} ${path}`).toBeLessThan(300);
  return result.data;
}

/** Signs the owner in with the demo OTP code; the session cookie lands in the page's browser. */
export async function signInOwner(page, cafe) {
  const otp = await api(page, "POST", "/api/auth/request", {
    cafeSlug: cafe.slug,
    mobile: cafe.owner,
  });
  await api(page, "POST", "/api/auth/verify", {
    cafeSlug: cafe.slug,
    mobile: cafe.owner,
    code: otp.demoCode,
    challengeId: otp.challengeId,
  });
}

/** Books the latest free time tomorrow on the first free table; returns the tracking code. */
export async function bookThroughPage(page, cafe, { name = "مهمان آزمون", mobile = GUEST } = {}) {
  await page.goto(cafe.url);
  await page.locator("#dates button").nth(1).click();
  await page.locator("#times button:not([disabled])").last().click();
  await page.locator("#continueBtn").click();
  await page.locator("#customerFloorPlan .table.available:not([disabled])").first().click();
  await page.locator("#confirmBtn").click();
  await page.locator("#customerName").fill(name);
  await page.locator("#customerMobile").fill(mobile);
  await page.locator("#customerDialog button[type=submit]").click();
  await expect(page.locator("#successCode")).toHaveText(/^RMA-/);
  return (await page.locator("#successCode").textContent()).trim();
}
