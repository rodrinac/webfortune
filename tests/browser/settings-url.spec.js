import { test, expect } from "./fixtures.js";

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
    const length = url.searchParams.get("length");
    const body =
      locale === "pt" && category === "love"
        ? "O amor da vaca é paciente."
        : length === "short"
          ? "Short fortune."
          : length === "long"
            ? "A long fortune from the far side of the pasture."
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

test("length picker filters fortunes and restores from the URL", async ({
  page,
}) => {
  const fortuneRequests = await mockApi(page);
  await page.goto("/");

  await expect(page.locator("#length")).toBeEnabled();
  await expect(page.locator("#length")).toHaveValue("");
  await expect(page.locator("#length-label")).toHaveText("Length");
  await expect(page.locator("#length option")).toHaveText(["Any", "Short", "Long"]);
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");
  await expect(page.locator("#command")).toHaveText("fortune | cowsay");
  expect(fortuneRequests[0]).toBe("?locale=en");
  expect(new URL(page.url()).search).toBe("");

  const historyLength = await page.evaluate(() => history.length);
  await page.selectOption("#length", "short");
  await expect(page.locator("#fortune-text")).toHaveText("Short fortune.");
  await expect(page.locator("#command")).toHaveText("fortune -s | cowsay");
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?length=short",
  );
  expect(fortuneRequests.at(-1)).toBe("?locale=en&length=short");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);

  await page.reload();
  await expect(page.locator("#length")).toHaveValue("short");
  await expect(page.locator("#fortune-text")).toHaveText("Short fortune.");
  expect(fortuneRequests.at(-1)).toBe("?locale=en&length=short");
  expect(new URL(page.url()).search).toBe("?length=short");

  await page.selectOption("#category", "wisdom");
  await expect.poll(() => fortuneRequests.at(-1)).toBe(
    "?locale=en&category=wisdom&length=short",
  );
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?category=wisdom&length=short",
  );
  await expect(page.locator("#fortune-text")).toHaveText("Short fortune.");

  await page.selectOption("#length", "long");
  await expect(page.locator("#fortune-text")).toHaveText(
    "A long fortune from the far side of the pasture.",
  );
  await expect(page.locator("#command")).toHaveText("fortune -l wisdom | cowsay");
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?category=wisdom&length=long",
  );
  expect(fortuneRequests.at(-1)).toBe("?locale=en&category=wisdom&length=long");

  await page.selectOption("#length", "");
  await expect(page.locator("#fortune-text")).toHaveText("Fortune about wisdom.");
  await expect(page.locator("#command")).toHaveText("fortune wisdom | cowsay");
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?category=wisdom",
  );
  expect(fortuneRequests.at(-1)).toBe("?locale=en&category=wisdom");

  const labels = {
    de: ["Länge", ["Beliebig", "Kurz", "Lang"]],
    es: ["Longitud", ["Cualquiera", "Corta", "Larga"]],
    pt: ["Tamanho", ["Qualquer", "Curta", "Longa"]],
  };
  for (const [locale, [label, options]] of Object.entries(labels)) {
    await page.goto(`/?locale=${locale}&length=short`);
    await expect(page.locator("#length")).toHaveValue("short");
    await expect(page.locator("#length-label")).toHaveText(label);
    await expect(page.locator("#length option")).toHaveText(options);
    await expect(page.locator("#fortune-text")).toHaveText("Short fortune.");
    expect(new URL(page.url()).search).toBe(`?locale=${locale}&length=short`);
    expect(fortuneRequests.at(-1)).toBe(`?locale=${locale}&length=short`);
  }

  await page.goto("/?length=medium");
  await expect(page.locator("#length")).toHaveValue("");
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");
  expect(new URL(page.url()).search).toBe("");
  expect(fortuneRequests.at(-1)).toBe("?locale=en");

  await page.goto("/?length=SHORT");
  await expect(page.locator("#length")).toHaveValue("");
  expect(new URL(page.url()).search).toBe("");

  await page.goto("/?length=short&length=long");
  await expect(page.locator("#length")).toHaveValue("");
  expect(new URL(page.url()).search).toBe("");
  expect(fortuneRequests.at(-1)).toBe("?locale=en");

  await page.goto("/?length=long&length=long");
  await expect(page.locator("#length")).toHaveValue("");
  expect(fortuneRequests.at(-1)).not.toContain("length=");

  await page.goto("/?locale=pt&cow=tux&category=love&length=nope");
  await expect(page.locator("#length")).toHaveValue("");
  await expect(page.locator("#category")).toHaveValue("love");
  expect(new URL(page.url()).search).toBe("?locale=pt&cow=tux&category=love");
  expect(fortuneRequests.at(-1)).toBe("?locale=pt&category=love");
});

