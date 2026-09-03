import { PubkyAppPost, PubkyAppPostKind } from "pubky-app-specs";

export interface ValidatedReply {
  content: string;
  kind: string;
  parent: string | undefined;
}

export function validatePubkyAppPost(json: unknown, expectedParent: string): ValidatedReply {
  if (!json || typeof json !== "object") {
    throw new Error("post body is not an object");
  }
  const post = PubkyAppPost.fromJson(json);
  const parent = post.parent;
  if (parent !== expectedParent) {
    throw new Error(`parent mismatch: got ${parent} expected ${expectedParent}`);
  }
  const content = post.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("post content empty");
  }
  if (content.length > 2000 && post.kind !== "long" && post.kind !== String(PubkyAppPostKind.Long)) {
    throw new Error("content > 2000 must be kind long");
  }
  return { content, kind: post.kind, parent };
}
