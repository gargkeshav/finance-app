import { defineConfig } from "vitest/config";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { splitwiseSession } from "./vite/splitwise-session.ts";

export default defineConfig({
  clearScreen: false,
  server: { strictPort: true },
  envPrefix: ["VITE_"],
  plugins: [tailwindcss(), splitwiseSession()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
