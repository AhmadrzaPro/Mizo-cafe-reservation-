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
