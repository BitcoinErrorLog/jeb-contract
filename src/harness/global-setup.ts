import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { writeRuntime, type HarnessRuntime } from "./runtime.js";
import { canConnectTcp, probeStaticTestnetPorts } from "./ports.js";
import { killProcessGroup, spawnProcessGroup } from "./process-group.js";
import { STAGING_ADMIN_URL, STAGING_HOMESERVER_PK, STATIC_TESTNET_HOMESERVER_PK } from "../uri.js";

const CORE = "/Volumes/vibedrive/vibes-dev/pubky-core";
const DEFAULT_TIMEOUT_MS = 90_000;
const TESTNET_ADMIN_URL = "http://127.0.0.1:6288/generate_signup_token";

let child: ChildProcess | null = null;
let childPid = 0;
let signalsInstalled = false;

function timeoutMs(): number {
  const raw = process.env.CONTRACT_TESTNET_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function pgUrl(): string {
  return (
    process.env.TEST_PUBKY_CONNECTION_STRING ??
    "postgres://postgres:postgres@127.0.0.1:55435/postgres"
  );
}

function failFastNoHomeserver(detail: string): never {
  throw new Error(
    [
      "No real homeserver available for jeb-contract.",
      detail,
      "",
      "Choose one:",
      "  1) Local static pubky-testnet — free ports 6881/15411/15412/6288, release binary, Postgres.",
      "     Prepare with scripts/start-testnet.sh, or set CONTRACT_HOMESERVER=pubky-testnet.",
      "  2) Staging homeserver — CONTRACT_HOMESERVER=staging and CONTRACT_STAGING_ADMIN_PASSWORD.",
      "There is no in-process fake homeserver.",
    ].join("\n"),
  );
}

async function waitForAdmin(url: string, timeout: number, label: string): Promise<boolean> {
  const start = Date.now();
  let lastBeat = start;
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, {
        headers: { "X-Admin-Password": "admin" },
      });
      if (res.ok || res.status === 401 || res.status === 403) return true;
      const t = await res.text();
      if (t.length > 0 && res.status < 500) return true;
    } catch {
      // not up
    }
    const now = Date.now();
    if (now - lastBeat >= 10_000) {
      lastBeat = now;
      process.stderr.write(
        `[jeb-contract] ${label} still waiting (${Math.round((now - start) / 1000)}s / ${timeout}ms)\n`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function killSpawnedTestnet(): Promise<void> {
  const pid = childPid || child?.pid || 0;
  child = null;
  childPid = 0;
  if (pid > 0) await killProcessGroup(pid);
}

function installSignalHandlers(): void {
  if (signalsInstalled) return;
  signalsInstalled = true;
  const onSignal = () => {
    void killSpawnedTestnet();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

function testnetBinary(): string {
  return join(CORE, "target/release/pubky-testnet");
}

async function postgresReady(): Promise<boolean> {
  if (process.env.TEST_PUBKY_CONNECTION_STRING) {
    try {
      const u = new URL(process.env.TEST_PUBKY_CONNECTION_STRING);
      const port = Number(u.port || "5432");
      return canConnectTcp(u.hostname || "127.0.0.1", port);
    } catch {
      return false;
    }
  }
  return canConnectTcp("127.0.0.1", 55435);
}

function writeTestnetRuntime(): HarnessRuntime {
  const r: HarnessRuntime = {
    mode: "pubky-testnet",
    homeserverPk: STATIC_TESTNET_HOMESERVER_PK,
    adminUrl: TESTNET_ADMIN_URL,
    pgUrl: pgUrl(),
    testnet: true,
  };
  writeRuntime(r);
  process.stderr.write("[jeb-contract] homeserver mode=pubky-testnet\n");
  return r;
}

function writeStagingRuntime(): HarnessRuntime {
  if (!process.env.CONTRACT_STAGING_ADMIN_PASSWORD) {
    failFastNoHomeserver("CONTRACT_STAGING_ADMIN_PASSWORD is unset.");
  }
  const r: HarnessRuntime = {
    mode: "staging",
    homeserverPk: STAGING_HOMESERVER_PK,
    adminUrl: STAGING_ADMIN_URL,
    pgUrl: pgUrl(),
    testnet: false,
  };
  writeRuntime(r);
  process.stderr.write(
    "[jeb-contract] homeserver mode=staging (creates throwaway accounts/posts on staging.pubky.app)\n",
  );
  return r;
}

async function tryStartLocalTestnet(): Promise<HarnessRuntime | null> {
  const already = await waitForAdmin(TESTNET_ADMIN_URL, 400, "probe existing");
  if (already) return writeTestnetRuntime();

  const ports = await probeStaticTestnetPorts();
  if (!ports.free) return null;

  const bin = testnetBinary();
  if (!existsSync(bin)) return null;
  if (!(await postgresReady())) return null;

  process.stderr.write(`[jeb-contract] spawning ${bin} (timeout ${timeoutMs()}ms)\n`);
  child = spawnProcessGroup(bin, [], {
    cwd: CORE,
    env: { ...process.env, TEST_PUBKY_CONNECTION_STRING: pgUrl() },
  });
  childPid = child.pid ?? 0;
  const up = await waitForAdmin(TESTNET_ADMIN_URL, timeoutMs(), "spawned testnet");
  if (up) return writeTestnetRuntime();
  await killSpawnedTestnet();
  return null;
}

export async function startHomeserver(): Promise<HarnessRuntime> {
  installSignalHandlers();
  const requested = (process.env.CONTRACT_HOMESERVER ?? "").trim().toLowerCase();

  if (requested === "staging") {
    return writeStagingRuntime();
  }

  if (requested === "pubky-testnet" || requested === "testnet") {
    const local = await tryStartLocalTestnet();
    if (local) return local;
    failFastNoHomeserver("CONTRACT_HOMESERVER=pubky-testnet but the static testnet is not reachable.");
  }

  if (requested && requested !== "") {
    failFastNoHomeserver(`Unknown CONTRACT_HOMESERVER=${requested}`);
  }

  const local = await tryStartLocalTestnet();
  if (local) return local;
  if (process.env.CONTRACT_STAGING_ADMIN_PASSWORD) {
    return writeStagingRuntime();
  }
  failFastNoHomeserver("Static testnet ports/prereqs unavailable and no staging password.");
}

export async function stopHomeserver(): Promise<void> {
  await killSpawnedTestnet();
}

export default async function globalSetup(ctx?: {
  provide: (key: "jebRuntimePath", value: string) => void;
}): Promise<() => Promise<void>> {
  if (!process.env.JEB_CONTRACT_RUNTIME) {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join: j } = await import("node:path");
    process.env.JEB_CONTRACT_RUNTIME = j(mkdtempSync(j(tmpdir(), "jeb-contract-")), "runtime.json");
  }
  ctx?.provide("jebRuntimePath", process.env.JEB_CONTRACT_RUNTIME);
  await startHomeserver();
  return async () => {
    await stopHomeserver();
  };
}
