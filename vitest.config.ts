import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

if (!process.env.JEB_CONTRACT_RUNTIME) {
  const dir = mkdtempSync(join(tmpdir(), "pubky-bot-contract-"));
  process.env.JEB_CONTRACT_RUNTIME = join(dir, "runtime.json");
}
if (!process.env.JEB_CONTRACT_RUN_ID) {
  process.env.JEB_CONTRACT_RUN_ID = process.env.JEB_CONTRACT_RUNTIME.replace(/[^A-Za-z0-9]+/g, "").slice(-12);
}

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/._*", "node_modules/**"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 180_000,
    globalSetup: ["./src/harness/global-setup.ts"],
    setupFiles: ["./src/harness/inject-runtime.ts"],
    pool: "forks",
    env: {
      JEB_CONTRACT_RUNTIME: process.env.JEB_CONTRACT_RUNTIME,
      JEB_CONTRACT_RUN_ID: process.env.JEB_CONTRACT_RUN_ID,
    },
  },
});
