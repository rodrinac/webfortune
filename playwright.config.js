import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: { baseURL: "http://127.0.0.1:5173", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop-full-hd",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "desktop-macbook-14",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1512, height: 982 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: "desktop-macbook-14-windowed",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1358, height: 862 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: "mobile-regular",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    {
      name: "mobile-large",
      use: {
        ...devices["iPhone 14 Pro Max"],
        defaultBrowserType: "chromium",
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
