import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HarnessRuntime } from "./types.js";

export function runtimeFilePath(): string {
  const p = process.env.JEB_CONTRACT_RUNTIME;
  if (!p) {
    throw new Error(
      "JEB_CONTRACT_RUNTIME is unset. The vitest config assigns a per-run temp file; do not read repo-root harness-runtime.json.",
    );
  }
  return p;
}

export function readRuntime(): HarnessRuntime | null {
  const file = process.env.JEB_CONTRACT_RUNTIME;
  if (!file || !existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as HarnessRuntime;
}

export function writeRuntime(r: HarnessRuntime): void {
  const file = runtimeFilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(r, null, 2) + "\n");
  process.stderr.write(`[pubky-bot-contract] runtime ${file}\n`);
}

export type { HarnessRuntime };
