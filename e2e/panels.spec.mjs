import { api, createCafe, expect, signInOwner, test } from "./fixtures.mjs";

test("panel controls respond: notice, schedule, table editing and branch switches", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  await api(page, "POST", "/api/branches", { name: "شعبه دوم", city: "تهران" });
  const open = async (button) => {
    await page.goto(cafe.url);
    await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
    await page.locator(button).click();
  };
  // Control centre: notice counter, branch switch.
  await open("#openControlCenter");
  await page.locator("#customerNotice").fill("سلام");
  await expect(page.locator("#noticeCount")).toHaveText("۴");
  await expect(page.locator("#controlBranch option")).toHaveCount(2);
  await page.locator("#controlBranch").selectOption({ index: 1 });
  // Schedule: closing a day disables its times.
  await open("#openSchedule");
  const firstRow = page.locator(".hour-row").first();
  await firstRow.locator("[data-closed]").check();
  await expect(page.locator(".hour-row").first().locator("[data-open]")).toBeDisabled();
  await page.locator(".hour-row").first().locator("[data-closed]").uncheck();
  await page.locator(".hour-row").first().locator("[data-open]").fill("09:30");
  // Map editor: select a table, rename, change shape and reservable.
  await open("#openMapEditor");
  await page.locator(".editor-table").first().click();
  // On a phone the properties open in a sheet from the "edit table" button.
  if (!(await page.locator("#tableName").isVisible()))
    await page.locator("#editSelectedTable").click();
  await page.locator("#tableName").fill("میز تست");
  await expect(page.locator(".editor-table.selected")).toContainText("تست");
  await page.locator("#tableShape").selectOption({ index: 1 });
  await page.locator("#tableReservable").setChecked(false);
  await expect(page.locator("#tableReservable")).not.toBeChecked();
  await page.locator("#branchSelect").selectOption({ index: 1 });
  // Payments and SMS branch selectors.
  await open("#openPayments");
  await page.locator("#paymentsBranch").selectOption({ index: 1 });
  await open("#openSms");
  await page.locator("#smsBranch").selectOption({ index: 1 });
  await open("#openOperations");
  await page.locator("#opsBranch").selectOption({ index: 1 });
});

test("the map editor's back button returns to the panel, and asks first about unpublished changes", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator("#openMapEditor").click();
  const back = page.locator("#editorExit");
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.locator("#mapEditorDialog")).not.toBeVisible();
  await expect(page.locator("#adminDialog")).toBeVisible();

  // With unpublished changes, declining the question keeps the editor open.
  await page.locator("#openMapEditor").click();
  // Wait for the map to load: loading resets the "unpublished changes" state.
  await expect(page.locator("#saveStatus")).toHaveText("همگام با دیتابیس");
  await page
    .locator("[data-add-shape=round]")
    .first()
    .evaluate((button) => button.click());
  page.once("dialog", (dialog) => dialog.dismiss());
  await back.click();
  await expect(page.locator("#mapEditorDialog")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await back.click();
  await expect(page.locator("#adminDialog")).toBeVisible();
});

test("the door, window and counter chosen in the editor appear on the customer's map", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator("#openMapEditor").click();
  await expect(page.locator("#saveStatus")).toHaveText("همگام با دیتابیس");
  await page.locator("#areaSizeToggle").click();
  await page.locator("#areaWindow").selectOption("none");
  await page.locator("#areaCounter").selectOption("right");
  await page.locator("#areaDoor").selectOption("top");
  // The editor redraws at once.
  await expect(page.locator(".canvas-window")).toBeHidden();
  await expect(page.locator(".canvas-bar")).toHaveAttribute("data-side", "right");
  await expect(page.locator(".canvas-door")).toHaveAttribute("data-side", "top");
  await page.locator("#publishMap").click();
  await expect(page.locator("#saveStatus")).toHaveText("همگام با دیتابیس");

  const map = await api(page, "GET", `${cafe.api}/map`);
  expect(map.areas[0].layout).toEqual({ door: "top", window: "none", counter: "right" });
  // The customer's map draws the counter on the right wall and no window.
  await page.goto(cafe.url);
  await page.locator("#dates button").nth(1).click();
  await page.locator("#times button:not([disabled])").last().click();
  await page.locator("#continueBtn").click();
  await expect(page.locator("#customerFloorPlan .window-label")).toHaveCount(0);
  const counter = page.locator("#customerFloorPlan .bar");
  if (await counter.isVisible()) {
    const box = await counter.evaluate((element) => ({
      left: parseFloat(element.style.left),
      width: parseFloat(element.style.width),
    }));
    expect(box.left + box.width).toBe(820 - 24);
  } else await expect(counter).toHaveCount(1); // phones hide the counter label, as before
});
