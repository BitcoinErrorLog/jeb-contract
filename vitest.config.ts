import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/._*", "node_modules/**"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 45_000,
    hookTimeout: 120_000,
    globalSetup: ["./src/harness/global-setup.ts"],
    setupFiles: ["./src/harness/put-fail.ts"],
    pool: "forks",
  },
});
