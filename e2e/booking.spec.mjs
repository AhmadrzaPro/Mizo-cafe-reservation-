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

test("a held table is refused to others until the hold runs out, then the late booking is refused", async ({
  browser,
  baseURL,
  request,
}) => {
  // Chrome logs refused requests (409) as console errors; only those are expected here.
  const context = await browser.newContext({ baseURL }),
    page = await context.newPage(),
    problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 409/.test(message.text()))
      problems.push(message.text());
  });
  const cafe = await createCafe(request);
  await page.goto(cafe.url);
  await page.locator("#dates button").nth(1).click();
  await page.locator("#times button:not([disabled])").last().click();
  await page.locator("#continueBtn").click();
  const date = await page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(Date.now() + 86400000),
  );
  const lastSlot = async () =>
    (await api(page, "GET", `${cafe.api}/availability?date=${date}&party_size=2`)).slots
      .filter((slot) => slot.tableIds.length)
      .at(-1);
  const before = await lastSlot();
  await page.locator("#customerFloorPlan .table.available:not([disabled])").first().click();
  await page.locator("#confirmBtn").click();
  await expect(page.locator("#holdCountdown")).toContainText("نگه داشته شده");
  const after = await lastSlot();
  const tableId = before.tableIds.find((id) => !after.tableIds.includes(id));
  expect(tableId).toBeTruthy();
  const bookAsSomeoneElse = () =>
    page.evaluate(
      async ([url, body]) =>
        (
          await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
      [
        `${cafe.api}/reservations`,
        {
          customerName: "دیگری",
          mobile: "09129990000",
          partySize: 2,
          date,
          time: before.time,
          tableIds: [tableId],
        },
      ],
    );
  // While the customer fills in the form, nobody else can take the table.
  expect(await bookAsSomeoneElse()).toBe(409);
  // Once the hold has run out, someone else books it, and the backend refuses ours.
  await request.get(`/__e2e/expire-holds?cafe=${cafe.slug}`);
  expect(await bookAsSomeoneElse()).toBe(201);
  await page.locator("#customerName").fill("مهمان");
  await page.locator("#customerMobile").fill(GUEST);
  await page.locator("#customerDialog button[type=submit]").click();
  await expect(page.locator("#reservationError")).toBeVisible();
  await expect(page.locator("#successDialog")).toBeHidden();
  // Back on the table step the taken table is no longer offered.
  await page.locator("#customerDialog .dialog-close").click();
  await expect(page.locator("#confirmBtn")).toBeDisabled();
  expect(problems).toEqual([]);
  await context.close();
});
