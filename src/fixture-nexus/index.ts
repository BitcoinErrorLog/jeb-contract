import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  NexusNotification,
  NexusPostView,
  NexusUserView,
  NexusPostDetails,
} from "../nexus-types.js";
import { parsePostUri, postUri } from "../uri.js";

export interface FailSpec {
  route: string;
  status: number;
  remaining: number;
}

function readUrl(req: IncomingMessage, host: string): URL {
  return new URL(req.url ?? "/", `http://${host}`);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(json);
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { "access-control-allow-origin": "*" });
  res.end();
}

export class FixtureNexus {
  private server: Server | null = null;
  private port = 0;
  private notifications: NexusNotification[] = [];
  private posts = new Map<string, NexusPostView>();
  private deleted = new Set<string>();
  private users = new Map<string, NexusUserView>();
  private fails: FailSpec[] = [];

  get baseUrl(): string {
    if (!this.server) throw new Error("FixtureNexus is not listening");
    return `http://127.0.0.1:${this.port}`;
  }

  enqueueNotification(n: NexusNotification): void {
    this.notifications.push(n);
  }

  setPost(view: NexusPostView): void {
    const uri = view.details.uri;
    this.deleted.delete(uri);
    this.posts.set(uri, view);
  }

  deletePost(uri: string): void {
    this.deleted.add(uri);
    this.posts.delete(uri);
  }

  setUser(view: NexusUserView): void {
    this.users.set(view.details.id, view);
  }

  failNext(route: string, status: number, times: number): void {
    this.fails.push({ route, status, remaining: times });
  }

  /** Duplicate the current notification list `duplicates` extra times (same timestamps). */
  replay(duplicates: number): void {
    const copy = this.notifications.slice();
    for (let i = 0; i < duplicates; i++) {
      this.notifications.push(...copy);
    }
  }

  clearNotifications(): void {
    this.notifications = [];
  }

  async listen(port = 0): Promise<string> {
    if (this.server) return this.baseUrl;
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, "127.0.0.1", () => resolve());
    });
    const addr = this.server.address();
    if (!addr || typeof addr === "string") throw new Error("failed to bind fixture nexus");
    this.port = addr.port;
    return this.baseUrl;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }

  private consumeFail(pathname: string, search: string): number | null {
    const key = pathname + search;
    const idx = this.fails.findIndex(
      (f) => pathname.includes(f.route) || key.includes(f.route) || f.route === pathname,
    );
    if (idx < 0) return null;
    const spec = this.fails[idx]!;
    spec.remaining -= 1;
    if (spec.remaining <= 0) this.fails.splice(idx, 1);
    return spec.status;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    try {
      const url = readUrl(req, req.headers.host ?? "127.0.0.1");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "*",
        });
        res.end();
        return;
      }
      if (req.method !== "GET") {
        send(res, 405, { error: "method not allowed" });
        return;
      }
      const failStatus = this.consumeFail(url.pathname, url.search);
      if (failStatus !== null) {
        send(res, failStatus, { error: "injected failure" });
        return;
      }
      this.routeGet(url, res);
    } catch (err) {
      send(res, 500, { error: String(err) });
    }
  }

  private routeGet(url: URL, res: ServerResponse): void {
    const parts = url.pathname.split("/").filter(Boolean);
    // /v0/user/{id}/notifications
    if (parts[0] === "v0" && parts[1] === "user" && parts[3] === "notifications" && parts[2]) {
      this.serveNotifications(parts[2], url, res);
      return;
    }
    // /v0/user/{id}/details
    if (parts[0] === "v0" && parts[1] === "user" && parts[3] === "details" && parts[2]) {
      const user = this.users.get(parts[2]);
      if (!user) {
        sendEmpty(res, 404);
        return;
      }
      send(res, 200, user.details);
      return;
    }
    // /v0/user/{id}
    if (parts[0] === "v0" && parts[1] === "user" && parts.length === 3 && parts[2]) {
      const user = this.users.get(parts[2]);
      if (!user) {
        sendEmpty(res, 404);
        return;
      }
      send(res, 200, user);
      return;
    }
    // /v0/post/{a}/{id}/details
    if (parts[0] === "v0" && parts[1] === "post" && parts[4] === "details" && parts[2] && parts[3]) {
      const uri = postUri(parts[2], parts[3]);
      if (this.deleted.has(uri)) {
        sendEmpty(res, 404);
        return;
      }
      const view = this.posts.get(uri);
      if (!view) {
        sendEmpty(res, 404);
        return;
      }
      send(res, 200, view.details);
      return;
    }
    // /v0/post/{a}/{id}
    if (parts[0] === "v0" && parts[1] === "post" && parts.length === 4 && parts[2] && parts[3]) {
      const uri = postUri(parts[2], parts[3]);
      if (this.deleted.has(uri)) {
        sendEmpty(res, 404);
        return;
      }
      const view = this.posts.get(uri);
      if (!view) {
        sendEmpty(res, 404);
        return;
      }
      send(res, 200, view);
      return;
    }
    // /v0/stream/posts?source=post_replies&author_id=&post_id=
    if (parts[0] === "v0" && parts[1] === "stream" && parts[2] === "posts") {
      this.serveReplies(url, res);
      return;
    }
    sendEmpty(res, 404);
  }

  private serveNotifications(userId: string, url: URL, res: ServerResponse): void {
    void userId;
    const skip = Number(url.searchParams.get("skip") ?? "0") || 0;
    const limit = Number(url.searchParams.get("limit") ?? "20") || 20;
    const startRaw = url.searchParams.get("start");
    const endRaw = url.searchParams.get("end");
    const start = startRaw === null || startRaw === "" ? null : Number(startRaw);
    const end = endRaw === null || endRaw === "" ? null : Number(endRaw);
    let items = this.notifications.slice();
    items = items.filter((n) => {
      if (start !== null && !Number.isNaN(start) && n.timestamp > start) return false;
      if (end !== null && !Number.isNaN(end) && n.timestamp < end) return false;
      return true;
    });
    items.sort((a, b) => b.timestamp - a.timestamp);
    send(res, 200, items.slice(skip, skip + limit));
  }

  private serveReplies(url: URL, res: ServerResponse): void {
    const source = url.searchParams.get("source");
    if (source !== "post_replies") {
      send(res, 400, { error: "unsupported source" });
      return;
    }
    const authorId = url.searchParams.get("author_id") ?? "";
    const postId = url.searchParams.get("post_id") ?? "";
    const parent = postUri(authorId, postId);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "30") || 30, 30);
    const replies: NexusPostView[] = [];
    for (const view of this.posts.values()) {
      const replied = view.relationships?.replied ?? null;
      if (replied === parent) replies.push(view);
    }
    replies.sort((a, b) => b.details.indexed_at - a.details.indexed_at);
    send(res, 200, replies.slice(0, limit));
  }
}

