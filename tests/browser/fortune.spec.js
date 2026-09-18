import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("loads a fortune, selects categories, and stays within the viewport", async ({
  page,
}) => {
  const isDesktop = test.info().project.name.startsWith("desktop-");
  const isMobile = test.info().project.name.startsWith("mobile-");
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
    if (url.pathname.endsWith("/cows"))
      return route.fulfill({ json: ["default", "dragon"] });
    if (url.pathname.endsWith("/cows/dragon"))
      return route.fulfill({
        contentType: "text/plain",
        body: "  \\\n   \\ dragon",
      });
    return route.fulfill({
      contentType: "text/plain",
      body: url.searchParams.has("category")
        ? "A computer is a very patient cow."
        : "The secret of getting ahead is getting started.\nKeep moving forward.",
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
    "The secret of getting ahead is getting started.\nKeep moving forward.",
  );
  if (isDesktop)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
  await page.selectOption("#category", "computers");
  await expect(page.locator("#fortune-text")).toContainText("A computer");
  expect(requests).toContain("?locale=en&category=computers");
  await page.selectOption("#cow-style", "dragon");
  await expect(page.locator("#cow")).toContainText("dragon");
  await expect(page.locator("#command")).toContainText("cowsay -f dragon");
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
  const screenshotGeometry = await page.evaluate(async () => {
    const image = await createImageBitmap(window.__copiedScreenshotBlob);
    const terminal = document.querySelector("#terminal").getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2) * 2;
    return {
      imageWidth: image.width,
      imageHeight: image.height,
      scale,
      terminalAspectRatio: terminal.width / terminal.height,
    };
  });
  expect(screenshotGeometry.imageWidth).toBeGreaterThanOrEqual(2160);
  const exportedFrameWidth = screenshotGeometry.imageWidth / screenshotGeometry.scale - 48;
  const exportedFrameHeight = screenshotGeometry.imageHeight / screenshotGeometry.scale - 48;
  expect(exportedFrameWidth / exportedFrameHeight).toBeCloseTo(
    screenshotGeometry.terminalAspectRatio,
    2,
  );
  if (test.info().project.name === "mobile-regular") {
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
  expect(
    await page.locator(".select-wrap").evaluateAll((wrappers) =>
      wrappers.every((wrapper) => {
        const indicator = wrapper.querySelector('[data-slot="select-icon"]');
        const select = wrapper.querySelector("select");
        const indicatorBounds = indicator.getBoundingClientRect();
        const selectBounds = select.getBoundingClientRect();
        return (
          indicatorBounds.left >= selectBounds.left &&
          indicatorBounds.right <= selectBounds.right &&
          indicatorBounds.top >= selectBounds.top &&
          indicatorBounds.bottom <= selectBounds.bottom
        );
      }),
    ),
  ).toBe(true);
  if (isMobile) {
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
    expect(
      await page.locator(".locale-field .select-wrap > span").evaluate((arrow) => {
        const arrowBounds = arrow.getBoundingClientRect();
        const selectBounds = arrow.parentElement.querySelector("select").getBoundingClientRect();
        return (
          arrowBounds.left >= selectBounds.left &&
          arrowBounds.right <= selectBounds.right &&
          arrowBounds.top >= selectBounds.top &&
          arrowBounds.bottom <= selectBounds.bottom
        );
      }),
    ).toBe(true);
    expect(refreshLabelBox.height).toBeLessThan(refreshBox.height / 2);
    expect(refreshStyle.fontFamily).toContain("DM Sans");
    expect(refreshStyle.fontSize).toBe("12px");
    const actionSpacing = await page.locator(".actions").evaluate((actions) => {
      const style = getComputedStyle(actions);
      return {
        gap: style.gap,
        buttons: [...actions.querySelectorAll("button")].map((button) => {
          const buttonStyle = getComputedStyle(button);
          return {
            height: buttonStyle.height,
            padding: buttonStyle.padding,
          };
        }),
      };
    });
    expect(actionSpacing.gap).toBe("12px");
    expect(actionSpacing.buttons).toEqual([
      { height: "52px", padding: "8px 10px" },
      { height: "52px", padding: "8px 10px" },
      { height: "52px", padding: "8px 10px" },
    ]);
    const mobileActionLabels = await page.locator(".actions").evaluate((actions) => {
      const labelGeometry = (selector) => {
        const bounds = actions.querySelector(selector).getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      };
      return {
        controlsWidth: actions.closest(".controls").clientWidth,
        copy: labelGeometry("#copy-label"),
        screenshot: labelGeometry("#screenshot-label"),
        refresh: labelGeometry("#refresh-label"),
      };
    });
    expect(mobileActionLabels.copy.width).toBeGreaterThan(1);
    expect(mobileActionLabels.screenshot.width).toBeGreaterThan(1);
    if (mobileActionLabels.controlsWidth <= 420) {
      expect(mobileActionLabels.refresh).toEqual({ width: 1, height: 1 });
    } else {
      expect(mobileActionLabels.refresh.width).toBeGreaterThan(1);
    }
  }
  if (isDesktop) {
    const terminalBox = await page.locator("#terminal").boundingBox();
    const controlsBox = await page.locator(".controls").boundingBox();
    const cowLabelBox = await page.locator("#cow-label").boundingBox();
    const cowSelectBox = await page.locator("#cow-style").boundingBox();
    expect(controlsBox.x).toBeGreaterThanOrEqual(terminalBox.x);
    expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(
      terminalBox.x + terminalBox.width,
    );
    expect(
      Math.abs(
        cowLabelBox.y + cowLabelBox.height / 2 -
          (cowSelectBox.y + cowSelectBox.height / 2),
      ),
    ).toBeLessThanOrEqual(1);
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
    if (new URL(route.request().url()).pathname.endsWith("/cows"))
      return route.fulfill({ json: ["default"] });
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
        : new URL(route.request().url()).pathname.endsWith("/cows")
          ? route.fulfill({ json: ["default"] })
        : route.fulfill({ body: "<img src=x onerror=alert(1)>" }),
  );
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("#cow img")).toHaveCount(0);
});

