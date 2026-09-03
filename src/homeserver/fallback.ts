import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

/**
 * Fallback homeserver: session cookie + PUT/GET/LIST for `/pub/pubky.app/posts/*`.
 * Used only when real pubky-testnet cannot start. Not a full homeserver.
 *
 * The JS SDK talks to `https://_pubky.{z32}/...` via its testnet client, not this
 * server directly. This fallback therefore cannot drive `@synonymdev/pubky`
 * signup unless the real testnet client is mapped here. Tests that need SDK
 * publish require pubky-testnet. This server is used by HomeserverHttpStore
 * for harness-side inspection when the SDK cannot run, and as an explicit
 * last-resort PUT/GET target for a thin observer.
 */
export class FallbackHomeserver {
  private server: Server | null = null;
  private port = 0;
  private sessions = new Map<string, string>();
  private files = new Map<string, string>();
  private putFails = 0;

  failNextPuts(n: number): void {
    this.putFails = n;
  }

  get baseUrl(): string {
    if (!this.server) throw new Error("fallback homeserver not listening");
    return `http://127.0.0.1:${this.port}`;
  }

  async listen(): Promise<string> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = this.server.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    this.port = addr.port;
    return this.baseUrl;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => s.close((e) => (e ? reject(e) : resolve())));
  }

  listPosts(userPk: string): Array<{ path: string; body: string }> {
    const prefix = `/${userPk}/pub/pubky.app/posts/`;
    const out: Array<{ path: string; body: string }> = [];
    for (const [k, v] of this.files) {
      if (k.startsWith(prefix)) out.push({ path: k.slice(userPk.length + 1), body: v });
    }
    return out;
  }

  private cookie(req: IncomingMessage): string | null {
    const raw = req.headers.cookie;
    if (!raw) return null;
    const m = /session=([^;]+)/.exec(raw);
    return m?.[1] ?? null;
  }

  private userOf(req: IncomingMessage): string | null {
    const c = this.cookie(req);
    if (!c) return null;
    return this.sessions.get(c) ?? null;
  }

  private async body(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const host = req.headers.host ?? "";
    const pkMatch = /_pubky\.([a-z0-9]+)/i.exec(host);
    const headerPk = req.headers["x-pubky-user"];
    const hostPk =
      pkMatch?.[1] ?? (typeof headerPk === "string" ? headerPk : undefined);

    if (req.method === "GET" && url.pathname === "/generate_signup_token") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("fallback-token");
      return;
    }

    if (req.method === "POST" && url.pathname === "/signup") {
      const token = url.searchParams.get("signup_token") ?? "";
      void token;
      const pk = hostPk ?? url.searchParams.get("pk") ?? "unknown";
      const sid = randomBytes(16).toString("hex");
      this.sessions.set(sid, pk);
      res.writeHead(200, {
        "set-cookie": `session=${sid}; Path=/; HttpOnly`,
        "content-type": "application/json",
      });
      res.end("{}");
      return;
    }

    if (req.method === "POST" && (url.pathname === "/session" || url.pathname === "/signin")) {
      const pk = hostPk ?? "unknown";
      const sid = randomBytes(16).toString("hex");
      this.sessions.set(sid, pk);
      res.writeHead(200, {
        "set-cookie": `session=${sid}; Path=/; HttpOnly`,
        "content-type": "application/json",
      });
      res.end("{}");
      return;
    }

    const path = url.pathname;
    if (req.method === "PUT") {
      const user = this.userOf(req) ?? hostPk;
      if (!user) {
        res.writeHead(401);
        res.end("unauthorized");
        return;
      }
      if (this.putFails > 0) {
        this.putFails -= 1;
        res.writeHead(502);
        res.end("fail");
        return;
      }
      const text = await this.body(req);
      this.files.set(`/${user}${path}`, text);
      res.writeHead(201);
      res.end();
      return;
    }

    if (req.method === "GET") {
      if (path.endsWith("/")) {
        const user = hostPk ?? this.userOf(req);
        if (!user) {
          res.writeHead(404);
          res.end();
          return;
        }
        const prefix = `/${user}${path}`;
        const urls: string[] = [];
        for (const k of this.files.keys()) {
          if (k.startsWith(prefix)) {
            const id = k.slice(`/${user}`.length);
            urls.push(`pubky://${user}${id}`);
          }
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(urls));
        return;
      }
      const user = hostPk ?? this.userOf(req);
      const key = user ? `/${user}${path}` : path;
      const file = this.files.get(key);
      if (file === undefined) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(file);
      return;
    }

    res.writeHead(405);
    res.end();
  }
}
