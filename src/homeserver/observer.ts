import { Pubky, Keypair, PublicKey, type Session } from "@synonymdev/pubky";
import { STATIC_TESTNET_HOMESERVER_PK, POSTS_PATH_PREFIX } from "../uri.js";
import { readRuntime } from "../harness/runtime.js";

export interface ListedPost {
  path: string;
  id: string;
  uri: string;
  json: Record<string, unknown>;
}

export class HomeserverObserver {
  constructor(
    private readonly sdk: Pubky | null,
    private readonly botPublicKey: string,
  ) {}

  async listPosts(): Promise<ListedPost[]> {
    const runtime = readRuntime();
    if (runtime?.mode === "fallback-http" && runtime.fallbackUrl) {
      return listFromFallback(runtime.fallbackUrl, this.botPublicKey);
    }
    if (!this.sdk) return [];
    const addr = `pubky${this.botPublicKey}${POSTS_PATH_PREFIX}`;
    let listed: unknown;
    try {
      listed = await this.sdk.publicStorage.list(addr as never, null, false, 1000, false);
    } catch {
      listed = [];
    }
    const urls = normalizeList(listed);
    if (urls.length === 0 && runtime?.fallbackUrl) {
      return listFromFallback(runtime.fallbackUrl, this.botPublicKey);
    }
    const out: ListedPost[] = [];
    for (const url of urls) {
      const id = url.split("/").filter(Boolean).pop();
      if (!id) continue;
      let json: Record<string, unknown> = {};
      try {
        const got = await this.sdk.publicStorage.getJson(url as never);
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

  async waitForPostCount(
    predicate: (posts: ListedPost[]) => boolean,
    timeoutMs: number,
    pollMs = 80,
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
}

async function listFromFallback(baseUrl: string, botPk: string): Promise<ListedPost[]> {
  const res = await fetch(`${baseUrl}${POSTS_PATH_PREFIX}`, {
    headers: { "x-pubky-user": botPk },
  });
  if (!res.ok) return [];
  const urls = normalizeList(await res.json());
  const out: ListedPost[] = [];
  for (const url of urls) {
    const id = url.split("/").filter(Boolean).pop();
    if (!id) continue;
    const got = await fetch(`${baseUrl}${POSTS_PATH_PREFIX}${id}`, {
      headers: { "x-pubky-user": botPk },
    });
    if (!got.ok) continue;
    const json = (await got.json()) as Record<string, unknown>;
    out.push({
      path: `${POSTS_PATH_PREFIX}${id}`,
      id,
      uri: `pubky://${botPk}${POSTS_PATH_PREFIX}${id}`,
      json,
    });
  }
  return out;
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

export async function signupWithToken(
  sdk: Pubky,
  secretKeyHex: string,
  signupToken: string,
  homeserverPk = STATIC_TESTNET_HOMESERVER_PK,
): Promise<{ session: Session; publicKey: string; keypair: Keypair }> {
  const raw = Buffer.from(secretKeyHex, "hex");
  if (raw.length !== 32) throw new Error(`secretKeyHex must be 32 bytes, got ${raw.length}`);
  const keypair = Keypair.fromSecret(raw);
  const signer = sdk.signer(keypair);
  const homeserver = PublicKey.from(homeserverPk);
  let session: Session;
  try {
    session = await signer.signup(homeserver, signupToken);
  } catch {
    session = await signer.signin();
  }
  return { session, publicKey: keypair.publicKey.z32(), keypair };
}

export async function fetchSignupToken(
  adminHost = "127.0.0.1:6288",
  adminPassword = "admin",
): Promise<string> {
  const runtime = readRuntime();
  const hosts = [adminHost];
  if (runtime?.fallbackUrl) {
    hosts.push(runtime.fallbackUrl.replace(/^https?:\/\//, ""));
  }
  let last = "no hosts";
  for (const host of hosts) {
    try {
      const res = await fetch(`http://${host}/generate_signup_token`, {
        headers: { "X-Admin-Password": adminPassword },
      });
      const body = await res.text();
      if (res.ok) return body.trim();
      last = `${res.status} ${body}`;
    } catch (e) {
      last = String(e);
    }
  }
  if (runtime?.mode === "fallback-http") return "fallback-token";
  throw new Error(`signup token failed: ${last}`);
}
