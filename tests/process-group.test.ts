import { expect, it } from "vitest";
import {
  descendantPids,
  killProcessGroup,
  processAlive,
  spawnProcessGroup,
} from "../src/harness/process-group.js";

it("kills a detached process group including grandchild processes", async () => {
  const child = spawnProcessGroup("bash", [
    "-lc",
    "sleep 120 & sleep 120 & wait",
  ]);
  const pid = child.pid;
  expect(pid).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 300));
  expect(processAlive(pid!)).toBe(true);
  const kids = descendantPids(pid!);
  expect(kids.length).toBeGreaterThan(0);
  await killProcessGroup(pid!);
  expect(processAlive(pid!)).toBe(false);
  for (const k of kids) {
    expect(processAlive(k), `grandchild ${k} still alive`).toBe(false);
  }
});
