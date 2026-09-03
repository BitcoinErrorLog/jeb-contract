import { readRuntime } from "./runtime.js";
import { STAGING_ADMIN_URL } from "../uri.js";

const TESTNET_ADMIN_URL = "http://127.0.0.1:6288/generate_signup_token";

/**
 * Mint a single-use signup token. Never logs the password or the token.
 */
export async function mintSignupToken(): Promise<string> {
  const runtime = readRuntime();
  if (!runtime) throw new Error("harness runtime not initialized");
  const url = runtime.mode === "staging" ? STAGING_ADMIN_URL : TESTNET_ADMIN_URL;
  const password =
    runtime.mode === "staging"
      ? process.env.CONTRACT_STAGING_ADMIN_PASSWORD
      : "admin";
  if (!password) {
    throw new Error("CONTRACT_STAGING_ADMIN_PASSWORD is required to mint a staging signup token");
  }
  const res = await fetch(url, {
    headers: { "X-Admin-Password": password },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`signup token mint failed: HTTP ${res.status}`);
  }
  const token = body.trim();
  if (!token) throw new Error("signup token mint returned an empty body");
  return token;
}
