import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:1421", trace: "retain-on-failure" },
  webServer: {
    command: "VITE_SYNTHETIC_PREVIEW=1 npm run dev -- --port 1421",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: !process.env.CI,
  },
});
