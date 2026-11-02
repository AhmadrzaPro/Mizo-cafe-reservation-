import { createCafe, expect, signInOwner, test } from "./fixtures.mjs";
import { faDigitsToLatin } from "./text.mjs";

test("the owner signs in with a one-time code and opens every panel", async ({ page, request }) => {
  const cafe = await createCafe(request);
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator("#authMobile").fill(cafe.owner);
  await page.locator("#requestOtp").click();
  await expect(page.locator("#demoCodeBox")).toBeVisible();
  const code = faDigitsToLatin(await page.locator("#demoCode").textContent());
  await page.locator("#authCode").fill(code);
  await page.locator("#verifyOtp").click();
  await expect(page.locator("#adminDialog")).toBeVisible();
  await expect(page.locator("#adminCafeName")).toHaveText(cafe.name);

  for (const [button, dialog] of [
    ["#openReports", "#reportsDialog"],
    ["#openLoyalty", "#loyaltyDialog"],
    ["#openSms", "#smsDialog"],
    ["#openStaff", "#staffDialog"],
    ["#openBranches", "#branchesDialog"],
    ["#openPayments", "#paymentsDialog"],
    ["#openSubscription", "#subscriptionDialog"],
    ["#openControlCenter", "#controlDialog"],
    ["#openSchedule", "#scheduleDialog"],
  ]) {
    await page.goto(cafe.url);
    await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
    await page.locator(button).click();
    await expect(page.locator(dialog), dialog).toBeVisible();
  }
});

test("sign out of all devices ends every session", async ({ page, browser, request }) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  const other = await browser.newContext();
  await signInOwner(await other.newPage(), cafe);
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await expect(page.locator("#managerDevices")).toContainText("۲");
  page.once("dialog", (d) => d.accept());
  await page.locator("#logoutEverywhere").click();
  await expect(page.locator("#authDialog")).toBeVisible();
  const elsewhere = await other
    .pages()[0]
    .evaluate(async () => (await fetch("/api/auth/session")).json());
  expect(elsewhere.authenticated).toBe(false);
  await other.close();
});
