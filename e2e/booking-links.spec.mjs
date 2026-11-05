// Readable booking links in a real browser: the owner names the café and a branch, and each link
// opens that branch for customers; old ?cafe= links still work and show the readable one.
import { createCafe, expect, signInOwner, test } from "./fixtures.mjs";

const unique = () => Math.random().toString(36).slice(2, 8);

test("the owner names the café and a branch, and the branch's link opens that branch", async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const cafe = await createCafe(request),
    cafeLink = `kafe-${unique()}`,
    branchLink = `vanak-${unique()}`;
  await signInOwner(page, cafe);
  await page.goto(cafe.url);
  await page.getByRole("button", { name: "پنل مدیر کافه" }).first().click();
  await page.locator("#openBranches").click();
  await expect(page.locator("#branchesDialog")).toBeVisible();

  // An internal-looking name is refused with the reason; a good one is saved.
  await page.locator("#cafeLink").fill("cafe-mine");
  await page.locator("#saveCafeLink").click();
  await expect(page.locator("#cafeLinkError")).toContainText("رزرو شده");
  await page.locator("#cafeLink").fill(cafeLink);
  await page.locator("#saveCafeLink").click();
  await expect(page.locator("#cafeLinkError")).toBeEmpty();
  await expect(page.locator(".branch-link").first()).toContainText(`/${cafeLink}/main`);

  await page.locator("#addBranch").click();
  await page.locator("#branchName").fill("شعبه ونک");
  await page.locator("#branchCity").fill("تهران");
  await page.locator("#branchLink").fill(branchLink);
  await expect(page.locator("#branchLinkPreview")).toContainText(`/${cafeLink}/${branchLink}`);
  await page.locator("#saveBranch").click();
  await expect(page.locator("#branchFormDialog")).toBeHidden();
  await expect(page.locator(".branch-link", { hasText: branchLink })).toBeVisible();

  // A customer opening the branch's link books at that branch, and can switch branches.
  const context = await browser.newContext({ baseURL }),
    customer = await context.newPage();
  await customer.goto(`/${cafeLink}/${branchLink}`);
  await expect(customer.locator(".cafe-meta")).toContainText("شعبه ونک");
  await expect(customer.locator("#customerBranchRow")).toBeVisible();
  await expect(customer).toHaveURL(new RegExp(`/${cafeLink}/${branchLink}$`));
  await customer.locator("#customerBranch").selectOption({ label: "مرکزی" });
  await expect(customer.locator(".cafe-meta")).toContainText("مرکزی");
  await expect(customer).toHaveURL(new RegExp(`/${cafeLink}/main$`));
  await context.close();
});

test("an old ?cafe= link still opens the café and shows its readable link", async ({
  page,
  request,
}) => {
  const cafe = await createCafe(request);
  await page.goto(cafe.url);
  await expect(page.locator(".cafe-meta")).toContainText("مرکزی");
  await expect(page).toHaveURL(new RegExp(`/${cafe.slug}/main$`));
  // One branch: no branch picker for the customer.
  await expect(page.locator("#customerBranchRow")).toBeHidden();
});

test("an unknown café's link answers 404 and shows the page without any café", async ({
  browser,
  baseURL,
}) => {
  // Chrome logs the 404 of the page itself; that is the only message expected here.
  const context = await browser.newContext({ baseURL }),
    page = await context.newPage(),
    problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 404/.test(message.text()))
      problems.push(message.text());
  });
  const response = await page.goto("/no-such-cafe-here/main");
  expect(response?.status()).toBe(404);
  await expect(page.locator("#continueBtn")).toBeAttached();
  await expect(page.locator("body")).not.toHaveAttribute("data-mode", "cafe");
  expect(problems).toEqual([]);
  await context.close();
});
