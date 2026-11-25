import { test as base, expect } from "@playwright/test";

const cspViolation = /content security policy/i;

// Fails the test when Chromium reports a CSP violation during the existing
// flows. Playwright runs against `vite preview` of the production build, which
// sends the exact policy file the Worker uses.
export const test = base.extend({
  page: async ({ page }, use) => {
    const violations = [];
    const record = (message) => {
      const text = message.text();
      if (cspViolation.test(text)) violations.push(text);
    };
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.__cspViolations.push(
          `${event.effectiveDirective}: ${event.blockedURI || event.disposition}`,
        );
      });
    });
    page.on("console", record);
    await use(page);
    const domViolations = await page
      .evaluate(() => window.__cspViolations || [])
      .catch(() => []);
    const allViolations = [...domViolations, ...violations];
    expect(
      allViolations,
      `CSP violations:\n${allViolations.join("\n")}`,
    ).toEqual([]);
  },
});

export async function showFortuneOptions(page) {
  const toggle = page.locator("#more-options");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.locator("#locale")).toBeVisible();
}

export { expect };