test("long fortunes cannot widen the mobile layout", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("locales"))
      return route.fulfill({ json: [{ id: "en", name: "English" }] });
    if (path.endsWith("categories")) return route.fulfill({ json: [] });
    if (path.endsWith("/cows"))
      return route.fulfill({ json: ["default"] });
    return route.fulfill({
      body: "Show me no patterns and I'll tell you no lines, boundaries, or impossibly wide pastures.",
    });
  });
  await page.goto("/");
  await expect(page.locator("#cow")).toContainText("(oo)");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const terminal = await page.locator("#terminal").boundingBox();
  expect(terminal.x).toBeGreaterThanOrEqual(0);
  expect(terminal.x + terminal.width).toBeLessThanOrEqual(
    page.viewportSize().width,
  );
});

test("terminal URL title gives way to controls on narrow mobile screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("locales"))
      return route.fulfill({ json: [{ id: "en", name: "English" }] });
    if (path.endsWith("categories")) return route.fulfill({ json: [] });
    if (path.endsWith("/cows"))
      return route.fulfill({ json: ["default", "dragon"] });
    return route.fulfill({ body: "Small screens still deserve wisdom." });
  });
  await page.goto("/");

  const layout = await page.locator(".terminal-bar").evaluate((bar) => {
    const title = bar.querySelector(".terminal-title");
    const dots = bar.querySelector(".window-dots");
    const cowField = bar.querySelector(".cow-field");
    const titleBounds = title.getBoundingClientRect();
    const dotsBounds = dots.getBoundingClientRect();
    const cowBounds = cowField.getBoundingClientRect();
    return {
      titleIsClipped: title.clientWidth < title.scrollWidth,
      titleStartsAfterDots: titleBounds.left >= dotsBounds.right,
      titleEndsBeforeCowControl: titleBounds.right <= cowBounds.left,
      cowControlIsIntact: cowField.clientWidth >= 104,
      overflow: getComputedStyle(title).overflow,
    };
  });

  expect(layout).toEqual({
    titleIsClipped: true,
    titleStartsAfterDots: true,
    titleEndsBeforeCowControl: true,
    cowControlIsIntact: true,
    overflow: "hidden",
  });
});

