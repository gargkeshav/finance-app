import { defineConfig } from "vitest/config";

export default defineConfig({
  clearScreen: false,
  server: { strictPort: true },
  envPrefix: ["VITE_"],
  test: { include: ["tests/**/*.test.ts"] },
});
