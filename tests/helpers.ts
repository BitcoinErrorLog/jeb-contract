import { createHash } from "node:crypto";
import { Keypair, type Session } from "@synonymdev/pubky";
import { expect } from "vitest";
import type { BotAdapter, ContractEnv } from "../src/adapter.js";
import {
  FixtureNexus,
  fakePostId,
  makePostView,
  makeUserView,
  mentionNotification,
} from "../src/fixture-nexus/index.js";
import { HomeserverObserver, type ListedPost } from "../src/homeserver/observer.js";
import { loadAdapter } from "../src/harness/load-adapter.js";
import { validatePubkyAppPost } from "../src/harness/validate-post.js";
import { mintSignupToken } from "../src/harness/signup.js";
import { openSession } from "../src/harness/sdk.js";
import { readRuntime } from "../src/harness/runtime.js";
import { postUri } from "../src/uri.js";

function runId(): string {
  return process.env.JEB_CONTRACT_RUN_ID ?? "run";
}

export function secretHexFor(label: string): string {
  return createHash("sha256").update(`jeb-contract:${runId()}:${label}`).digest("hex");
}

export function publicKeyFor(secretHex: string): string {
  return Keypair.fromSecret(Buffer.from(secretHex, "hex")).publicKey.z32();
}

export function runtimeMode(): string {
  return readRuntime()?.mode ?? "unknown";
}

export function isStaging(): boolean {
  return readRuntime()?.mode === "staging";
}

function replyWaitMs(): number {
  return isStaging() ? 60_000 : 12_000;
}

function quietMsDefault(): number {
  return isStaging() ? 5_000 : 400;
}

interface SuiteBot {
  secret: string;
  pk: string;
  token: string;
  cleanup: Session;
}

let suiteBot: SuiteBot | null = null;

export async function ensureSuiteBot(): Promise<SuiteBot> {
  if (suiteBot) return suiteBot;
  const runtime = readRuntime();
  if (!runtime) throw new Error("harness runtime missing");
  const secret = secretHexFor("suite-bot");
  const pk = publicKeyFor(secret);
  const token = await mintSignupToken();
  const session = await openSession({
    testnet: runtime.testnet,
    secretKeyHex: secret,
    homeserverPk: runtime.homeserverPk,
    signupToken: token,
    timeoutMs: 30_000,
  });
  const observer = new HomeserverObserver(runtime.testnet, pk);
  await observer.waitUntilResolvable(30_000);
  suiteBot = { secret, pk, token, cleanup: session };
  return suiteBot;
}

export interface World {
  nexus: FixtureNexus;
  adapter: BotAdapter;
  observer: HomeserverObserver;
  cleanupSession: Session | null;
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
  const runtime = readRuntime();
  if (!runtime) throw new Error("harness runtime missing");
  const suite = await ensureSuiteBot();
  const nexus = new FixtureNexus();
  await nexus.listen();
  const botSecret = suite.secret;
  const otherSecret = secretHexFor(`${opts.name}:other`);
  const botPk = suite.pk;
  const otherPk = publicKeyFor(otherSecret);
  const observer = new HomeserverObserver(runtime.testnet, botPk);

  const env: ContractEnv = {
    nexusUrl: nexus.baseUrl,
    homeserverPk: runtime.homeserverPk,
    signupToken: suite.token,
    secretKeyHex: botSecret,
    cannedReply: opts.cannedReply ?? `canned:${opts.name}`,
    modelDelayMs: opts.modelDelayMs ?? 0,
    maxRepliesPerThread: opts.maxRepliesPerThread ?? 1,
    testnet: runtime.testnet,
  };
  const adapter = await loadAdapter();
  nexus.setUser(makeUserView(botPk, "Jeb"));
  nexus.setUser(makeUserView(otherPk, "OtherBot"));
  await adapter.start(env);
  return {
    nexus,
    adapter,
    observer,
    cleanupSession: suite.cleanup,
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
  if (world.cleanupSession) {
    const deadline = Date.now() + (isStaging() ? 15_000 : 2_000);
    while (Date.now() < deadline) {
      await world.observer.deletePosts(world.cleanupSession);
      const left = await world.observer.listPosts();
      if (left.length === 0) break;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
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
  timeoutMs = replyWaitMs(),
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
  quietMs = quietMsDefault(),
): Promise<ListedPost[]> {
  const start = Date.now();
  let last = await world.observer.listPosts();
  while (Date.now() - start < quietMs) {
    await new Promise((r) => setTimeout(r, 150));
    last = await world.observer.listPosts();
  }
  expect(last.length).toBe(count);
  return last;
}
