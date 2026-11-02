import { GUEST, api, bookThroughPage, createCafe, expect, test } from "./fixtures.mjs";

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

test("the chosen table is held while the form is open, and given back on going back", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await page.goto(cafe.url);
  await page.locator("#dates button").nth(1).click();
  await page.locator("#times button:not([disabled])").last().click();
  await page.locator("#continueBtn").click();
  const date = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(Date.now() + 86400000),
  );
  const freeTables = async () => {
    const day = await api(page, "GET", `${cafe.api}/availability?date=${date}&party_size=2`);
    return day.slots.flatMap((slot) => slot.tableIds);
  };
  const table = page.locator("#customerFloorPlan .table.available:not([disabled])").first();
  await table.click();
  const before = (await freeTables()).length;
  await page.locator("#confirmBtn").click();
  await expect(page.locator("#customerDialog")).toBeVisible();
  await expect(page.locator("#holdCountdown")).toContainText("نگه داشته شده");
  expect((await freeTables()).length).toBeLessThan(before);
  await page.locator("#customerDialog .dialog-close").click();
  await expect(page.locator("#tableDialog")).toBeVisible();
  await expect.poll(async () => (await freeTables()).length).toBe(before);
});
