import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { FallbackHomeserver } from "../homeserver/fallback.js";
import { writeRuntime, type HarnessRuntime } from "./runtime.js";
import { canConnectTcp, probeStaticTestnetPorts } from "./ports.js";
import { killProcessGroup, spawnProcessGroup } from "./process-group.js";

const CORE = "/Volumes/vibedrive/vibes-dev/pubky-core";
const HOMESERVER_PK = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const DEFAULT_TIMEOUT_MS = 90_000;

let child: ChildProcess | null = null;
let childPid = 0;
let fallback: FallbackHomeserver | null = null;
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

async function waitForAdmin(host: string, timeout: number, label: string): Promise<boolean> {
  const start = Date.now();
  let lastBeat = start;
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://${host}/generate_signup_token`, {
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
        `[jeb-contract] ${label} still waiting for admin on ${host} (${Math.round((now - start) / 1000)}s / ${timeout}ms)\n`,
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
    void killSpawnedTestnet().finally(() => {
      if (fallback) void fallback.close();
    });
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

function fallbackRuntime(fallbackUrl: string, reason: string): HarnessRuntime {
  const r: HarnessRuntime = {
    mode: "fallback-http",
    homeserverPk: HOMESERVER_PK,
    adminHost: "127.0.0.1:6288",
    pgUrl: pgUrl(),
    fallbackUrl,
    fallbackReason: reason,
  };
  writeRuntime(r);
  process.stderr.write(`[jeb-contract] using fallback homeserver (${reason.split("\n")[0]})\n`);
  return r;
}

export async function startPubkyTestnet(): Promise<HarnessRuntime> {
  installSignalHandlers();
  fallback = new FallbackHomeserver();
  const fallbackUrl = await fallback.listen();

  const already = await waitForAdmin("127.0.0.1:6288", 400, "probe existing");
  if (already) {
    const r: HarnessRuntime = {
      mode: "pubky-testnet",
      homeserverPk: HOMESERVER_PK,
      adminHost: "127.0.0.1:6288",
      pgUrl: pgUrl(),
      fallbackUrl,
    };
    writeRuntime(r);
    process.stderr.write("[jeb-contract] using already-running pubky-testnet on :6288\n");
    return r;
  }

  const ports = await probeStaticTestnetPorts();
  if (!ports.free) {
    return fallbackRuntime(
      fallbackUrl,
      `Static testnet ports already taken (${ports.blocked.join(", ")}); not spawning pubky-testnet.`,
    );
  }

  const bin = testnetBinary();
  if (!existsSync(bin)) {
    if (process.env.CONTRACT_BUILD_TESTNET === "1") {
      process.stderr.write(
        "[jeb-contract] CONTRACT_BUILD_TESTNET=1 but npm test still will not cargo-build; run scripts/start-testnet.sh first.\n",
      );
    }
    return fallbackRuntime(
      fallbackUrl,
      `No prebuilt binary at ${bin}. Prepare one with scripts/start-testnet.sh (npm test never runs cargo unless you start testnet yourself).`,
    );
  }

  if (!(await postgresReady())) {
    return fallbackRuntime(
      fallbackUrl,
      "Postgres prerequisite missing (set TEST_PUBKY_CONNECTION_STRING or start Docker via scripts/start-testnet.sh).",
    );
  }

  const env = {
    ...process.env,
    TEST_PUBKY_CONNECTION_STRING: pgUrl(),
  };
  process.stderr.write(`[jeb-contract] spawning ${bin} (timeout ${timeoutMs()}ms)\n`);
  child = spawnProcessGroup(bin, [], {
    cwd: CORE,
    env,
  });
  childPid = child.pid ?? 0;
  let log = "";
  child.stdout?.on("data", (b: Buffer) => {
    log += b.toString();
  });
  child.stderr?.on("data", (b: Buffer) => {
    log += b.toString();
  });
  child.once("exit", (code, signal) => {
    log += `\n[exit code=${code} signal=${signal}]\n`;
  });

  const up = await waitForAdmin("127.0.0.1:6288", timeoutMs(), "spawned testnet");
  if (up) {
    const r: HarnessRuntime = {
      mode: "pubky-testnet",
      homeserverPk: HOMESERVER_PK,
      adminHost: "127.0.0.1:6288",
      pgUrl: pgUrl(),
      fallbackUrl,
    };
    writeRuntime(r);
    return r;
  }

  await killSpawnedTestnet();
  return fallbackRuntime(
    fallbackUrl,
    [
      `pubky-testnet did not become reachable on 127.0.0.1:6288 within ${timeoutMs()}ms.`,
      "Process group killed.",
      "Last log excerpt:\n" + log.slice(-4000),
    ].join("\n"),
  );
}

export async function stopPubkyTestnet(): Promise<void> {
  await killSpawnedTestnet();
  if (fallback) {
    await fallback.close();
    fallback = null;
  }
}

export default async function globalSetup(ctx?: {
  provide: (key: "jebRuntimePath", value: string) => void;
}): Promise<() => Promise<void>> {
  if (!process.env.JEB_CONTRACT_RUNTIME) {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    process.env.JEB_CONTRACT_RUNTIME = join(mkdtempSync(join(tmpdir(), "jeb-contract-")), "runtime.json");
  }
  ctx?.provide("jebRuntimePath", process.env.JEB_CONTRACT_RUNTIME);
  await startPubkyTestnet();
  return async () => {
    await stopPubkyTestnet();
  };
}
