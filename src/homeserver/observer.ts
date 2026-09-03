import type { Session } from "@synonymdev/pubky";
import { POSTS_PATH_PREFIX } from "../uri.js";
import { createPubky } from "../harness/sdk.js";

export interface ListedPost {
  path: string;
  id: string;
  uri: string;
  json: Record<string, unknown>;
}

export class HomeserverObserver {
  constructor(
    private readonly testnet: boolean,
    private readonly botPublicKey: string,
  ) {}

  private sdk() {
    return createPubky(this.testnet);
  }

  listAddress(): string {
    return `pubky${this.botPublicKey}${POSTS_PATH_PREFIX}`;
  }

  async listPosts(): Promise<ListedPost[]> {
    const sdk = this.sdk();
    const addr = this.listAddress();
    let listed: unknown;
    try {
      listed = await sdk.publicStorage.list(addr as never, null, false, 1000, false);
    } catch {
      listed = [];
    }
    const urls = normalizeList(listed);
    const out: ListedPost[] = [];
    for (const url of urls) {
      const id = url.split("/").filter(Boolean).pop();
      if (!id) continue;
      let json: Record<string, unknown> = {};
      try {
        const got = await sdk.publicStorage.getJson(asGetAddr(url, this.botPublicKey, id));
        if (got && typeof got === "object") json = got as Record<string, unknown>;
      } catch {
        continue;
      }
      out.push({
        path: `${POSTS_PATH_PREFIX}${id}`,
        id,
        uri: `pubky://${this.botPublicKey}${POSTS_PATH_PREFIX}${id}`,
        json,
      });
    }
    return out;
  }

  async waitUntilResolvable(timeoutMs = 30_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this.sdk().publicStorage.list(this.listAddress() as never, null, false, 10, false);
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    return false;
  }

  async waitForPostCount(
    predicate: (posts: ListedPost[]) => boolean,
    timeoutMs: number,
    pollMs = 250,
  ): Promise<ListedPost[]> {
    const start = Date.now();
    let last: ListedPost[] = [];
    while (Date.now() - start < timeoutMs) {
      last = await this.listPosts();
      if (predicate(last)) return last;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return last;
  }

  async deletePosts(session: Session): Promise<void> {
    const posts = await this.listPosts();
    for (const p of posts) {
      try {
        await session.storage.delete(p.path as never);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function asGetAddr(url: string, botPk: string, id: string): never {
  if (url.startsWith("pubky://") || url.startsWith("pubky")) return url as never;
  return `pubky://${botPk}${POSTS_PATH_PREFIX}${id}` as never;
}

function normalizeList(listed: unknown): string[] {
  if (!listed) return [];
  if (Array.isArray(listed)) {
    return listed.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "url" in item) return String((item as { url: string }).url);
      return String(item);
    });
  }
  return [];
}
