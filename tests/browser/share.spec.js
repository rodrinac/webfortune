import { showFortuneOptions, test, expect } from "./fixtures.js";

const FORTUNE = "A <wise> cow & pasture.";
const LABELS = [
  ["en", "Share", "Not shared"],
  ["de", "Teilen", "Nicht geteilt"],
  ["es", "Compartir", "No compartido"],
  ["pt", "Partilhar", "Não partilhado"],
];

async function mockApi(page) {
  const pending = [];
  let gate = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("locales"))
      return route.fulfill({
        json: [
          { id: "en", name: "English" },
          { id: "de", name: "Deutsch" },
          { id: "es", name: "Español" },
          { id: "pt", name: "Português" },
        ],
      });
    if (path.endsWith("categories"))
      return route.fulfill({ json: ["wisdom"] });
    if (path.endsWith("/cows"))
      return route.fulfill({ json: ["default"] });
    if (gate) await new Promise((resolve) => pending.push(resolve));
    const daily = url.searchParams.get("daily") === "true";
    return route.fulfill({
      contentType: "text/plain; charset=utf-8",
      headers: {
        "x-fortune-id": daily ? "wisdom-0" : "computers-42",
        "access-control-expose-headers": "x-fortune-id",
      },
      body: daily ? "Daily fortune." : FORTUNE,
    });
  });
  return {
    hold() {
      gate = true;
    },
    release() {
      gate = false;
      while (pending.length) pending.shift()();
    },
  };
}

async function installShare(page) {
  await page.addInitScript(() => {
    window.__shares = [];
    window.__shareResult = "shared";
    window.__events = [];
    window.__copiedText = "";
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: async (data) => {
        window.__shares.push({
          title: data?.title,
          text: data?.text,
          url: data?.url,
        });
        if (window.__shareResult === "abort")
          throw new DOMException("The operation was aborted.", "AbortError");
        if (window.__shareResult === "fail") throw new Error("Share failed");
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copiedText = text;
        },
      },
    });
  });
}

async function grantAnalytics(page) {
  await page.evaluate(() => {
    localStorage.setItem("webfortune-analytics", "granted");
    window.__events = [];
    window.gtag = (kind, name, params) => {
      window.__events.push({ kind, name, params });
    };
  });
}

async function labelsFit(page) {
  return page.locator(".actions").evaluate((actions) => {
    const actionsBox = actions.getBoundingClientRect();
    return [...actions.querySelectorAll("button:not([hidden])")].every((button) => {
      const label = button.querySelector("[id$='-label']");
      const labelBox = label.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      return (
        labelBox.width > 1 &&
        labelBox.left >= buttonBox.left - 0.5 &&
        labelBox.right <= buttonBox.right + 0.5 &&
        buttonBox.left >= actionsBox.left - 0.5 &&
        buttonBox.right <= actionsBox.right + 0.5
      );
    });
  });
}

test("shares the fortune text and permalink", async ({ page }) => {
  const api = await mockApi(page);
  api.hold();
  await installShare(page);
  await page.goto("/");

  const share = page.locator("#share");
  // The startup loader hides the page, so the control is present and disabled
  // the same way Copy is, before it can be seen.
  await expect(share).toBeDisabled();
  await expect(page.locator("#copy")).toBeDisabled();
  await expect(share).not.toHaveAttribute("hidden");
  await expect(share).toHaveAttribute("data-slot", "button");
  await expect(share).toHaveAttribute("data-variant", "outline");
  await expect(share.locator("svg.lucide-share")).toHaveCount(1);

  api.release();
  await expect(page.locator("#fortune-text")).toHaveText(FORTUNE);
  await expect(share).toBeVisible();
  await expect(page.locator("#cow img")).toHaveCount(0);
  await expect(share).toBeEnabled();
  await expect(page.locator(".actions button:visible")).toHaveCount(4);

  await share.click();
  await expect.poll(() => page.evaluate(() => window.__shares.length)).toBe(1);
  const shared = await page.evaluate(() => window.__shares[0]);
  expect(shared).toEqual({
    title: "webfortune",
    text: FORTUNE,
    url: "http://127.0.0.1:5173/?fortune=computers-42",
  });

  await page.evaluate(() => {
    window.__events = [];
    window.gtag = (kind, name, params) => {
      window.__events.push({ kind, name, params });
    };
  });
  await share.click();
  expect(await page.evaluate(() => window.__events)).toEqual([]);

  await grantAnalytics(page);
  await share.click();
  await expect.poll(() => page.evaluate(() => window.__events.length)).toBe(1);
  const event = await page.evaluate(() => window.__events[0]);
  expect(event).toEqual({
    kind: "event",
    name: "share_fortune",
    params: {
      locale: "en",
      category: "everything",
      cow: "default",
      result: "shared",
      page_location: "http://127.0.0.1:5173/",
    },
  });
  expect(JSON.stringify(event)).not.toContain(FORTUNE);

  const copyBox = await page.locator("#copy").boundingBox();
  const shareBox = await share.boundingBox();
  const screenshotBox = await page.locator("#screenshot").boundingBox();
  expect(shareBox.x).toBeGreaterThan(copyBox.x);
  expect(Math.abs(shareBox.y - copyBox.y)).toBeLessThan(2);
  const isMobile = test.info().project.name.startsWith("mobile-");
  if (isMobile) expect(screenshotBox.y).toBeGreaterThan(copyBox.y + copyBox.height / 2);
  else expect(Math.abs(screenshotBox.y - copyBox.y)).toBeLessThan(2);
  expect(await labelsFit(page)).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  if (["mobile-regular", "desktop-full-hd"].includes(test.info().project.name)) {
    await page.screenshot({
      path: `test-results/share-${test.info().project.name}.png`,
      fullPage: true,
    });
  }

  await showFortuneOptions(page);
  for (const [id, label] of LABELS) {
    await page.selectOption("#locale", id);
    await expect(share).toBeEnabled();
    await expect(page.locator("#share-label")).toHaveText(label);
    await expect(share).toHaveAttribute("aria-label", label);
    await expect(share).toHaveAttribute("title", label);
    expect(await labelsFit(page)).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  }
});

