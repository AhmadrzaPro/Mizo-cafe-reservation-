// Editable dialogs open only once their data has loaded, so a slow response can never overwrite
// what was already changed in them.
import { createCafe, expect, signInOwner, test } from "./fixtures.mjs";

const SLOW = 1500;

async function slowDown(page, pattern) {
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await new Promise((resolve) => setTimeout(resolve, SLOW));
    await route.continue();
  });
}

async function openPanel(page, cafe, button) {
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator(button).click();
}

test("slow loads never overwrite edits in the SMS, schedule, control and subscription dialogs", async ({
  page,
  request,
}) => {
  // Many page loads, each drawing the 3D floor without a GPU in CI.
  test.slow();
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);

  await slowDown(page, "**/notifications");
  await openPanel(page, cafe, "#openSms");
  await expect(page.locator("#smsDialog")).toBeVisible();
  await page.locator("#smsConfirmationEnabled").setChecked(false);
  await page.waitForTimeout(SLOW + 300);
  await expect(page.locator("#smsConfirmationEnabled")).not.toBeChecked();

  await slowDown(page, "**/schedule");
  await openPanel(page, cafe, "#openSchedule");
  await expect(page.locator("#scheduleDialog")).toBeVisible();
  await page.locator(".hour-row").first().locator("[data-closed]").check();
  await page.waitForTimeout(SLOW + 300);
  await expect(page.locator(".hour-row").first().locator("[data-closed]")).toBeChecked();

  await slowDown(page, "**/settings");
  await openPanel(page, cafe, "#openControlCenter");
  await expect(page.locator("#controlDialog")).toBeVisible();
  await page.locator("#customerNotice").fill("اطلاعیه");
  await page.waitForTimeout(SLOW + 300);
  await expect(page.locator("#customerNotice")).toHaveValue("اطلاعیه");

  await slowDown(page, "**/api/subscription");
  await openPanel(page, cafe, "#openSubscription");
  await expect(page.locator("#subscriptionDialog")).toBeVisible();
  await page.locator("#subscriptionCardPayment input[name=reference]").fill("123456");
  await page.waitForTimeout(SLOW + 300);
  await expect(page.locator("#subscriptionCardPayment input[name=reference]")).toHaveValue(
    "123456",
  );
});
