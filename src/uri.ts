export const POSTS_PATH_PREFIX = "/pub/pubky.app/posts/";

export const STATIC_TESTNET_HOMESERVER_PK =
  "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";

export const STAGING_HOMESERVER_PK =
  "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";

export const STAGING_ADMIN_URL =
  "https://admin.homeserver.staging.pubky.app/generate_signup_token";

export function parsePostUri(uri: string): { author: string; postId: string } {
  const m = /^pubky:\/\/([a-z0-9]{52})\/pub\/pubky\.app\/posts\/([A-Z0-9]{13})$/i.exec(
    uri.trim(),
  );
  if (!m || !m[1] || !m[2]) {
    throw new Error(`Not a canonical post URI: ${uri}`);
  }
  return { author: m[1], postId: m[2] };
}

export function postUri(author: string, postId: string): string {
  return `pubky://${author}/pub/pubky.app/posts/${postId}`;
}

export function extractPubkey(input: string): string {
  const s = input.trim();
  if (s.startsWith("pk:")) return s.slice(3);
  if (s.startsWith("pubky://")) return s.slice("pubky://".length).split("/")[0] ?? s;
  if (s.startsWith("pubky") && !s.startsWith("pubky://")) return s.slice(5).split("/")[0] ?? s;
  return s;
}

/** In-band mention tokens: `pubky` + 52-char z-base-32, or legacy `pk:` + id. */
export const MENTION_RE =
  /(?:pubky|pk:)([1-9a-hj-np-z]{52})/gi;
