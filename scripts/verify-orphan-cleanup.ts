/**
 * Prove process-group teardown: spawn a detached tree whose grandchild
 * command line contains `pubky-testnet/postgresql` (same `ps` needle as
 * the real embedded Postgres), then kill the group and require the count
 * to return to baseline.
 *
 *   npx tsx scripts/verify-orphan-cleanup.ts
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killProcessGroup, processAlive, spawnProcessGroup } from "../src/harness/process-group.js";

const PG_RE = "pubky-testnet/postgresql";

function countOrphans(): number {
  const out = execSync("ps -ax -o pid=,command=", { encoding: "utf8" });
  return out.split("\n").filter((line) => {
    if (!line.includes(PG_RE)) return false;
    if (line.includes("rg ")) return false;
    if (line.includes("verify-orphan-cleanup")) return false;
    return true;
  }).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const before = countOrphans();
  process.stderr.write(`[verify-orphan-cleanup] baseline ${PG_RE} processes: ${before}\n`);

  const dir = mkdtempSync(join(tmpdir(), "jeb-orphan-"));
  const nest = join(dir, "pubky-testnet", "postgresql");
  mkdirSync(nest, { recursive: true });
  const fakePg = join(nest, "postgres");
  writeFileSync(fakePg, "#!/bin/sh\nexec /bin/sleep 120\n", { mode: 0o755 });

  const child = spawnProcessGroup("bash", ["-lc", `"${fakePg}" 120 & wait`], {
    env: { ...process.env },
  });
  const pid = child.pid;
  if (!pid) throw new Error("spawn produced no pid");
  process.stderr.write(`[verify-orphan-cleanup] spawned pid=${pid}\n`);

  const deadline = Date.now() + 4000;
  let mid = before;
  while (Date.now() < deadline) {
    mid = countOrphans();
    if (mid > before) break;
    await sleep(50);
  }
  process.stderr.write(`[verify-orphan-cleanup] during-run count=${mid}\n`);
  if (mid <= before) {
    throw new Error("failed to start simulated embedded postgres in the process group");
  }

  await killProcessGroup(pid);
  await sleep(400);
  const after = countOrphans();
  process.stderr.write(`[verify-orphan-cleanup] after kill count=${after} leader_alive=${processAlive(pid)}\n`);
  if (after > before) {
    throw new Error(`orphan leak: before=${before} after=${after}`);
  }
  console.log(`ok baseline=${before} after=${after}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
