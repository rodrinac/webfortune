import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("loads a fortune, selects categories, and stays within the viewport", async ({
  page,
}) => {
  const requests = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    if (url.pathname.endsWith("locales"))
      return route.fulfill({
        json: [
          { id: "en", name: "English" },
          { id: "de", name: "Deutsch" },
          { id: "es", name: "Español" },
          { id: "pt", name: "Português" },
        ],
      });
    if (url.pathname.endsWith("categories"))
      return route.fulfill({ json: ["wisdom", "computers"] });
    return route.fulfill({
      contentType: "text/plain",
      body: url.searchParams.has("category")
        ? "A computer is a very patient cow."
        : "The secret of getting ahead is getting started.",
    });
  });
  await page.addInitScript(() => {
    window.__copiedText = "";
    window.__copiedScreenshotType = "";
    window.__copiedScreenshotBlob = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copiedText = text;
        },
        write: async ([item]) => {
          window.__copiedScreenshotType = item.types[0];
          window.__copiedScreenshotBlob = item.data[item.types[0]];
        },
      },
    });
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: class {
        constructor(data) {
          this.types = Object.keys(data);
          this.data = data;
        }
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("#cow")).toContainText("(oo)");
  await expect(page.locator("#fortune-text")).toHaveText(
    "The secret of getting ahead is getting started.",
  );
  await page.selectOption("#category", "computers");
  await expect(page.locator("#fortune-text")).toContainText("A computer");
  expect(requests).toContain("?locale=en&category=computers");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedText))
    .toContain("A computer is a very patient cow.");
  await expect
    .poll(() => page.evaluate(() => window.__copiedText))
    .toContain("http://127.0.0.1:5173/");
  const downloadPromise = page
    .waitForEvent("download", { timeout: 500 })
    .catch(() => null);
  await page.getByRole("button", { name: "Copy screenshot" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedScreenshotType))
    .toBe("image/png");
  const screenshotSize = await page.evaluate(async () => {
    const image = await createImageBitmap(window.__copiedScreenshotBlob);
    return [image.width, image.height];
  });
  expect(screenshotSize[0]).toBe(screenshotSize[1]);
  expect(screenshotSize[0]).toBeGreaterThanOrEqual(900);
  if (test.info().project.name === "mobile") {
    const screenshotBytes = await page.evaluate(async () =>
      Array.from(
        new Uint8Array(await window.__copiedScreenshotBlob.arrayBuffer()),
      ),
    );
    await writeFile(
      "test-results/generated-share.png",
      Buffer.from(screenshotBytes),
    );
  }
  expect(await downloadPromise).toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (test.info().project.name === "mobile") {
    const localeBox = await page.locator(".locale-field").boundingBox();
    const categoryBox = await page.locator(".category-field").boundingBox();
    const refreshBox = await page.locator("#refresh").boundingBox();
    const refreshLabelBox = await page.locator("#refresh-label").boundingBox();
    const refreshStyle = await page
      .locator("#refresh-label")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return { fontFamily: style.fontFamily, fontSize: style.fontSize };
      });
    expect(localeBox.y).toBe(categoryBox.y);
    expect(localeBox.x + localeBox.width).toBeLessThanOrEqual(categoryBox.x);
    expect(refreshLabelBox.height).toBeLessThan(refreshBox.height / 2);
    expect(refreshStyle.fontFamily).toContain("DM Sans");
    expect(refreshStyle.fontSize).toBe("12px");
  }
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
    if (new URL(route.request().url()).pathname.endsWith("locales"))
      return route.fulfill({ json: [{ id: "en", name: "English" }] });
    if (new URL(route.request().url()).pathname.endsWith("categories"))
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
    new URL(route.request().url()).pathname.endsWith("locales")
      ? route.fulfill({ json: [{ id: "en", name: "English" }] })
      : new URL(route.request().url()).pathname.endsWith("categories")
        ? route.fulfill({ json: [] })
        : route.fulfill({ body: "<img src=x onerror=alert(1)>" }),
  );
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#cow img")).toHaveCount(0);
});
