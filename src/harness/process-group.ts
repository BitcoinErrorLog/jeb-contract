import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { execFileSync } from "node:child_process";

export function spawnProcessGroup(
  command: string,
  args: string[],
  opts: Pick<SpawnOptions, "cwd" | "env"> = {},
): ChildProcess {
  return spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function childPids(parent: number): number[] {
  try {
    const out = execFileSync("pgrep", ["-P", String(parent)], {
      encoding: "utf8",
    }).trim();
    if (!out) return [];
    return out
      .split(/\s+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 1);
  } catch {
    return [];
  }
}

export function descendantPids(root: number): number[] {
  const found: number[] = [];
  const queue = [root];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const c of childPids(pid)) {
      found.push(c);
      queue.push(c);
    }
  }
  return found;
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
  } catch {
    // process group may already be gone
  }
  try {
    process.kill(pid, sig);
  } catch {
    // leader may already be gone
  }
  for (const c of descendantPids(pid)) {
    try {
      process.kill(c, sig);
    } catch {
      // already gone
    }
  }
}

export async function killProcessGroup(pid: number, graceMs = 1500): Promise<void> {
  if (pid <= 0) return;
  signal(pid, "SIGTERM");
  const start = Date.now();
  while (Date.now() - start < graceMs) {
    const kids = descendantPids(pid);
    if (!processAlive(pid) && kids.length === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  signal(pid, "SIGKILL");
  await new Promise((r) => setTimeout(r, 50));
}
