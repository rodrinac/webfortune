import { showFortuneOptions, test, expect } from "./fixtures.js";

const bodies = {
  "alpha-1": "Fortune alpha from the pasture.",
  "beta-2": "Fortune beta from the pasture.",
  "gamma-3": "Fortune gamma from the pasture.",
  "love-2": "O amor da vaca é paciente.",
  "love-4": "O amor da vaca é eterno.",
  "wisdom-0": "Fortune about wisdom.",
  "wisdom-1": "More wisdom from the pasture.",
  "geral-0": "Uma fortuna geral.",
  "geral-1": "Outra fortuna geral.",
  "daily-1": "The daily pasture note.",
};

function isFortuneId(value) {
  const split = value.lastIndexOf("-");
  if (split <= 0) return false;
  const index = value.slice(split + 1);
  return /^[a-zA-Z0-9_.-]+$/.test(value) && /^(?:0|[1-9]\d{0,9})$/.test(index);
}

async function mockApi(page, { failFortunes = () => false } = {}) {
  const fortuneRequests = [];
  const cursors = {};
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
    if (failFortunes())
      return route.fulfill({ status: 503, body: "The pasture is closed.\n" });

    const requested = url.searchParams.get("fortune");
    if (requested && url.searchParams.has("length"))
      return route.fulfill({ status: 400, body: "Invalid query.\n" });
    if (requested && url.searchParams.get("daily") === "true")
      return route.fulfill({ status: 400, body: "Invalid query.\n" });
    if (requested && !isFortuneId(requested))
      return route.fulfill({ status: 400, body: "Invalid fortune.\n" });
    if (requested && !bodies[requested])
      return route.fulfill({ status: 404, body: "Fortune not found.\n" });

    let id = requested;
    if (url.searchParams.get("daily") === "true") id = "daily-1";
    if (!id) {
      const locale = url.searchParams.get("locale") || "en";
      const category = url.searchParams.get("category") || "";
      const key = `${locale}|${category}`;
      const sequence =
        category === "love"
          ? ["love-2", "love-4"]
          : category === "wisdom"
            ? ["wisdom-0", "wisdom-1"]
            : locale === "pt"
              ? ["geral-0", "geral-1"]
              : ["alpha-1", "beta-2", "gamma-3"];
      const cursor = cursors[key] || 0;
      cursors[key] = cursor + 1;
      id = sequence[cursor % sequence.length];
    }
    return route.fulfill({
      contentType: "text/plain",
      headers: {
        "x-fortune-id": id,
        "access-control-expose-headers": "x-fortune-id",
      },
      body: bodies[id],
    });
  });
  return fortuneRequests;
}

async function search(page) {
  return page.evaluate(() => location.search);
}

async function historyLength(page) {
  return page.evaluate(() => history.length);
}

test("back and forward step through fortunes from refresh and space", async ({
  page,
}) => {
  const fortuneRequests = await mockApi(page);
  await page.goto("/");

  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  await expect.poll(() => search(page)).toBe("?fortune=alpha-1");
  const start = await historyLength(page);
  expect(fortuneRequests[0]).toBe("?locale=en");

  await page.getByRole("button", { name: "Another fortune" }).click();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["beta-2"]);
  await expect.poll(() => search(page)).toBe("?fortune=beta-2");
  expect(await historyLength(page)).toBe(start + 1);
  expect(fortuneRequests.at(-1)).toBe("?locale=en");

  await page.locator("#headline-first").click();
  await page.keyboard.press("Space");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["gamma-3"]);
  await expect.poll(() => search(page)).toBe("?fortune=gamma-3");
  expect(await historyLength(page)).toBe(start + 2);
  expect(fortuneRequests.at(-1)).toBe("?locale=en");

  await page.goBack();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["beta-2"]);
  await expect.poll(() => search(page)).toBe("?fortune=beta-2");
  await expect(page.locator("#error")).toBeHidden();
  expect(fortuneRequests.at(-1)).toBe("?locale=en&fortune=beta-2");
  expect(await historyLength(page)).toBe(start + 2);

  await page.goBack();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  await expect.poll(() => search(page)).toBe("?fortune=alpha-1");
  expect(fortuneRequests.at(-1)).toBe("?locale=en&fortune=alpha-1");
  expect(await historyLength(page)).toBe(start + 2);

  await page.goForward();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["beta-2"]);
  await expect.poll(() => search(page)).toBe("?fortune=beta-2");
  expect(fortuneRequests.at(-1)).toBe("?locale=en&fortune=beta-2");
  expect(await historyLength(page)).toBe(start + 2);
});

test("a fortune permalink is a single history entry", async ({ page }) => {
  const fortuneRequests = await mockApi(page);
  await page.goto("/?locale=pt&cow=tux&category=love&length=short&fortune=love-4");

  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-4"]);
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("#cow-style")).toHaveValue("tux");
  await expect(page.locator("#category")).toHaveValue("love");
  await expect(page.locator("#length")).toHaveValue("short");
  await expect(page.locator("#error")).toBeHidden();
  expect(new URL(page.url()).search).toBe(
    "?locale=pt&cow=tux&category=love&length=short&fortune=love-4",
  );
  expect(fortuneRequests).toEqual([
    "?locale=pt&category=love&fortune=love-4",
  ]);
  // The document navigation is the only site entry. Back leaves the page
  // instead of revealing a second fortune URL created on load.
  await page.goBack();
  await expect.poll(() => page.url()).toBe("about:blank");
});

