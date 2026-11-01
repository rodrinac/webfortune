import { test as base, expect } from "@playwright/test";

const cspViolation = /content security policy/i;

// Fails the test when Chromium reports a CSP violation during the existing
// flows. The dev server sends the same policy file the Worker uses.
export const test = base.extend({
  page: async ({ page }, use) => {
    const violations = [];
    const record = (message) => {
      const text = message.text();
      if (cspViolation.test(text)) violations.push(text);
    };
    page.on("console", record);
    await use(page);
    expect(violations, `CSP violations:\n${violations.join("\n")}`).toEqual([]);
  },
});

export { expect };
