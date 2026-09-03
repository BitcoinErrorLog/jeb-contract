import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessRuntime } from "./global-setup.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME_FILE = join(ROOT, "harness-runtime.json");

export function readRuntime(): HarnessRuntime | null {
  if (!existsSync(RUNTIME_FILE)) return null;
  return JSON.parse(readFileSync(RUNTIME_FILE, "utf8")) as HarnessRuntime;
}
