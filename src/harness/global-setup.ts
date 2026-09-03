import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FallbackHomeserver } from "../homeserver/fallback.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME_FILE = join(ROOT, "harness-runtime.json");
const CORE = "/Volumes/vibedrive/vibes-dev/pubky-core";
const PG_URL =
  process.env.TEST_PUBKY_CONNECTION_STRING ??
  "postgres://postgres:postgres@127.0.0.1:55435/postgres";

export interface HarnessRuntime {
  mode: "pubky-testnet" | "fallback-http";
  homeserverPk: string;
  adminHost: string;
  pgUrl: string;
  fallbackUrl?: string;
  fallbackReason?: string;
}

let child: ChildProcess | null = null;
let runtime: HarnessRuntime | null = null;
let fallback: FallbackHomeserver | null = null;

async function waitForAdmin(host: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
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
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function writeRuntime(r: HarnessRuntime): void {
  runtime = r;
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(RUNTIME_FILE, JSON.stringify(r, null, 2) + "\n");
}

export async function startPubkyTestnet(): Promise<HarnessRuntime> {
  fallback = new FallbackHomeserver();
  const fallbackUrl = await fallback.listen();

  const already = await waitForAdmin("127.0.0.1:6288", 800);
  if (already) {
    const r: HarnessRuntime = {
      mode: "pubky-testnet",
      homeserverPk: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
      adminHost: "127.0.0.1:6288",
      pgUrl: PG_URL,
      fallbackUrl,
    };
    writeRuntime(r);
    return r;
  }

  const env = {
    ...process.env,
    TEST_PUBKY_CONNECTION_STRING: PG_URL,
  };
  const bin = join(CORE, "target/release/pubky-testnet");
  child = spawn(bin, [], {
    cwd: CORE,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (b: Buffer) => {
    log += b.toString();
  });
  child.stderr?.on("data", (b: Buffer) => {
    log += b.toString();
  });
  const up = await waitForAdmin("127.0.0.1:6288", 8_000);
  if (up) {
    const r: HarnessRuntime = {
      mode: "pubky-testnet",
      homeserverPk: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
      adminHost: "127.0.0.1:6288",
      pgUrl: PG_URL,
      fallbackUrl,
    };
    writeRuntime(r);
    return r;
  }
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
  const reason = [
    "Real pubky-testnet could not start. Static testnet binds DHT bootstrap UDP/TCP 6881,",
    "pkarr 15411, http-relay 15412, homeserver admin 6288. This session: spawn failed or",
    "admin never became reachable (often UDP 6881 already held, e.g. by another DHT).",
    "Postgres URL: " + PG_URL,
    "Last log excerpt:\n" + log.slice(-4000),
    "Falling back to in-process HTTP homeserver for PUT/GET/LIST of /pub/pubky.app/posts/* with session cookies.",
  ].join("\n");
  const r: HarnessRuntime = {
    mode: "fallback-http",
    homeserverPk: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
    adminHost: "127.0.0.1:6288",
    pgUrl: PG_URL,
    fallbackUrl,
    fallbackReason: reason,
  };
  writeRuntime(r);
  return r;
}

export async function stopPubkyTestnet(): Promise<void> {
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
  if (fallback) {
    await fallback.close();
    fallback = null;
  }
}

export function getRuntime(): HarnessRuntime | null {
  return runtime;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await startPubkyTestnet();
  return async () => {
    await stopPubkyTestnet();
  };
}