test("action labels progressively yield space to dropdowns", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("locales"))
      return route.fulfill({ json: [{ id: "en", name: "English" }] });
    if (path.endsWith("categories"))
      return route.fulfill({ json: ["wisdom"] });
    if (path.endsWith("/cows")) return route.fulfill({ json: ["default"] });
    return route.fulfill({ body: "Responsive controls share their pasture." });
  });
  await page.goto("/");

  const buttonWidths = async () => ({
    copy: (await page.locator("#copy").boundingBox()).width,
    screenshot: (await page.locator("#screenshot").boundingBox()).width,
    refresh: (await page.locator("#refresh").boundingBox()).width,
  });

  await page.setViewportSize({ width: 900, height: 900 });
  const fullLabels = await buttonWidths();
  expect(fullLabels.copy).toBeGreaterThan(44);
  expect(fullLabels.screenshot).toBeGreaterThan(44);
  expect(fullLabels.refresh).toBeGreaterThan(44);

  await page.setViewportSize({ width: 820, height: 900 });
  const screenshotHidden = await buttonWidths();
  expect(screenshotHidden.copy).toBeGreaterThan(44);
  expect(screenshotHidden.screenshot).toBe(44);
  expect(screenshotHidden.refresh).toBeGreaterThan(44);

  await page.setViewportSize({ width: 740, height: 900 });
  const copyHidden = await buttonWidths();
  expect(copyHidden.copy).toBe(44);
  expect(copyHidden.screenshot).toBe(44);
  expect(copyHidden.refresh).toBeGreaterThan(44);

  await page.setViewportSize({ width: 700, height: 900 });
  const allHidden = await buttonWidths();
  expect(allHidden).toEqual({ copy: 44, screenshot: 44, refresh: 44 });
  await expect(page.getByRole("button", { name: "Another fortune" })).toBeVisible();

  for (const width of [482, 470]) {
    await page.setViewportSize({ width, height: 900 });
    const mobileActions = await page.locator(".actions").evaluate((actions) => {
      const bounds = actions.getBoundingClientRect();
      const copyLabel = actions.querySelector("#copy-label").getBoundingClientRect();
      const screenshotLabel = actions
        .querySelector("#screenshot-label")
        .getBoundingClientRect();
      const refreshLabel = actions
        .querySelector("#refresh-label")
        .getBoundingClientRect();
      return {
        labelsVisible: copyLabel.width > 1 && screenshotLabel.width > 1,
        refreshLabelHidden: refreshLabel.width === 1,
        childrenFit: [...actions.children].every((button) => {
          const buttonBounds = button.getBoundingClientRect();
          return buttonBounds.left >= bounds.left && buttonBounds.right <= bounds.right;
        }),
        screenshotTextFits:
          screenshotLabel.left >=
            actions.querySelector("#screenshot").getBoundingClientRect().left &&
          screenshotLabel.right <=
            actions.querySelector("#screenshot").getBoundingClientRect().right,
      };
    });
    expect(mobileActions).toEqual({
      labelsVisible: true,
      refreshLabelHidden: true,
      childrenFit: true,
      screenshotTextFits: true,
    });
  }
});

test("loading gate covers only startup and language changes localize SEO", async ({
  page,
}) => {
  const pendingFortunes = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("locales"))
      return route.fulfill({
        json: [
          { id: "en", name: "English" },
          { id: "pt", name: "Português" },
        ],
      });
    if (url.pathname.endsWith("categories"))
      return route.fulfill({ json: [] });
    if (url.pathname.endsWith("/cows"))
      return route.fulfill({ json: ["default"] });
    await new Promise((resolve) => pendingFortunes.push(resolve));
    return route.fulfill({
      contentType: "text/plain; charset=utf-8",
      body: url.searchParams.get("locale") === "pt"
        ? "À vaca sábia vê além e não perde a fé."
        : "A wise cow waits for the page to settle.",
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => pendingFortunes.length).toBe(1);
  await expect(page.locator("#app-loader")).toBeVisible();
  pendingFortunes.shift()();
  await expect(page.locator("#app-loader")).toBeHidden();
  await expect(page.locator("#page")).toHaveAttribute("aria-hidden", "false");

  await page.selectOption("#locale", "pt");
  await expect.poll(() => pendingFortunes.length).toBe(1);
  await expect(page.locator("#app-loader")).toBeHidden();
  await expect(page.locator("#page")).toHaveAttribute("aria-hidden", "false");
  pendingFortunes.shift()();
  await expect(page.locator("#fortune-text")).toContainText("À vaca sábia");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(page).toHaveTitle("webfortune — sabedoria com muu");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /vaca muito sábia/,
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "pt_BR",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    "webfortune — sabedoria com muu",
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    "https://webfortune.app/",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://webfortune.app/",
  );
  await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute(
    "content",
    /terminal Catppuccin aconchegante/,
  );
  await expect(page.locator("#cow")).toContainText("À vaca sábia vê além");
});
