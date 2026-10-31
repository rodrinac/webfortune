import { test, expect } from "@playwright/test";

const bodies = {
  "love-2": "O amor da vaca é paciente.",
  "love-4": "O amor da vaca é eterno.",
  "wisdom-0": "Fortune about wisdom.",
  "wisdom-1": "More wisdom from the pasture.",
  "general-0": "A general fortune.",
  "general-1": "Another general fortune.",
  "geral-0": "Uma fortuna geral.",
  "geral-1": "Outra fortuna geral.",
};

function isFortuneId(value) {
  const split = value.lastIndexOf("-");
  if (split <= 0) return false;
  const index = value.slice(split + 1);
  return (
    /^[a-zA-Z0-9_.-]+$/.test(value) && /^(?:0|[1-9]\d{0,9})$/.test(index)
  );
}

async function mockApi(page) {
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

    const requested = url.searchParams.get("fortune");
    fortuneRequests.push(url.search);
    if (requested && !isFortuneId(requested))
      return route.fulfill({
        status: 400,
        contentType: "text/plain",
        body: "Invalid fortune.\n",
      });
    if (requested && !bodies[requested])
      return route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "Fortune not found.\n",
      });

    let id = requested;
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
              : ["general-0", "general-1"];
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

test("copies a link that reopens the same fortune", async ({ page }) => {
  const fortuneRequests = await mockApi(page);
  await installClipboard(page);
  await page.goto("/?locale=pt&cow=tux&category=love");

  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-2"]);
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("#cow-style")).toHaveValue("tux");
  await expect(page.locator("#category")).toHaveValue("love");
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?locale=pt&cow=tux&category=love&fortune=love-2",
  );
  expect(fortuneRequests[0]).toBe("?locale=pt&category=love");

  await page.locator("#refresh").click();
  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-4"]);
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?locale=pt&cow=tux&category=love&fortune=love-4",
  );
  expect(fortuneRequests.at(-1)).toBe("?locale=pt&category=love");

  await page.locator("#copy").click();
  const copied = await page.evaluate(() => window.__copiedText);
  expect(copied).toBe(
    `${bodies["love-4"]}\n\nhttp://127.0.0.1:5173/?locale=pt&cow=tux&category=love&fortune=love-4`,
  );

  const fresh = await page.context().newPage();
  const freshRequests = await mockApi(fresh);
  const shared = new URL(copied.split("\n\n").at(-1));
  await fresh.goto(`${shared.pathname}${shared.search}`);
  await expect(fresh.locator("#fortune-text")).toHaveText(bodies["love-4"]);
  await expect(fresh.locator("#locale")).toHaveValue("pt");
  await expect(fresh.locator("#cow-style")).toHaveValue("tux");
  await expect(fresh.locator("#cow")).toContainText("tux");
  await expect(fresh.locator("#category")).toHaveValue("love");
  await expect(fresh.locator("html")).toHaveAttribute("lang", "pt");
  await expect(fresh.locator("#error")).toBeHidden();
  expect(freshRequests).toEqual([
    "?locale=pt&category=love&fortune=love-4",
  ]);
  expect(new URL(fresh.url()).search).toBe(
    "?locale=pt&cow=tux&category=love&fortune=love-4",
  );

  await page.locator("#headline-first").click();
  await page.keyboard.press("Space");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-2"]);
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?locale=pt&cow=tux&category=love&fortune=love-2",
  );
  expect(fortuneRequests.at(-1)).toBe("?locale=pt&category=love");
  await fresh.close();
});

test("invalid and stale fortune ids fall back to a random fortune", async ({
  page,
}) => {
  const fortuneRequests = await mockApi(page);
  await page.goto("/?locale=pt&cow=tux&fortune=love-01");

  await expect(page.locator("#fortune-text")).toHaveText(bodies["geral-0"]);
  await expect(page.locator("#error")).toBeHidden();
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("#cow-style")).toHaveValue("tux");
  await expect(page.locator("#category")).toHaveValue("");
  expect(fortuneRequests).toEqual(["?locale=pt"]);
  expect(new URL(page.url()).search).toBe("?locale=pt&cow=tux&fortune=geral-0");

  fortuneRequests.length = 0;
  await page.goto("/?locale=pt&cow=tux&category=love&fortune=love-99");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["love-2"]);
  await expect(page.locator("#error")).toBeHidden();
  await expect(page.locator("#category")).toHaveValue("love");
  expect(fortuneRequests).toEqual([
    "?locale=pt&category=love&fortune=love-99",
    "?locale=pt&category=love",
  ]);
  expect(new URL(page.url()).search).toBe(
    "?locale=pt&cow=tux&category=love&fortune=love-2",
  );

  await page.selectOption("#category", "wisdom");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["wisdom-0"]);
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?locale=pt&cow=tux&category=wisdom&fortune=wisdom-0",
  );
  expect(fortuneRequests.at(-1)).toBe("?locale=pt&category=wisdom");

  await page.selectOption("#locale", "en");
  await expect(page.locator("#category")).toHaveValue("");
  await expect(page.locator("#fortune-text")).toHaveText(bodies["general-0"]);
  await expect.poll(() => page.evaluate(() => location.search)).toBe(
    "?cow=tux&fortune=general-0",
  );
  expect(fortuneRequests.at(-1)).toBe("?locale=en");
  expect(fortuneRequests.at(-1)).not.toContain("fortune=");
});