test("an unknown fortune id falls back without adding a history entry", async ({
  page,
}) => {
  const fortuneRequests = await mockApi(page);
  await page.goto("/?fortune=missing-9");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  await expect(page.locator("#error")).toBeHidden();
  expect(new URL(page.url()).search).toBe("?fortune=alpha-1");
  expect(fortuneRequests.at(-2)).toBe("?locale=en&fortune=missing-9");
  expect(fortuneRequests.at(-1)).toBe("?locale=en");
  await page.goBack();
  await expect.poll(() => page.url()).toBe("about:blank");
});

test("settings changes do not add history entries and back restores them", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/?locale=pt&cow=tux&category=love&length=short");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-2"]);
  await expect.poll(() => search(page)).toBe(
    "?locale=pt&cow=tux&category=love&length=short&fortune=love-2",
  );
  const start = await historyLength(page);

  await page.getByRole("button", { name: "Outra fortuna" }).click();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-4"]);
  expect(await historyLength(page)).toBe(start + 1);

  await showFortuneOptions(page);
  await page.selectOption("#length", "long");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-2"]);
  await expect.poll(() => search(page)).toBe(
    "?locale=pt&cow=tux&category=love&length=long&fortune=love-2",
  );
  await page.selectOption("#category", "wisdom");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["wisdom-0"]);
  await page.selectOption("#cow-style", "default");
  await expect(page.locator("#cow")).toContainText("(oo)");
  await page.selectOption("#locale", "en");
  await expect(page.locator("#category")).toHaveValue("");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  await expect.poll(() => search(page)).toBe("?length=long&fortune=alpha-1");
  expect(await historyLength(page)).toBe(start + 1);

  await page.goBack();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-2"]);
  await expect.poll(() => search(page)).toBe(
    "?locale=pt&cow=tux&category=love&length=short&fortune=love-2",
  );
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("#cow-style")).toHaveValue("tux");
  await expect(page.locator("#cow")).toContainText("tux");
  await expect(page.locator("#category")).toHaveValue("love");
  await expect(page.locator("#length")).toHaveValue("short");
  await expect(page.locator("#command")).toHaveText("fortune -s love | cowsay -f tux");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(page.locator("#error")).toBeHidden();
  expect(await historyLength(page)).toBe(start + 1);

  await page.goForward();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.locator("#cow-style")).toHaveValue("default");
  await expect(page.locator("#category")).toHaveValue("");
  await expect(page.locator("#length")).toHaveValue("long");
  await expect.poll(() => search(page)).toBe("?length=long&fortune=alpha-1");
  expect(await historyLength(page)).toBe(start + 1);
});

test("fortune of the day refresh does not add history entries", async ({
  page,
}) => {
  const fortuneRequests = await mockApi(page);
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  const start = await historyLength(page);

  await showFortuneOptions(page);
  await page.getByRole("switch", { name: "Fortune of the day" }).click();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["daily-1"]);
  await expect.poll(() => search(page)).toBe("?daily=true");
  expect(fortuneRequests.at(-1)).toBe("?locale=en&daily=true");
  expect(await historyLength(page)).toBe(start);

  await page.getByRole("button", { name: "Today's fortune" }).click();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["daily-1"]);
  expect(fortuneRequests.at(-1)).toBe("?locale=en&daily=true");
  expect(await historyLength(page)).toBe(start);

  await page.locator("#headline-first").click();
  await page.keyboard.press("Space");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["daily-1"]);
  await expect.poll(() => search(page)).toBe("?daily=true");
  expect(await historyLength(page)).toBe(start);
});

test("a failed refresh or back navigation adds no history entry", async ({
  page,
}) => {
  let fail = false;
  const fortuneRequests = await mockApi(page, { failFortunes: () => fail });
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  await page.getByRole("button", { name: "Another fortune" }).click();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["beta-2"]);
  await page.locator("#headline-first").click();
  await page.keyboard.press("Space");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["gamma-3"]);
  const length = await historyLength(page);

  fail = true;
  await page.getByRole("button", { name: "Another fortune" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["gamma-3"]);
  await expect.poll(() => search(page)).toBe("?fortune=gamma-3");
  expect(await historyLength(page)).toBe(length);

  const requestsBeforeBack = fortuneRequests.length;
  await page.goBack();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["gamma-3"]);
  await expect.poll(() => search(page)).toBe("?fortune=beta-2");
  expect(await historyLength(page)).toBe(length);
  expect(fortuneRequests.length).toBeGreaterThan(requestsBeforeBack);
  expect(fortuneRequests.at(-1)).toBe("?locale=en&fortune=beta-2");
});

test("history navigation revalidates the URL and does not inject HTML", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/?fortune=alpha-1");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  const start = await historyLength(page);

  await page.evaluate(() => {
    history.pushState(
      null,
      "",
      "/?locale=%3Csvg%2Fonload%3Dalert(1)%3E&cow=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&category=..%2F..%2Fetc&length=medium&fortune=beta-2",
    );
  });
  expect(await historyLength(page)).toBe(start + 1);

  await page.goBack();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["alpha-1"]);
  await page.goForward();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["beta-2"]);
  await expect(page.locator("#locale")).toHaveValue("en");
  await expect(page.locator("#cow-style")).toHaveValue("default");
  await expect(page.locator("#category")).toHaveValue("");
  await expect(page.locator("#length")).toHaveValue("");
  await expect(page.locator("#error")).toBeHidden();
  await expect(page.locator("#cow img, #cow script, #cow svg")).toHaveCount(0);
  expect(await page.content()).not.toContain("onerror");
  expect(await page.content()).not.toContain("onload");
  await expect.poll(() => search(page)).toBe("?fortune=beta-2");
  expect(await historyLength(page)).toBe(start + 1);
});
