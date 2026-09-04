/**
 * Reference adapter — TEST INFRASTRUCTURE, not a product.
 *
 * Tiny bot used only to prove the pubky-bot-contract harness: poll fixture Nexus,
 * honor cannedReply / modelDelayMs / maxRepliesPerThread, publish one
 * PubkyAppPost via @synonymdev/pubky (real SDK session.storage.putJson),
 * keep in-memory idempotency. Do not ship this as a product bot.
 */
import { Keypair, type Session } from "@synonymdev/pubky";
import { PubkyAppPostKind, PubkySpecsBuilder } from "pubky-app-specs";
import type { BotAdapter, ContractEnv, DebugLastContext } from "../adapter.js";
import { openSession } from "../harness/sdk.js";
import { extractPubkey, parsePostUri } from "../uri.js";
import type { NexusNotification, NexusPostView } from "../nexus-types.js";

export class ReferenceAdapter implements BotAdapter {
  private env: ContractEnv | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private lastPolledTimestamp = 0;
  private seen = new Set<string>();
  private repliesByRoot = new Map<string, number>();
  private inFlight = new Set<string>();
  private lastContext: DebugLastContext | undefined;
  private session: Session | null = null;
  private botPk = "";
  private pollGeneration = 0;

  debugLastContext(): DebugLastContext | undefined {
    return this.lastContext;
  }

  async start(env: ContractEnv): Promise<void> {
    this.env = env;
    this.stopped = false;
    this.pollGeneration += 1;
    const secret = Buffer.from(env.secretKeyHex, "hex");
    const keypair = Keypair.fromSecret(secret);
    this.botPk = keypair.publicKey.z32();
    this.session = await openSession({
      testnet: env.testnet,
      secretKeyHex: env.secretKeyHex,
      homeserverPk: env.homeserverPk,
      signupToken: env.signupToken,
    });
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.pollGeneration += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const start = Date.now();
    while (this.inFlight.size > 0 && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    this.inFlight.clear();
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.pollOnce();
    }, ms);
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || !this.env) return;
    const gen = this.pollGeneration;
    try {
      const url = new URL(`/v0/user/${this.botPk}/notifications`, this.env.nexusUrl);
      url.searchParams.set("limit", "20");
      if (this.lastPolledTimestamp > 0) {
        url.searchParams.set("end", String(this.lastPolledTimestamp));
      }
      const res = await fetch(url);
      if (!res.ok) {
        this.schedule(60);
        return;
      }
      const body: unknown = await res.json();
      const items = Array.isArray(body) ? (body as NexusNotification[]) : [];
      items.sort((a, b) => b.timestamp - a.timestamp);
      for (const n of items) {
        if (this.stopped || gen !== this.pollGeneration) break;
        void this.consume(n, gen);
      }
      if (items.length > 0) {
        const maxTs = Math.max(...items.map((n) => n.timestamp));
        if (maxTs > this.lastPolledTimestamp) this.lastPolledTimestamp = maxTs;
      }
    } catch {
      // keep polling
    }
    if (!this.stopped && gen === this.pollGeneration) this.schedule(40);
  }

  private async consume(n: NexusNotification, gen: number): Promise<void> {
    const body = n.body ?? {};
    if (body.type !== "mention") return;
    const postUri = typeof body.post_uri === "string" ? body.post_uri : "";
    const mentionedBy = typeof body.mentioned_by === "string" ? body.mentioned_by : "";
    if (!postUri || !mentionedBy) return;

    const idem = `${n.timestamp}:${postUri}`;
    if (this.seen.has(idem) || this.seen.has(postUri)) return;
    if (this.inFlight.has(postUri)) return;

    if (extractPubkey(mentionedBy) === this.botPk) {
      this.seen.add(postUri);
      return;
    }

    this.inFlight.add(postUri);
    try {
      if ((this.env?.modelDelayMs ?? 0) > 0) {
        await new Promise((r) => setTimeout(r, this.env!.modelDelayMs));
      }
      if (this.stopped || gen !== this.pollGeneration) return;

      const fetched = await this.fetchPostView(postUri);
      if (!fetched) return;
      if (extractPubkey(fetched.details.author) === this.botPk) {
        this.seen.add(postUri);
        return;
      }

      const chain = await this.walkAncestors(fetched);
      this.lastContext = {
        ancestors: chain.map((p) => ({ uri: p.details.uri, createdAt: p.details.indexed_at })),
      };
      const root = chain[chain.length - 1]?.details.uri ?? postUri;
      const already = this.repliesByRoot.get(root) ?? 0;
      const cap = this.env?.maxRepliesPerThread ?? 1;
      if (already >= cap) {
        this.seen.add(postUri);
        return;
      }

      for (const p of chain) {
        await this.fetchUser(p.details.author);
      }

      await this.publish(postUri);
      this.repliesByRoot.set(root, already + 1);
      this.seen.add(postUri);
      this.seen.add(idem);
    } catch {
      // leave unseen so a later poll can retry unless we already published
    } finally {
      this.inFlight.delete(postUri);
    }
  }

  private async fetchPostView(uri: string): Promise<NexusPostView | null> {
    let parsed;
    try {
      parsed = parsePostUri(uri);
    } catch {
      return null;
    }
    const url = new URL(`/v0/post/${parsed.author}/${parsed.postId}`, this.env!.nexusUrl);
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`post ${res.status}`);
    return (await res.json()) as NexusPostView;
  }

  private async walkAncestors(leaf: NexusPostView): Promise<NexusPostView[]> {
    const chain: NexusPostView[] = [leaf];
    const guard = new Set<string>([leaf.details.uri]);
    let current = leaf;
    for (let i = 0; i < 40; i++) {
      const parent = current.relationships?.replied;
      if (!parent) break;
      if (guard.has(parent)) break;
      const next = await this.fetchPostView(parent);
      if (!next) break;
      chain.push(next);
      guard.add(next.details.uri);
      current = next;
    }
    return chain;
  }

  private async fetchUser(id: string): Promise<void> {
    const url = new URL(`/v0/user/${id}`, this.env!.nexusUrl);
    await fetch(url);
    const details = new URL(`/v0/user/${id}/details`, this.env!.nexusUrl);
    await fetch(details);
  }

  private async publish(parentUri: string): Promise<void> {
    if (!this.session || !this.env) throw new Error("not started");
    const specs = new PubkySpecsBuilder(this.botPk);
    const content = this.env.cannedReply;
    const kind = content.length > 2000 ? PubkyAppPostKind.Long : PubkyAppPostKind.Short;
    const { post, meta } = specs.createPost(content, kind, parentUri, null, null);
    await this.session.storage.putJson(meta.path as never, post.toJson());
  }
}

export default ReferenceAdapter;