test("disables the length picker while a fortune is loading", async ({
  page,
}) => {
  await mockApi(page);
  let fortuneLoads = 0;
  const pending = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const isFortune =
      !path.endsWith("locales") &&
      !path.endsWith("categories") &&
      !path.includes("/cows");
    if (isFortune && ++fortuneLoads > 1)
      await new Promise((resolve) => pending.push(resolve));
    await route.fallback();
  });

  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");
  await expect(page.locator("#length")).toBeEnabled();

  const selection = page.selectOption("#length", "long");
  await expect(page.locator("#length")).toBeDisabled();
  await expect(page.locator("#daily")).toBeDisabled();
  await expect(page.locator("#locale")).toBeDisabled();
  await expect(page.locator("#category")).toBeDisabled();
  await expect(page.locator("#cow-style")).toBeDisabled();
  await expect(page.locator("#refresh")).toBeDisabled();
  await expect.poll(() => pending.length).toBe(1);
  pending.shift()();
  await selection;
  await expect(page.locator("#fortune-text")).toHaveText(
    "A long fortune from the far side of the pasture.",
  );
  await expect(page.locator("#length")).toBeEnabled();
  await expect(page.locator("#daily")).toBeEnabled();
  await expect(page.locator("#length")).toHaveValue("long");
  await expect(page.locator("#locale")).toBeEnabled();
});

