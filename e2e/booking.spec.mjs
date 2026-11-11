import { GUEST, api, bookThroughPage, createCafe, expect, openFloor, test } from "./fixtures.mjs";

/** The day and time chosen on the floor's top rows. */
async function chosen(page) {
  return {
    date: await page.locator("#floorDays .chip.on").getAttribute("data-d"),
    time: await page.locator("#floorHours .chip.on").getAttribute("data-h"),
  };
}

test("a customer books a table and tracks it without the mobile in any URL", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  const urls = [];
  page.on("request", (r) => urls.push(r.url()));
  const code = await bookThroughPage(page, cafe);
  await expect(page.locator("#floorPanel h3")).toContainText("رزرو تأیید شد");

  await page.locator("#floorTrack").click();
  await page.locator("#trackingCode").fill(code);
  await page.locator("#trackingMobile").fill("۰۹۱۲۱۱۱۰۰۰۰");
  await page.locator("#trackingForm button[type=submit]").click();
  await expect(page.locator("#trackingResult")).toContainText("تأیید شده");
  expect(urls.filter((u) => u.includes(GUEST.slice(1)))).toEqual([]);
});

test("the café's page is its 3D floor, with only the café's own details", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request, "کافه نارنج");
  await openFloor(page, cafe);
  await expect(page).toHaveTitle("کافه نارنج — رزرو میز");
  await expect(page.locator("#floorCafeName")).toHaveText("کافه نارنج");
  await expect(page.locator("#features")).toBeHidden();
  await expect(page.locator("body")).not.toContainText("روما");
});

test("without a café the page introduces Mizo, and no floor is loaded", async ({ page }) => {
  const engine = [];
  page.on("request", (r) => r.url().includes("/floor3d.js") && engine.push(r.url()));
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute("data-mode", "platform");
  await expect(page.locator("#floorApp")).toBeHidden();
  await expect(page.locator("#features")).toBeVisible();
  expect(engine).toEqual([]);
});

test("a table tapped in 3D is held while the form is filled in, and given back on closing", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await openFloor(page, cafe);
  await expect(page.locator("#floorScene canvas")).toBeVisible();
  const { date, time } = await chosen(page);
  const freeAt = async () => {
    const day = await api(page, "GET", `${cafe.api}/availability?date=${date}&party_size=2`);
    return day.slots.find((slot) => slot.time === time).tableIds.length;
  };
  const before = await freeAt();
  await page.locator('.tlabel[data-state="free"]').first().click();
  await expect(page.locator("#floorPanel .status")).toContainText("آزاد است");
  await page.locator("#f-name").focus();
  await expect(page.locator("#f-hold")).toContainText("نگه داشته شده");
  expect(await freeAt()).toBe(before - 1);
  await page.locator("#floorPanel [data-close]").first().click();
  await expect.poll(freeAt).toBe(before);
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
  await openFloor(page, cafe);
  const { date, time } = await chosen(page);
  await page.locator("#floorListToggle").click();
  const free = page.locator("#floorList .list-table.free").first(),
    tableId = `${cafe.branchId}:${await free.getAttribute("data-pick")}`;
  await free.click();
  await page.locator("#f-name").fill("مهمان");
  await expect(page.locator("#f-hold")).toContainText("نگه داشته شده");
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
          time,
          tableIds: [tableId],
        },
      ],
    );
  // While the customer fills in the form, nobody else can take the table.
  expect(await bookAsSomeoneElse()).toBe(409);
  // Once the hold has run out, someone else books it, and the backend refuses ours.
  await request.get(`/__e2e/expire-holds?cafe=${cafe.slug}`);
  expect(await bookAsSomeoneElse()).toBe(201);
  await page.locator("#f-phone").fill(GUEST);
  await page.locator("#floorPanel [data-book]").click();
  await expect(page.locator("#floorPanelNote")).toContainText("میز یا ساعت دیگری");
  await expect(page.locator("#floorTrackingCode")).toHaveCount(0);
  // The floor now shows that table as booked at that time.
  await expect(page.locator(`#floorList [data-pick="${tableId.split(":").pop()}"]`)).toHaveClass(
    /busy/,
  );
  expect(problems).toEqual([]);
  await context.close();
});
