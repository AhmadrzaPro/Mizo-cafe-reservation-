import { api, createCafe, expect, signInOwner, test } from "./fixtures.mjs";

test("panel controls respond: notice, schedule, table editing and branch switches", async ({
  page,
  request,
}) => {
  // Many page loads, each drawing the 3D floor without a GPU in CI.
  test.slow();
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
  // Floor editor: select a table, rename it, change its type and turn off online booking.
  await open("#openMapEditor");
  await expect(page.locator("#floorApp")).toHaveAttribute("data-mode", "edit");
  await page.locator(".tlabel").first().click();
  await page.locator("#e-name").fill("تست");
  await page.locator("#e-name").press("Enter");
  await expect(page.locator(".tlabel").first()).toContainText("تست");
  await page.locator('#floorPanel [data-type="long6"]').click();
  await page.locator("#e-reservable").setChecked(false);
  await expect(page.locator("#e-reservable")).not.toBeChecked();
  // Payments and SMS branch selectors.
  await open("#openPayments");
  await page.locator("#paymentsBranch").selectOption({ index: 1 });
  await open("#openSms");
  await page.locator("#smsBranch").selectOption({ index: 1 });
  await open("#openOperations");
  await page.locator("#opsBranch").selectOption({ index: 1 });
});

test("the floor editor returns to the panel, and asks first about unsaved changes", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator("#openMapEditor").click();
  const back = page.locator('#floorEditTools [data-et="back"]');
  await expect(back).toBeVisible();
  await back.click();
  await expect(page.locator("#adminDialog")).toBeVisible();
  await expect(page.locator("#floorApp")).toHaveAttribute("data-mode", "book");

  // With unsaved changes, declining the question keeps the editor open.
  await page.locator("#openMapEditor").click();
  await page.locator('#floorPalette [data-add="decor:plant"]').click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await back.click();
  await expect(page.locator("#floorApp")).toHaveAttribute("data-mode", "edit");
  page.once("dialog", (dialog) => dialog.accept());
  await back.click();
  await expect(page.locator("#adminDialog")).toBeVisible();
});

test("a table the owner adds and saves in the floor editor is offered to customers", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator("#openMapEditor").click();
  await page.locator('#floorPalette [data-add="table:booth6"]').click();
  await page.locator("#e-name").fill("V1");
  await page.locator("#e-name").press("Enter");
  await page.locator('#floorPanel [data-tag="مبل راحتی"]').click();
  await page.locator('#floorEditTools [data-et="save"]').click();
  await expect(page.locator("#floorToast")).toContainText("منتشر شد");

  const context = await browser.newContext({ baseURL }),
    customer = await context.newPage();
  await customer.goto(cafe.url);
  await customer.locator("#floorPlus").click();
  await customer.locator("#floorPlus").click();
  await customer.locator("#floorPlus").click();
  await customer.locator("#floorListToggle").click();
  const v1 = customer.locator("#floorList .list-table", { hasText: "V1" });
  await expect(v1).toContainText("۶ نفره");
  await v1.click();
  await expect(customer.locator("#floorPanel .tags")).toContainText("مبل راحتی");
  await context.close();
});
