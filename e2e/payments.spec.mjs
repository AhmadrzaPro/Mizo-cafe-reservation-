import { api, bookThroughPage, createCafe, expect, signInOwner, test } from "./fixtures.mjs";

test("a deposit is paid through ZarinPal and the customer returns to a confirmed booking", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await signInOwner(page, cafe);
  const settings = await api(page, "GET", `${cafe.api}/settings`);
  await api(page, "PUT", `${cafe.api}/settings`, {
    ...settings,
    depositEnabled: true,
    depositAmountRials: 500000,
    depositMode: "fixed",
    depositPeakOnly: false,
  });
  // The bank: send the customer straight back to the callback with Status=OK.
  const origin = test.info().project.use.baseURL;
  await page.route("https://sandbox.zarinpal.com/**", (route) => {
    const authority = route.request().url().split("/").pop();
    route.fulfill({
      status: 303,
      headers: {
        location: `${origin}/api/payments/zarinpal/callback?Authority=${authority}&Status=OK`,
      },
    });
  });
  await bookThroughPage(page, cafe);
  await expect(page.locator("#payDeposit")).toHaveText("پرداخت آنلاین بیعانه");
  await page.locator("#payDeposit").click();
  await expect(page.locator("#paymentReturn")).toContainText("پرداخت با موفقیت انجام شد");
  await page.locator("#trackingMobile").fill("09121110000");
  await page.locator("#trackingForm button[type=submit]").click();
  await expect(page.locator("#trackingResult")).toContainText("بیعانه پرداخت شده");
});