test("fortune of the day is shared, restored, and left again for a random fortune", async ({
  page,
}) => {
  const fortuneRequests = [];
  const randomIds = ["general-0", "general-1"];
  let randomCursor = 0;
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
    fortuneRequests.push(url.search);
    const pinned = url.searchParams.get("fortune");
    const daily = url.searchParams.get("daily") === "true";
    let id = pinned;
    let body = pinned ? `Pinned ${pinned}.` : "A general fortune.";
    if (daily) {
      id =
        url.searchParams.get("category") === "love" ? "love-1" : "wisdom-0";
      body =
        url.searchParams.get("length") === "short"
          ? "Short daily fortune."
          : "Daily fortune.";
    } else if (!pinned) {
      id = randomIds[randomCursor % randomIds.length];
      randomCursor += 1;
      body = id === "general-0" ? "A general fortune." : "Another general fortune.";
    }
    return route.fulfill({
      contentType: "text/plain",
      headers: {
        "x-fortune-id": id,
        "access-control-expose-headers": "x-fortune-id",
      },
      body,
    });
  });
  await installClipboard(page);
  await page.goto("/");

  const dailySwitch = page.getByRole("switch", { name: "Fortune of the day" });
  await expect(dailySwitch).toBeVisible();
  await expect(dailySwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");
  await expect(page.getByRole("button", { name: "Another fortune" })).toBeVisible();
  expect(fortuneRequests[0]).toBe("?locale=en");
  expect(new URL(page.url()).search).toBe("?fortune=general-0");

  await page.locator("#locale").focus();
  await page.keyboard.press("Tab");
  const lengthOutline = await page.locator("#length").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
      offset: style.outlineOffset,
    };
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dailySwitch).toBeFocused();
  const dailyOutline = await dailySwitch.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
      offset: style.outlineOffset,
    };
  });
  expect(dailyOutline).toEqual(lengthOutline);
  expect(dailyOutline.style).not.toBe("none");

  const historyLength = await page.evaluate(() => history.length);
  await dailySwitch.click();
  await expect(dailySwitch).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#fortune-text")).toHaveText("Daily fortune.");
  await expect(page.locator("#status")).toHaveText("Fortune of the day");
  await expect(page.getByRole("button", { name: "Today's fortune" })).toBeVisible();
  await expect(page.locator("#refresh .refresh-icon-daily")).toBeVisible();
  await expect(page.locator("#refresh .refresh-icon-random")).toBeHidden();
  await expect(page.locator("#hint-third")).toHaveText("for today's.");
  await expect.poll(() => fortuneRequests.at(-1)).toBe("?locale=en&daily=true");
  expect(fortuneRequests.at(-1)).not.toContain("fortune=");
  await expect.poll(() => page.evaluate(() => location.search)).toBe("?daily=true");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);

  await page.selectOption("#category", "love");
  await page.selectOption("#length", "short");
  await page.selectOption("#cow-style", "tux");
  await expect(page.locator("#cow")).toContainText("tux");
  await expect(page.locator("#fortune-text")).toHaveText("Short daily fortune.");
  await expect.poll(() => fortuneRequests.at(-1)).toBe(
    "?locale=en&category=love&length=short&daily=true",
  );
  expect(fortuneRequests.at(-1)).not.toContain("fortune=");
  expect(fortuneRequests.at(-1)).not.toContain("cow=");
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?cow=tux&category=love&length=short&daily=true",
  );

  const beforeRefresh = fortuneRequests.length;
  await page.getByRole("button", { name: "Today's fortune" }).click();
  await expect.poll(() => fortuneRequests.length).toBe(beforeRefresh + 1);
  expect(fortuneRequests.at(-1)).toBe(
    "?locale=en&category=love&length=short&daily=true",
  );
  await expect(page.locator("#fortune-text")).toHaveText("Short daily fortune.");
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?cow=tux&category=love&length=short&daily=true",
  );

  await page.locator("#headline-first").click();
  await page.keyboard.press("Space");
  await expect.poll(() => fortuneRequests.at(-1)).toBe(
    "?locale=en&category=love&length=short&daily=true",
  );
  await expect(page.locator("#fortune-text")).toHaveText("Short daily fortune.");

  await page.locator("#copy").click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedText))
    .toBe(
      "Short daily fortune.\n\nhttp://127.0.0.1:5173/?cow=tux&category=love&length=short&daily=true",
    );

  await page.reload();
  await expect(dailySwitch).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#cow-style")).toHaveValue("tux");
  await expect(page.locator("#category")).toHaveValue("love");
  await expect(page.locator("#length")).toHaveValue("short");
  await expect(page.locator("#fortune-text")).toHaveText("Short daily fortune.");
  await expect(page.locator("#cow")).toContainText("tux");
  expect(fortuneRequests.at(-1)).toBe(
    "?locale=en&category=love&length=short&daily=true",
  );
  expect(new URL(page.url()).search).toBe(
    "?cow=tux&category=love&length=short&daily=true",
  );

  await dailySwitch.click();
  await expect(dailySwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "Another fortune" })).toBeVisible();
  await expect(page.locator("#refresh .refresh-icon-random")).toBeVisible();
  await expect(page.locator("#refresh .refresh-icon-daily")).toBeHidden();
  await expect(page.locator("#hint-third")).toHaveText("for another.");
  await expect(page.locator("#fortune-text")).toHaveText("Another general fortune.");
  expect(fortuneRequests.at(-1)).toBe(
    "?locale=en&category=love&length=short",
  );
  expect(fortuneRequests.at(-1)).not.toContain("daily=");
  expect(fortuneRequests.at(-1)).not.toContain("fortune=");
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?cow=tux&category=love&length=short&fortune=general-1",
  );

  await page.goto(
    "/?locale=pt&cow=tux&category=love&length=long&daily=true&fortune=love-4",
  );
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.getByRole("switch", { name: "Fortuna do dia" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.locator("#fortune-text")).toHaveText("Daily fortune.");
  expect(fortuneRequests.at(-1)).toBe(
    "?locale=pt&category=love&length=long&daily=true",
  );
  expect(fortuneRequests.at(-1)).not.toContain("fortune=");
  expect(new URL(page.url()).search).toBe(
    "?locale=pt&cow=tux&category=love&length=long&daily=true",
  );

  for (const search of [
    "?daily=false",
    "?daily=TRUE",
    "?daily=1",
    "?daily=",
    "?daily=true&daily=true",
    "?daily=yes&fortune=love-4",
  ]) {
    await page.goto(search);
    await expect(page.getByRole("switch", { name: "Fortune of the day" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(fortuneRequests.at(-1)).not.toContain("daily=");
    expect(new URL(page.url()).search).not.toContain("daily=");
  }
  expect(fortuneRequests.at(-1)).toContain("fortune=love-4");

  const isMobile = test.info().project.name.startsWith("mobile-");
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(/fortune/i);
  const lengthBox = await page.locator(".length-field").boundingBox();
  const dailyBox = await page.locator(".daily-field").boundingBox();
  const localeBox = await page.locator(".locale-field").boundingBox();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (isMobile) {
    expect(dailyBox.x).toBeGreaterThanOrEqual(lengthBox.x + lengthBox.width);
    expect(dailyBox.y).toBeLessThan(lengthBox.y + lengthBox.height);
    expect(lengthBox.y).toBeLessThan(dailyBox.y + dailyBox.height);
  } else {
    expect(dailyBox.y).toBeGreaterThan(localeBox.y + localeBox.height - 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= window.innerHeight,
      ),
    ).toBe(true);
  }
});
