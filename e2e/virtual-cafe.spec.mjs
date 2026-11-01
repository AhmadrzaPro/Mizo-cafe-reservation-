// The Virtual Cafe in a real browser: off by default, loaded only on request, booking through the
// standard flow, conflicts refused by the backend, and every failure falling back to the 2D map.
import { api, createCafe, expect, GUEST, test } from "./fixtures.mjs";

/** A café that offers the Virtual Cafe. */
async function virtualCafe(request) {
  const cafe = await createCafe(request);
  await request.get(`/__e2e/virtual-cafe?cafe=${cafe.slug}`);
  return cafe;
}

/** Opens the table step for tomorrow's latest free time, recording engine downloads. */
async function openTableStep(page, cafe) {
  const engineRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/virtual-cafe.js")) engineRequests.push(request.url());
  });
  await page.goto(cafe.url);
  await page.locator("#dates button").nth(1).click();
  await page.locator("#times button:not([disabled])").last().click();
  await page.locator("#continueBtn").click();
  await expect(page.locator("#tableDialog")).toBeVisible();
  return engineRequests;
}

/** Opens the Virtual Cafe and picks the first free table from the list. */
async function pickFreeTable(page) {
  await page.locator("#openVirtualCafe").click();
  await expect(page.locator(".virtual-cafe-canvas")).toBeVisible();
  await page.locator("#virtualTableListToggle").click();
  const free = page.locator("#virtualTableList button[data-state=AVAILABLE]").first(),
    tableId = await free.getAttribute("data-table-id"),
    name = (await free.locator("b").textContent()).trim();
  await free.click();
  await expect(page.locator("#virtualTableCard")).toHaveAttribute("data-state", "AVAILABLE");
  return { tableId, name };
}

test("with the Virtual Cafe off, booking is unchanged and nothing 3D is loaded", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request),
    engineRequests = await openTableStep(page, cafe);
  await expect(page.locator("#openVirtualCafe")).toBeHidden();
  await page.locator("#customerFloorPlan .table.available:not([disabled])").first().click();
  await page.locator("#confirmBtn").click();
  await page.locator("#customerName").fill("مهمان");
  await page.locator("#customerMobile").fill(GUEST);
  await page.locator("#customerDialog button[type=submit]").click();
  await expect(page.locator("#successCode")).toHaveText(/^RMA-/);
  expect(engineRequests).toEqual([]);
  expect(await page.locator("canvas").count()).toBe(0);
});

test("a table chosen in the Virtual Cafe is booked through the standard form", async ({
  page,
  request,
}) => {
  const cafe = await virtualCafe(request),
    engineRequests = await openTableStep(page, cafe);
  await expect(page.locator("#openVirtualCafe")).toBeVisible();
  expect(engineRequests, "the engine waits until it is asked for").toEqual([]);

  const { tableId, name } = await pickFreeTable(page);
  expect(engineRequests).toHaveLength(1);
  expect(tableId).toMatch(new RegExp(`^branch:${cafe.slug}:main:[^:]+$`));
  await expect(page.locator("#virtualTableName")).toHaveText(name);

  await page.locator("#virtualTableReserve").click();
  await expect(page.locator("#virtualCafeDialog")).toBeHidden();
  await expect(page.locator("#customerDialog")).toBeVisible();
  await expect(page.locator("#customerSummary")).toContainText(name);
  expect(await page.locator("canvas").count(), "the engine is gone with its dialog").toBe(0);

  await page.locator("#customerName").fill("مهمان مجازی");
  await page.locator("#customerMobile").fill(GUEST);
  await page.locator("#customerDialog button[type=submit]").click();
  await expect(page.locator("#successCode")).toHaveText(/^RMA-/);
  const code = (await page.locator("#successCode").textContent()).trim();
  const booked = await api(page, "POST", `/api/reservations/${code}`, { mobile: GUEST });
  expect(booked.tables).toEqual([name]);
});

