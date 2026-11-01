import { test, expect } from "./fixtures.js";

test("main page CSP is enforced and refuses framing", async ({ page }) => {
  const response = await page.goto("/");
  expect(response).toBeTruthy();
  const headers = response.headers();
  const policy = headers["content-security-policy"] || "";
  expect(policy).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
});
