import { GUEST, bookThroughPage, createCafe, expect, test } from "./fixtures.mjs";

test("a customer books a table and tracks it without the mobile in any URL", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  const urls = [];
  page.on("request", (r) => urls.push(r.url()));
  const code = await bookThroughPage(page, cafe);
  await expect(page.locator(".success-dialog h2")).toContainText("رزرو شد");
  await page.locator("#doneBtn").click();

  await page.locator("#openTracking").click();
  await page.locator("#trackingCode").fill(code);
  await page.locator("#trackingMobile").fill("۰۹۱۲۱۱۱۰۰۰۰");
  await page.locator("#trackingForm button[type=submit]").click();
  await expect(page.locator("#trackingResult")).toContainText("تأیید شده");
  expect(urls.filter((u) => u.includes(GUEST.slice(1)))).toEqual([]);
});

test("the booking page shows only the café's own details", async ({ page, request }) => {
  const cafe = await createCafe(request, "کافه نارنج");
  await page.goto(cafe.url);
  await expect(page).toHaveTitle("کافه نارنج — رزرو میز");
  await expect(page.locator(".cafe-meta")).toContainText("کافه نارنج");
  await expect(page.locator("#features")).toBeHidden();
  await expect(page.locator("body")).not.toContainText("روما");
});

test("without a café the page introduces Mizo and booking stays closed", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-mode", "platform");
  await expect(page.locator("#continueBtn")).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("روما");
});
