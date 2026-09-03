import { Keypair, PublicKey, Pubky, type Session } from "@synonymdev/pubky";

let mainnetClient: Pubky | null = null;
let testnetClient: Pubky | null = null;

export function createPubky(testnet: boolean): Pubky {
  if (testnet) {
    testnetClient ??= Pubky.testnet();
    return testnetClient;
  }
  mainnetClient ??= new Pubky();
  return mainnetClient;
}

export function sanitizeHomeserverError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw
    .replace(/signup_token=[^&\s)'"]+/gi, "signup_token=<redacted>")
    .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, "<redacted>");
  return new Error(cleaned);
}

function alreadyRegistered(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /409|already exists|already registered/i.test(msg);
}

/**
 * Open a homeserver session via the real SDK. Sign in first (key may already
 * exist); sign up only when needed. Retries pkarr/homeserver resolution.
 * Never includes the signup token in thrown errors.
 */
export async function openSession(opts: {
  testnet: boolean;
  secretKeyHex: string;
  homeserverPk: string;
  signupToken: string;
  timeoutMs?: number;
}): Promise<Session> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const raw = Buffer.from(opts.secretKeyHex, "hex");
  if (raw.length !== 32) throw new Error(`secretKeyHex must be 32 bytes, got ${raw.length}`);
  const signer = createPubky(opts.testnet).signer(Keypair.fromSecret(raw));
  const hs = PublicKey.from(opts.homeserverPk);
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      return await signer.signin();
    } catch (err) {
      last = err;
    }
    try {
      return await signer.signup(hs, opts.signupToken);
    } catch (err) {
      last = err;
      if (alreadyRegistered(err)) {
        try {
          return await signer.signin();
        } catch (signinErr) {
          last = signinErr;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw sanitizeHomeserverError(last ?? new Error("homeserver session timed out"));
}
