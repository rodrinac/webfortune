import { test, expect } from "@playwright/test";

test("loads a fortune, selects categories, and stays within the viewport", async ({
  page,
}) => {
  const requests = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    if (url.pathname.endsWith("categories"))
      return route.fulfill({ json: ["wisdom", "computers"] });
    return route.fulfill({
      contentType: "text/plain",
      body: url.search
        ? "A computer is a very patient cow."
        : "The secret of getting ahead is getting started.",
    });
  });
  await page.goto("/");
  await expect(page.locator("#cow")).toContainText("(oo)");
  await expect(page.locator("#fortune-text")).toHaveText(
    "The secret of getting ahead is getting started.",
  );
  await page.selectOption("#category", "computers");
  await expect(page.locator("#fortune-text")).toContainText("A computer");
  expect(requests).toContain("?category=computers");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Screenshot" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^webfortune-\d{4}-\d{2}-\d{2}\.png$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (test.info().project.name === "desktop") {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: `test-results/${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("failure preserves the last fortune and retry recovers", async ({
  page,
}) => {
  let failure = false;
  await page.route("**/api/**", (route) => {
    if (route.request().url().endsWith("categories"))
      return route.fulfill({ json: ["wisdom"] });
    return route.fulfill({
      status: failure ? 503 : 200,
      body: "Keep going, little cow.",
    });
  });
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(
    "Keep going, little cow.",
  );
  failure = true;
  await page.getByRole("button", { name: "Another fortune" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#fortune-text")).toHaveText(
    "Keep going, little cow.",
  );
  failure = false;
  await page.getByRole("button", { name: "Another fortune" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
});

test("API text is never interpreted as HTML", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.request().url().endsWith("categories")
      ? route.fulfill({ json: [] })
      : route.fulfill({ body: "<img src=x onerror=alert(1)>" }),
  );
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#cow img")).toHaveCount(0);
});
