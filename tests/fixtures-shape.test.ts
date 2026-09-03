import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/staging");

function load(name: string): unknown {
  return JSON.parse(readFileSync(join(DIR, name), "utf8"));
}

it("recorded staging notifications include mention and reply bodies", () => {
  const page = load("notifications.json") as Array<{ timestamp: number; body: { type: string } }>;
  expect(Array.isArray(page)).toBe(true);
  expect(page.length).toBeGreaterThan(0);
  const types = new Set(page.map((n) => n.body.type));
  expect(types.has("mention")).toBe(true);
  expect(types.has("reply")).toBe(true);
  const mention = page.find((n) => n.body.type === "mention")!;
  expect(mention.body).toMatchObject({ mentioned_by: expect.any(String), post_uri: expect.stringMatching(/^pubky:\/\//) });
  const reply = page.find((n) => n.body.type === "reply")!;
  expect(reply.body).toMatchObject({
    replied_by: expect.any(String),
    parent_post_uri: expect.stringMatching(/^pubky:\/\//),
    reply_uri: expect.stringMatching(/^pubky:\/\//),
  });
});

it("recorded post view matches Nexus envelope", () => {
  const post = load("post.json") as { details: { content: string; uri: string; author: string; id: string }; relationships: unknown };
  expect(post.details.content.length).toBeGreaterThan(0);
  expect(post.details.uri).toContain("/pub/pubky.app/posts/");
  expect(post.relationships).toBeTypeOf("object");
});

it("recorded post_replies is a list of post views", () => {
  const replies = load("post_replies.json") as Array<{ details: { uri: string } }>;
  expect(Array.isArray(replies)).toBe(true);
  expect(replies[0]?.details.uri).toContain("/pub/pubky.app/posts/");
});

it("recorded user view and details", () => {
  const user = load("user.json") as { details: { id: string; name: string } };
  const details = load("user_details.json") as { id: string; name: string };
  expect(user.details.id).toMatch(/^[a-z0-9]{52}$/);
  expect(details.id).toBe(user.details.id);
});
