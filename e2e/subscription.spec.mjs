import { api, createCafe, expect, signInOwner, test } from "./fixtures.mjs";

test("a café pays its subscription card to card and the platform owner approves it", async ({
  page,
  browser,
  request,
}) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  await api(page, "PUT", "/api/subscription", { enabled: true });
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator("#openSubscription").click();
  await expect(page.locator("#subscriptionCardPayment .card-number")).toContainText(
    "6219 8619 3066 4833",
  );
  await page.locator("#subscriptionCardPayment input[name=reference]").fill("۷۷۷۸۸۸۹۹۹");
  await page.locator("#subscriptionCardPayment button[type=submit]").click();
  await expect(page.locator("#subscriptionCardPayment")).toContainText("777888999");

  const console = await browser.newContext({
    extraHTTPHeaders: { "oai-authenticated-user-id": "platform-owner" },
  });
  const saas = await console.newPage();
  saas.on("dialog", (d) => d.accept());
  await saas.goto("/saas-admin");
  const row = saas.locator(".saas-payment-row", { hasText: cafe.name });
  await expect(row).toContainText("777888999");
  await row.locator("[data-decision=approve]").click();
  await expect(row).toHaveCount(0);
  await console.close();

  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator("#openSubscription").click();
  await expect(page.locator("#subscriptionStatus")).toHaveText("فعال");
});

test("after the grace period the café's online booking pauses and the owner is told", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  await api(page, "PUT", "/api/subscription", { enabled: true });
  await page.request.get(`/__e2e/trial-ended?cafe=${cafe.slug}&days=5`);
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await expect(page.locator("#subscriptionNotice")).toContainText("رزرو آنلاین مشتریان بسته شده");

  const customer = await page.context().browser().newPage();
  await customer.goto(cafe.url);
  await expect(customer.locator("#continueBtn")).toBeDisabled();
  await expect(customer.locator("#continueBtn")).toHaveText("رزرو موقتاً متوقف است");
  await customer.close();
});
