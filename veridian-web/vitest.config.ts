import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // The ingestion suite provisions a throwaway SQLite database by shelling
    // out to the Prisma CLI, which takes several seconds on a cold cache. The
    // default 5s budget kills a healthy run, so give the suite room to finish.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