/** Books a table for tomorrow's latest free time as another customer would, through the API. */
async function bookAsSomeoneElse(page, cafe, tableId) {
  const date = await page.evaluate(() =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(Date.now() + 86400000),
    ),
    day = await api(page, "GET", `${cafe.api}/availability?date=${date}&party_size=2`),
    time = day.slots.filter((slot) => slot.available).at(-1).time;
  const booked = await page.evaluate(
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
  expect(booked).toBe(201);
}

test("a table taken while the customer looks is not handed to booking, and shows as taken", async ({
  page,
  request,
}) => {
  const cafe = await virtualCafe(request);
  await openTableStep(page, cafe);
  const { tableId } = await pickFreeTable(page);
  await bookAsSomeoneElse(page, cafe, tableId);
  await page.locator("#virtualTableReserve").click();
  // The adapter re-read availability from the backend before handing over.
  await expect(page.locator("#virtualTableCard")).toHaveAttribute("data-state", "UNAVAILABLE");
  await expect(page.locator("#virtualTableReserve")).toBeDisabled();
  await expect(page.locator("#customerDialog")).toBeHidden();
  await page.locator("#virtualTableListToggle").click();
  await expect(page.locator(`#virtualTableList [data-table-id="${tableId}"]`)).toHaveAttribute(
    "data-state",
    "UNAVAILABLE",
  );
});

test("a table taken after the hand-off is refused by the backend, and the maps refresh", async ({
  browser,
  baseURL,
  request,
}) => {
  // Chrome logs the refused request (409) as a console error; only that one is expected here.
  const context = await browser.newContext({ baseURL }),
    page = await context.newPage(),
    problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 409/.test(message.text()))
      problems.push(message.text());
  });
  const cafe = await virtualCafe(request);
  await openTableStep(page, cafe);
  const { tableId } = await pickFreeTable(page);
  await page.locator("#virtualTableReserve").click();
  await expect(page.locator("#customerDialog")).toBeVisible();
  await bookAsSomeoneElse(page, cafe, tableId);

  await page.locator("#customerName").fill("مهمان");
  await page.locator("#customerMobile").fill(GUEST);
  await page.locator("#customerDialog button[type=submit]").click();
  await expect(page.locator("#reservationError")).toBeVisible();
  await expect(page.locator("#successDialog")).toBeHidden();
  // Back on the table step the 2D map shows the table as taken, and so does the Virtual Cafe.
  await page.locator("#customerDialog .dialog-close").click();
  await expect(page.locator("#confirmBtn")).toBeDisabled();
  await page.locator("#openVirtualCafe").click();
  await expect(page.locator(".virtual-cafe-canvas")).toBeVisible();
  await page.locator("#virtualTableListToggle").click();
  await expect(page.locator(`#virtualTableList [data-table-id="${tableId}"]`)).toHaveAttribute(
    "data-state",
    "UNAVAILABLE",
  );
  expect(problems).toEqual([]);
  await context.close();
});

test("when the 3D engine fails to load, the customer goes on with the 2D map", async ({
  page,
  request,
}) => {
  // A script that loads but never registers the engine.
  await page.route("**/virtual-cafe.js*", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "/* broken */" }),
  );
  const cafe = await virtualCafe(request);
  await openTableStep(page, cafe);
  await page.locator("#openVirtualCafe").click();
  await expect(page.locator("#virtualCafeStatus")).toHaveAttribute("data-kind", "failed");
  await expect(page.locator("#virtualCafeRetry")).toBeVisible();
  await page.locator("#virtualCafeStandard").click();
  await expect(page.locator("#virtualCafeDialog")).toBeHidden();
  await page.locator("#customerFloorPlan .table.available:not([disabled])").first().click();
  await page.locator("#confirmBtn").click();
  await expect(page.locator("#customerDialog")).toBeVisible();
});

test("without WebGL the Virtual Cafe says so and downloads nothing", async ({ page, request }) => {
  await page.addInitScript(() => {
    // Runs in the page, where HTMLCanvasElement exists.
    const canvasClass = globalThis.HTMLCanvasElement,
      original = canvasClass.prototype.getContext;
    canvasClass.prototype.getContext = function (type, ...rest) {
      return /webgl/.test(String(type)) ? null : original.call(this, type, ...rest);
    };
  });
  const cafe = await virtualCafe(request),
    engineRequests = await openTableStep(page, cafe);
  await page.locator("#openVirtualCafe").click();
  await expect(page.locator("#virtualCafeStatus")).toHaveAttribute("data-kind", "failed");
  await expect(page.locator("#virtualCafeStatusText")).toContainText("سه‌بعدی");
  expect(engineRequests).toEqual([]);
});

test("on a slow connection the loading screen can be left for the 2D map at once", async ({
  page,
  request,
}) => {
  let release = () => {};
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/virtual-cafe.js*", async (route) => {
    await held;
    await route.continue();
  });
  const cafe = await virtualCafe(request);
  await openTableStep(page, cafe);
  await page.locator("#openVirtualCafe").click();
  await expect(page.locator("#virtualCafeStatus")).toHaveAttribute("data-kind", "loading");
  await page.locator("#virtualCafeStandard").click();
  await expect(page.locator("#virtualCafeDialog")).toBeHidden();
  await expect(page.locator("#tableDialog")).toBeVisible();
  // The download finishing later opens nothing.
  release();
  await page.waitForTimeout(1500);
  await expect(page.locator("#virtualCafeDialog")).toBeHidden();
  expect(await page.locator("canvas").count()).toBe(0);
});
