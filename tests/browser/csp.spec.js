import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, preview } from "vite";
import { test, expect } from "./fixtures.js";

function directive(policy, name) {
  return (
    policy
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.split(/\s+/)[0] === name) || ""
  );
}

async function mockFortuneApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/locales")) {
      return route.fulfill({ json: [{ id: "en", name: "English" }] });
    }
    if (url.pathname.endsWith("/categories")) {
      return route.fulfill({ json: ["computers"] });
    }
    if (url.pathname.endsWith("/cows")) {
      return route.fulfill({ json: ["default"] });
    }
    return route.fulfill({
      contentType: "text/plain",
      headers: { "x-fortune-id": "csp-test-1" },
      body: "Self-hosted fonts keep the pasture quiet.",
    });
  });
}

async function mockClipboardImage(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {},
        write: async (items) => {
          const item = items[0];
          const type = item.types[0];
          window.__copiedScreenshotType = type;
          window.__copiedScreenshotBlob = item.data[type];
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
}

test("main page CSP is enforced, drops Google Fonts and unsafe-inline, and refuses framing", async ({
  page,
}) => {
  await mockFortuneApi(page);
  const response = await page.goto("/");
  expect(response).toBeTruthy();
  const headers = response.headers();
  const policy = headers["content-security-policy"] || "";
  expect(policy).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  const styleSrc = directive(policy, "style-src");
  expect(styleSrc).toBe("style-src 'self'");
  expect(styleSrc).not.toContain("'unsafe-inline'");
  expect(styleSrc).not.toContain("fonts.googleapis.com");
  const fontSrc = directive(policy, "font-src");
  expect(fontSrc).toBe("font-src 'self'");
  expect(fontSrc).not.toContain("fonts.gstatic.com");
  const hsts = headers["strict-transport-security"] || "";
  expect(hsts).toMatch(/max-age=(\d+)/);
  expect(Number(hsts.match(/max-age=(\d+)/)[1])).toBeGreaterThanOrEqual(
    31536000,
  );
  expect(hsts.toLowerCase()).toContain("includesubdomains");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
});

test("production build self-hosts fonts with no Google Fonts requests and passes copy-screenshot under strict CSP", async ({
  page,
}) => {
  await mockFortuneApi(page);
  await mockClipboardImage(page);

  const externalFontRequests = [];
  const fontResponses = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/fonts\.(googleapis|gstatic)\.com/i.test(url)) {
      externalFontRequests.push(url);
    }
  });
  page.on("response", (response) => {
    if (response.url().endsWith(".woff2")) {
      fontResponses.push({
        url: response.url(),
        status: response.status(),
      });
    }
  });

  await page.goto("/");
  await expect(page.locator("#cow")).toContainText("(oo)");
  await expect(page.locator("#fortune-text")).toHaveText(
    "Self-hosted fonts keep the pasture quiet.",
  );

  expect(externalFontRequests).toEqual([]);
  expect(fontResponses.length).toBeGreaterThanOrEqual(2);
  for (const entry of fontResponses) {
    expect(entry.url).toMatch(/^http:\/\/127\.0\.0\.1:5173\//);
    expect(entry.status).toBe(200);
  }

  const loadedFamilies = await page.evaluate(async () => {
    await document.fonts.ready;
    return [
      ...new Set(
        [...document.fonts]
          .filter((face) => face.status === "loaded")
          .map((face) => face.family.replace(/^["']|["']$/g, "")),
      ),
    ];
  });
  expect(loadedFamilies).toContain("DM Sans");
  expect(loadedFamilies).toContain("JetBrains Mono");

  await page.getByRole("button", { name: "Copy screenshot" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__copiedScreenshotType))
    .toBe("image/png");

  // Built CSS in dist/ must contain no Google Fonts URLs.
  const assetDir = join(process.cwd(), "dist", "assets");
  const cssFiles = (await readdir(assetDir)).filter((name) =>
    name.endsWith(".css"),
  );
  expect(cssFiles.length).toBeGreaterThan(0);
  for (const file of cssFiles) {
    const css = await readFile(join(assetDir, file), "utf8");
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
  }
});

test("consent banner and copy-screenshot run under strict production CSP without violations", async ({
  page,
}) => {
  const outDir = await mkdtemp(join(tmpdir(), "webfortune-csp-ga-"));
  const previousGaId = process.env.VITE_GA_MEASUREMENT_ID;
  const previousApiUrl = process.env.VITE_API_URL;
  let server;
  try {
    process.env.VITE_GA_MEASUREMENT_ID = "G-TESTCSP123";
    process.env.VITE_API_URL = "";
    await build({
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
    server = await preview({
      logLevel: "silent",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    const address = server.httpServer.address();
    const url = `http://127.0.0.1:${address.port}/`;

    await mockFortuneApi(page);
    await mockClipboardImage(page);
    await page.route("https://www.googletagmanager.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/javascript; charset=utf-8",
        body: "/* stubbed gtag */",
      }),
    );

    const response = await page.goto(url);
    expect(response).toBeTruthy();
    const policy = response.headers()["content-security-policy"] || "";
    expect(directive(policy, "style-src")).toBe("style-src 'self'");
    expect(directive(policy, "font-src")).toBe("font-src 'self'");

    await expect(page.locator("#cow")).toContainText("(oo)");
    await expect(page.locator("#analytics-consent")).toBeVisible();
    await page.locator("#analytics-accept").click();
    await expect(page.locator("#analytics-consent")).toBeHidden();
    await expect(page.locator("#analytics-preferences")).toBeVisible();

    await page.locator("#analytics-preferences").click();
    await expect(page.locator("#analytics-consent")).toBeVisible();
    await page.locator("#analytics-reject").click();
    await expect(page.locator("#analytics-consent")).toBeHidden();

    await page.getByRole("button", { name: "Copy screenshot" }).click();
    await expect
      .poll(() => page.evaluate(() => window.__copiedScreenshotType))
      .toBe("image/png");
  } finally {
    if (server) {
      await new Promise((resolve) => server.httpServer.close(resolve));
    }
    if (previousGaId === undefined) delete process.env.VITE_GA_MEASUREMENT_ID;
    else process.env.VITE_GA_MEASUREMENT_ID = previousGaId;
    if (previousApiUrl === undefined) delete process.env.VITE_API_URL;
    else process.env.VITE_API_URL = previousApiUrl;
    await rm(outDir, { recursive: true, force: true });
  }
});
