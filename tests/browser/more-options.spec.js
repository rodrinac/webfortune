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
    fortuneRequests.push(url.search);
    const daily = url.searchParams.get("daily") === "true";
    const category = url.searchParams.get("category");
    const body = daily
      ? "Daily fortune."
      : category
        ? `Fortune about ${category}.`
        : fortuneRequests.filter((search) => !search.includes("daily=")).length === 1
          ? "A general fortune."
          : "Another general fortune.";
    return route.fulfill({
      contentType: "text/plain",
      headers: { "x-fortune-id": daily ? "" : "general-0" },
      body,
    });
  });
  return fortuneRequests;
}

async function chevronAngles(page) {
  return page.locator(".more-options-chevron").evaluateAll((chevrons) =>
    chevrons.map((chevron) => {
      const transform = getComputedStyle(chevron).transform;
      if (transform === "none") return 0;
      const [a, b] = transform
        .match(/matrix\(([^)]+)\)/)[1]
        .split(",")
        .map((value) => Number(value.trim()));
      return Math.abs(Math.round((Math.atan2(b, a) * 180) / Math.PI));
    }),
  );
}

test("more options stays collapsed until the expander is used", async ({
  page,
}) => {
  const fortuneRequests = await mockApi(page);
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
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");

  const toggle = page.getByRole("button", { name: "More Options" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveAttribute("aria-controls", "fortune-options");
  await expect(page.locator("#fortune-options")).toHaveAttribute("hidden", "");
  await expect(page.locator("#locale")).toBeHidden();
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Fortune of the day" })).toHaveCount(0);
  await expect(chevronAngles(page)).resolves.toEqual([0, 0]);
  expect(
    await page.evaluate(
      () =>
        document.querySelector("#fortune-options").contains(document.querySelector("#copy")) ||
        document.querySelector("#fortune-options").contains(document.querySelector("#screenshot")) ||
        document.querySelector("#fortune-options").contains(document.querySelector("#refresh")),
    ),
  ).toBe(false);

  const widths = await page.evaluate(() => {
    const toggleBounds = document.querySelector("#more-options").getBoundingClientRect();
    const controlsBounds = document.querySelector(".controls").getBoundingClientRect();
    return {
      toggle: toggleBounds.width,
      controls: controlsBounds.width,
    };
  });
  expect(widths.toggle).toBeCloseTo(widths.controls, 0);

  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy screenshot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Another fortune" })).toBeVisible();
  await page.getByRole("button", { name: "Another fortune" }).click();
  await expect(page.locator("#fortune-text")).toHaveText("Another general fortune.");
  await expect(page.locator("#more-options")).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedText))
    .toContain("Another general fortune.");
  expect(fortuneRequests.at(-1)).toBe("?locale=en");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#fortune-options")).not.toHaveAttribute("hidden");
  await expect(page.locator("#locale")).toBeVisible();
  await expect(page.locator("#length")).toBeVisible();
  await expect(page.locator("#category")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Fortune of the day" })).toBeVisible();
  await expect.poll(() => chevronAngles(page)).toEqual([180, 180]);
  expect(fortuneRequests).toHaveLength(2);

  await page.locator("#cow-style").focus();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  const outline = await toggle.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: style.outlineWidth,
      color: style.outlineColor,
    };
  });
  expect(outline.style).toBe("solid");
  expect(parseFloat(outline.width)).toBeGreaterThan(0);
  expect(outline.color).toBe("rgb(249, 226, 175)");

  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#locale")).toBeHidden();
  await expect.poll(() => chevronAngles(page)).toEqual([0, 0]);

  await page.keyboard.press(" ");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#category")).toBeVisible();
  await expect.poll(() => chevronAngles(page)).toEqual([180, 180]);
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
});

test("url options apply while more options stays collapsed", async ({ page }) => {
  const fortuneRequests = await mockApi(page);
  await page.goto("/?locale=pt&category=love&length=short&daily=true");

  await expect(page.locator("#more-options")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#fortune-options")).toHaveAttribute("hidden", "");
  await expect(page.locator("#locale")).toBeHidden();
  await expect(page.locator("#locale")).toHaveValue("pt");
  await expect(page.locator("#category")).toHaveValue("love");
  await expect(page.locator("#length")).toHaveValue("short");
  await expect(page.locator("#daily")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#more-options-label")).toHaveText("Mais opções");
  await expect(page.locator("#fortune-text")).toHaveText("Daily fortune.");
  expect(fortuneRequests.at(-1)).toBe(
    "?locale=pt&category=love&length=short&daily=true",
  );
  await expect(page.getByRole("button", { name: "Copiar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar captura" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fortuna de hoje" })).toBeVisible();
  await page.getByRole("button", { name: "Fortuna de hoje" }).click();
  await expect.poll(() => fortuneRequests.at(-1)).toBe(
    "?locale=pt&category=love&length=short&daily=true",
  );
  await expect(page.locator("#more-options")).toHaveAttribute("aria-expanded", "false");
});

test("chevron motion follows the reduced-motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator("#fortune-text")).toHaveText("A general fortune.");
  await expect(page.locator(".more-options-chevron").first()).toHaveCSS(
    "transition-duration",
    "0.18s",
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("#fortune-text")).toHaveText("Another general fortune.");
  await expect(page.locator(".more-options-chevron").first()).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.locator("#more-options").click();
  await expect(page.locator("#more-options")).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => chevronAngles(page)).toEqual([180, 180]);
});
