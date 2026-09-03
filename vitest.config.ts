import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

if (!process.env.JEB_CONTRACT_RUNTIME) {
  const dir = mkdtempSync(join(tmpdir(), "jeb-contract-"));
  process.env.JEB_CONTRACT_RUNTIME = join(dir, "runtime.json");
}

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
    setupFiles: ["./src/harness/inject-runtime.ts", "./src/harness/put-fail.ts"],
    pool: "forks",
    env: {
      JEB_CONTRACT_RUNTIME: process.env.JEB_CONTRACT_RUNTIME,
    },
  },
});