test("hides the share button when the browser cannot share", async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(FORTUNE);
  await expect(page.locator("#share")).toBeHidden();
  await expect(page.locator("#share")).toHaveAttribute("hidden", "");
  await expect(page.getByRole("button", { name: "Share" })).toHaveCount(0);
  await expect(page.locator(".actions button:visible")).toHaveCount(3);

  const copyBox = await page.locator("#copy").boundingBox();
  const screenshotBox = await page.locator("#screenshot").boundingBox();
  expect(screenshotBox.y).toBeLessThan(copyBox.y + copyBox.height);
  expect(copyBox.y).toBeLessThan(screenshotBox.y + screenshotBox.height);
  expect(screenshotBox.x).toBeGreaterThan(copyBox.x);
});

test("a cancelled share sheet shows no error", async ({ page }) => {
  await mockApi(page);
  await installShare(page);
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(FORTUNE);
  await grantAnalytics(page);
  await page.evaluate(() => {
    window.__shareResult = "abort";
  });
  await page.locator("#share").click();
  await expect
    .poll(() => page.evaluate(() => window.__events.at(-1)?.params?.result))
    .toBe("cancelled");
  await expect(page.locator("#share-label")).toHaveText("Share");
  await expect(page.locator("#error")).toBeHidden();
  const event = await page.evaluate(() => window.__events.at(-1));
  expect(event.name).toBe("share_fortune");
  expect(JSON.stringify(event)).not.toContain(FORTUNE);
  expect(await page.evaluate(() => window.__shares[0].text)).toBe(FORTUNE);
});

test("a failed share shows a failure label and then restores it", async ({ page }) => {
  await mockApi(page);
  await installShare(page);
  await page.goto("/");
  await expect(page.locator("#share")).toBeEnabled();
  await grantAnalytics(page);
  await page.evaluate(() => {
    window.__shareResult = "fail";
  });
  await page.locator("#share").click();
  await expect(page.locator("#share-label")).toHaveText("Not shared");
  await expect(page.locator("#error")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__events.at(-1)?.params?.result))
    .toBe("failed");
  expect(JSON.stringify(await page.evaluate(() => window.__events.at(-1)))).not.toContain(
    FORTUNE,
  );
  await expect(page.locator("#share-label")).toHaveText("Share");

  await showFortuneOptions(page);
  for (const [id, , failed] of LABELS.slice(1)) {
    await page.selectOption("#locale", id);
    await expect(page.locator("#share")).toBeEnabled();
    await page.locator("#share").click();
    await expect(page.locator("#share-label")).toHaveText(failed);
    await expect(page.locator("#error")).toBeHidden();
  }
});

test("fortune of the day shares the same daily link as copy", async ({ page }) => {
  await mockApi(page);
  await installShare(page);
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(FORTUNE);
  await showFortuneOptions(page);
  await page.getByRole("switch", { name: "Fortune of the day" }).click();
  await page.selectOption("#category", "wisdom");
  await page.selectOption("#length", "short");
  await expect(page.locator("#fortune-text")).toHaveText("Daily fortune.");
  await expect(page.locator("#share")).toBeEnabled();

  await page.locator("#share").click();
  await expect.poll(() => page.evaluate(() => window.__shares.length)).toBe(1);
  const shared = await page.evaluate(() => window.__shares[0]);
  expect(shared).toEqual({
    title: "webfortune",
    text: "Daily fortune.",
    url: "http://127.0.0.1:5173/?category=wisdom&length=short&daily=true",
  });
  expect(shared.url).not.toContain("fortune=");

  await page.locator("#copy").click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedText))
    .toBe(`Daily fortune.\n\n${shared.url}`);
});
