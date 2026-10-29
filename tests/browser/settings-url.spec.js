import { test, expect } from "@playwright/test";

async function mockApi(page) {
  const fortuneRequests = [];
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
      return route.fulfill({ json: ["love", "wisdom"] });
    if (path.endsWith("/cows"))
      return route.fulfill({ json: ["default", "tux"] });
    if (path.endsWith("/cows/tux"))
      return route.fulfill({ contentType: "text/plain", body: "   \\ tux" });
    if (path.endsWith("/cows/default"))
      return route.fulfill({
        contentType: "text/plain",
        body: "        \\   ^__^\n         \\  (oo)\\_______\n",
      });
    if (/\/cows\/[^/]+$/.test(path))
      return route.fulfill({ status: 404, body: "Cow not found.\n" });
    fortuneRequests.push(url.search);
    const category = url.searchParams.get("category");
    const locale = url.searchParams.get("locale");
    const body =
      locale === "pt" && category === "love"
        ? "O amor da vaca é paciente."
        : category
          ? `Fortune about ${category}.`
          : "A general fortune.";
    return route.fulfill({ contentType: "text/plain", body });
  });
  return fortuneRequests;
}

async function installClipboard(page) {
  await page.addInitScript(() => {
    window.__copiedText = "";
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

test("opens from a settings link and keeps the query in sync", async ({
  page,
}) => {
  const fortuneRequests = await mockApi(page);
  await installClipboard(page);
  await page.goto("/?locale=pt&cow=tux&category=love");

  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("#cow-style")).toHaveValue("tux");
  await expect(page.locator("#category")).toHaveValue("love");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(page).toHaveTitle("webfortune — sabedoria com muu");
  await expect(page.locator("#fortune-text")).toHaveText(
    "O amor da vaca é paciente.",
  );
  await expect(page.locator("#cow")).toContainText("tux");
  await expect(page.locator("#cow img, #cow svg, #cow script")).toHaveCount(0);
  expect(fortuneRequests[0]).toBe("?locale=pt&category=love");
  expect(new URL(page.url()).search).toBe("?locale=pt&cow=tux&category=love");

  await page.reload();
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("#cow-style")).toHaveValue("tux");
  await expect(page.locator("#category")).toHaveValue("love");
  await expect(page.locator("#fortune-text")).toHaveText(
    "O amor da vaca é paciente.",
  );

  const historyLength = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    window.__session = "still-here";
  });
  await page.selectOption("#category", "wisdom");
  await expect
    .poll(() => page.evaluate(() => location.search))
    .toBe("?locale=pt&cow=tux&category=wisdom");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(await page.evaluate(() => window.__session)).toBe("still-here");
  await expect(page.locator("#fortune-text")).toHaveText(
    "Fortune about wisdom.",
  );

  await page.selectOption("#cow-style", "default");
  await expect
    .poll(() => page.evaluate(() => location.search))
    .toBe("?locale=pt&category=wisdom");
  await expect(page.locator("#cow")).toContainText("(oo)");

  await page.locator("#copy").click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedText))
    .toBe(
      "Fortune about wisdom.\n\nhttp://127.0.0.1:5173/?locale=pt&category=wisdom",
    );

  await page.selectOption("#category", "");
  await expect
    .poll(() => page.evaluate(() => location.search))
    .toBe("?locale=pt");
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");

  // Switching language reloads categories and returns to "everything",
  // so a category that no longer applies leaves the URL with the locale.
  await page.selectOption("#locale", "en");
  await expect(page.locator("#category")).toHaveValue("");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect.poll(() => page.evaluate(() => location.search)).toBe("");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
});

test("drops unknown, malformed, and unavailable settings", async ({ page }) => {
  const fortuneRequests = await mockApi(page);
  await page.goto(
    "/?locale=%3Csvg%2Fonload%3Dalert(1)%3E&cow=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&category=..%2F..%2Fetc",
  );

  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");
  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.locator("#cow-style")).toHaveValue("default");
  await expect(page.locator("#category")).toHaveValue("");
  await expect(page.locator("#cow img, #cow script")).toHaveCount(0);
  expect(await page.content()).not.toContain("onerror");
  expect(await page.content()).not.toContain("onload");
  expect(new URL(page.url()).search).toBe("");
  expect(fortuneRequests[0]).toBe("?locale=en");
  await expect(page.locator("#cow-style option")).toHaveText(["default", "tux"]);

  await page.goto("/?locale=pt&locale=en&cow=moose&category=not-a-thing");
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");
  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.locator("#cow-style")).toHaveValue("default");
  await expect(page.locator("#category")).toHaveValue("");
  expect(new URL(page.url()).search).toBe("");

  await page.goto("/?locale=en&cow=default&category=");
  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.locator("#cow-style")).toHaveValue("default");
  expect(new URL(page.url()).search).toBe("");

  await page.goto("/?locale=pt&cow=tux&category=not-a-thing");
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("#cow-style")).toHaveValue("tux");
  await expect(page.locator("#category")).toHaveValue("");
  await expect(page.locator("#cow")).toContainText("tux");
  expect(new URL(page.url()).search).toBe("?locale=pt&cow=tux");
  expect(fortuneRequests.at(-1)).toBe("?locale=pt");
});

test("uses the browser language when locale is missing or unknown", async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: "pt-BR",
    baseURL: "http://127.0.0.1:5173",
  });
  const page = await context.newPage();
  const fortuneRequests = await mockApi(page);

  await page.goto("/?locale=zz&cow=nope");
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(page.locator("#cow-style")).toHaveValue("default");
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");
  expect(new URL(page.url()).search).toBe("");
  expect(fortuneRequests[0]).toBe("?locale=pt");

  await page.goto("/?locale=en");
  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(new URL(page.url()).search).toBe("?locale=en");

  const historyLength = await page.evaluate(() => history.length);
  await page.selectOption("#locale", "pt");
  await expect.poll(() => page.evaluate(() => location.search)).toBe("");
  await expect(page.locator("#locale")).toHaveValue("pt");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);

  await page.selectOption("#cow-style", "tux");
  await expect
    .poll(() => page.evaluate(() => location.search))
    .toBe("?cow=tux");
  await context.close();
});