export function makePostView(opts: {
  author: string;
  id: string;
  content: string;
  kind?: string;
  indexedAt: number;
  parent?: string | null;
  reposted?: string | null;
  mentioned?: string[];
  attachments?: unknown[];
}): NexusPostView {
  const uri = postUri(opts.author, opts.id);
  const details: NexusPostDetails = {
    content: opts.content,
    id: opts.id,
    indexed_at: opts.indexedAt,
    author: opts.author,
    kind: opts.kind ?? "short",
    uri,
    attachments: opts.attachments ?? [],
    lock: null,
  };
  return {
    details,
    counts: { tags: 0, unique_tags: 0, replies: 0, reposts: 0 },
    tags: [],
    relationships: {
      replied: opts.parent ?? null,
      reposted: opts.reposted ?? null,
      mentioned: opts.mentioned ?? [],
    },
    bookmark: null,
  };
}

export function makeUserView(id: string, name: string): NexusUserView {
  return {
    details: {
      name,
      bio: "",
      id,
      links: [],
      status: null,
      image: null,
      indexed_at: Date.now(),
    },
    counts: {},
    tags: [],
    relationship: { following: false, followed_by: false },
  };
}

export function mentionNotification(opts: {
  timestamp: number;
  mentionedBy: string;
  postUri: string;
  postKind?: string;
}): NexusNotification {
  return {
    timestamp: opts.timestamp,
    body: {
      type: "mention",
      mentioned_by: opts.mentionedBy,
      post_uri: opts.postUri,
      post_kind: opts.postKind ?? "short",
    },
  };
}

/** 13-char Crockford-looking id unique enough for tests (not a real timestamp encode). */
export function fakePostId(n: number): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let x = (n + 1) * 1_000_003 + 0xabc;
  let s = "";
  for (let i = 0; i < 13; i++) {
    s = alphabet[x % 32] + s;
    x = Math.floor(x / 32) + i * 17;
  }
  return s;
}

export function isPostUri(uri: string): boolean {
  try {
    parsePostUri(uri);
    return true;
  } catch {
    return false;
  }
}
