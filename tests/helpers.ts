import { createHash } from "node:crypto";
import { Pubky, Keypair } from "@synonymdev/pubky";
import { expect } from "vitest";
import type { BotAdapter, ContractEnv } from "../src/adapter.js";
import {
  FixtureNexus,
  fakePostId,
  makePostView,
  makeUserView,
  mentionNotification,
} from "../src/fixture-nexus/index.js";
import { fetchSignupToken, HomeserverObserver, type ListedPost } from "../src/homeserver/observer.js";
import { loadAdapter } from "../src/harness/load-adapter.js";
import { validatePubkyAppPost } from "../src/harness/validate-post.js";
import { postUri } from "../src/uri.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function secretHexFor(label: string): string {
  return createHash("sha256").update(`jeb-contract:${label}`).digest("hex");
}

export function publicKeyFor(secretHex: string): string {
  return Keypair.fromSecret(Buffer.from(secretHex, "hex")).publicKey.z32();
}

export function runtimeMode(): string {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, "harness-runtime.json"), "utf8")) as {
      mode: string;
    };
    return j.mode;
  } catch {
    return "unknown";
  }
}

export async function requireTestnet(): Promise<void> {
  const runtime = JSON.parse(
    readFileSync(join(ROOT, "harness-runtime.json"), "utf8"),
  ) as { mode?: string; fallbackUrl?: string };
  if (runtime.mode === "fallback-http" && runtime.fallbackUrl) return;
  const tokenProbe = await fetchSignupToken().catch((e: unknown) => e);
  if (tokenProbe instanceof Error) {
    throw new Error(
      `pubky-testnet admin is not reachable; contract tests need a homeserver. ${tokenProbe.message}`,
    );
  }
}

export interface World {
  nexus: FixtureNexus;
  adapter: BotAdapter;
  observer: HomeserverObserver;
  botPk: string;
  otherPk: string;
  botSecret: string;
  env: ContractEnv;
  ts: number;
  seq: number;
}

export async function startWorld(opts: {
  name: string;
  cannedReply?: string;
  modelDelayMs?: number;
  maxRepliesPerThread?: number;
}): Promise<World> {
  await requireTestnet();
  const nexus = new FixtureNexus();
  await nexus.listen();
  const botSecret = secretHexFor(`${opts.name}:bot`);
  const otherSecret = secretHexFor(`${opts.name}:other`);
  const botPk = publicKeyFor(botSecret);
  const otherPk = publicKeyFor(otherSecret);
  const token = await fetchSignupToken();
  const runtime = JSON.parse(readFileSync(join(ROOT, "harness-runtime.json"), "utf8")) as {
    mode?: string;
  };
  const sdk = runtime.mode === "fallback-http" ? null : Pubky.testnet();

  const env: ContractEnv = {
    nexusUrl: nexus.baseUrl,
    homeserverPk: "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo",
    signupToken: token,
    secretKeyHex: botSecret,
    cannedReply: opts.cannedReply ?? `canned:${opts.name}`,
    modelDelayMs: opts.modelDelayMs ?? 0,
    maxRepliesPerThread: opts.maxRepliesPerThread ?? 1,
  };
  const adapter = await loadAdapter();
  const observer = new HomeserverObserver(sdk, botPk);
  nexus.setUser(makeUserView(botPk, "Jeb"));
  nexus.setUser(makeUserView(otherPk, "OtherBot"));
  await adapter.start(env);
  return {
    nexus,
    adapter,
    observer,
    botPk,
    otherPk,
    botSecret,
    env,
    ts: 1_700_000_000_000,
    seq: 1,
  };
}

export async function stopWorld(world: World): Promise<void> {
  await world.adapter.stop();
  await world.nexus.close();
}

export function nextId(world: World): string {
  world.seq += 1;
  return fakePostId(world.seq + Math.floor(Math.random() * 1_000_000));
}

export function seedUser(world: World, pk: string, name: string): void {
  world.nexus.setUser(makeUserView(pk, name));
}

export function seedMention(
  world: World,
  opts: {
    author: string;
    content: string;
    kind?: string;
    parent?: string | null;
    reposted?: string | null;
    timestamp?: number;
  },
): { uri: string; id: string; timestamp: number } {
  const id = nextId(world);
  const uri = postUri(opts.author, id);
  world.ts += 1000;
  const timestamp = opts.timestamp ?? world.ts;
  const mentioned = [world.botPk];
  world.nexus.setPost(
    makePostView({
      author: opts.author,
      id,
      content: opts.content,
      kind: opts.kind,
      indexedAt: timestamp,
      parent: opts.parent ?? null,
      reposted: opts.reposted ?? null,
      mentioned,
    }),
  );
  seedUser(world, opts.author, opts.author.slice(0, 8));
  world.nexus.enqueueNotification(
    mentionNotification({
      timestamp,
      mentionedBy: opts.author,
      postUri: uri,
      postKind: opts.kind ?? "short",
    }),
  );
  return { uri, id, timestamp };
}

export async function waitReplies(
  world: World,
  count: number,
  timeoutMs = 12_000,
): Promise<ListedPost[]> {
  return world.observer.waitForPostCount((p) => p.length >= count, timeoutMs);
}

export function repliesTo(posts: ListedPost[], parent: string): ListedPost[] {
  return posts.filter((p) => p.json.parent === parent);
}

export function expectOneValidReply(posts: ListedPost[], parent: string, canned: string): ListedPost {
  const hits = repliesTo(posts, parent);
  expect(hits.length, `expected exactly one reply to ${parent}, got ${hits.length}`).toBe(1);
  const reply = hits[0]!;
  const validated = validatePubkyAppPost(reply.json, parent);
  expect(validated.content).toBe(canned);
  return reply;
}

export async function expectStableCount(
  world: World,
  count: number,
  quietMs = 400,
): Promise<ListedPost[]> {
  const start = Date.now();
  let last = await world.observer.listPosts();
  while (Date.now() - start < quietMs) {
    await new Promise((r) => setTimeout(r, 80));
    last = await world.observer.listPosts();
  }
  expect(last.length).toBe(count);
  return last;
}
