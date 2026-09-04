import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fakePostId, makePostView } from "../src/fixture-nexus/index.js";
import { postUri } from "../src/uri.js";
import {
  ensureSuiteBot,
  expectOneValidReply,
  expectOneValidReplyEndingWith,
  expectStableCount,
  isStaging,
  seedMention,
  startWorld,
  stopWorld,
  waitReplies,
  type World,
} from "./helpers.js";

let world: World | null = null;

beforeAll(async () => {
  await ensureSuiteBot();
});

afterEach(async () => {
  if (world) {
    await stopWorld(world);
    world = null;
  }
});

describe("jeb-contract", () => {
  it("HAPPY: mention → one valid reply, restart does not duplicate", async () => {
    world = await startWorld({ name: "happy" });
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `hello pubky${world.botPk}`,
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
    await world.adapter.stop();
    await world.adapter.start(world.env);
    const after = await expectStableCount(world, 1);
    expectOneValidReply(after, mention.uri, world.env.cannedReply);
  });

  it("FAILURE: deleted parent 404 → no reply, later mention still answered", async () => {
    world = await startWorld({ name: "deleted-parent" });
    const gone = seedMention(world, {
      author: world.otherPk,
      content: `gone pubky${world.botPk}`,
    });
    world.nexus.deletePost(gone.uri);
    await expectStableCount(world, 0);
    const later = seedMention(world, {
      author: world.otherPk,
      content: `alive pubky${world.botPk}`,
    });
    const posts = await waitReplies(world, 1);
    expect(posts.filter((p) => p.json.parent === gone.uri)).toHaveLength(0);
    expectOneValidReply(posts, later.uri, world.env.cannedReply);
  });

  it("FAILURE: malformed notification skipped, later mention answered", async () => {
    world = await startWorld({ name: "malformed" });
    world.ts += 1000;
    world.nexus.enqueueNotification({ timestamp: world.ts, body: { type: "not-a-real-type" } });
    world.ts += 1000;
    world.nexus.enqueueNotification({
      timestamp: world.ts,
      body: { type: "mention", mentioned_by: world.otherPk },
    });
    world.ts += 1000;
    world.nexus.enqueueNotification({
      timestamp: world.ts,
      body: { type: "mention", post_uri: "not-a-uri" },
    });
    await expectStableCount(world, 0);
    const later = seedMention(world, {
      author: world.otherPk,
      content: `ok pubky${world.botPk}`,
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, later.uri, world.env.cannedReply);
  });

  it("FAILURE: transient Nexus 5xx then success → exactly one reply", async () => {
    world = await startWorld({ name: "nexus-5xx" });
    world.nexus.failNext("/notifications", 503, 3);
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `retry pubky${world.botPk}`,
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
    await expectStableCount(world, 1);
  });

  it("EDGE: 25-post ancestor chain does not crash; reply exists; created_at order if debug hook", async () => {
    world = await startWorld({ name: "ancestors" });
    let parent: string | null = null;
    let indexed = world.ts;
    const authors: string[] = [];
    for (let i = 0; i < 24; i++) {
      const author = world.otherPk;
      const id = fakePostId(8000 + i);
      indexed += 10;
      const uri = postUri(author, id);
      world.nexus.setPost(
        makePostView({
          author,
          id,
          content: `ancestor ${i}`,
          indexedAt: indexed,
          parent,
        }),
      );
      parent = uri;
      authors.push(author);
    }
    world.ts = indexed;
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `tail pubky${world.botPk}`,
      parent,
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
    const dbg = world.adapter.debugLastContext?.();
    if (dbg) {
      const times = dbg.ancestors.map((a) => a.createdAt);
      const sorted = [...times].sort((a, b) => b - a);
      expect(times).toEqual(sorted);
    }
  });

  it("EDGE: 100 duplicate overlapping notifications → exactly one reply", async () => {
    world = await startWorld({ name: "duplicates" });
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `dup pubky${world.botPk}`,
    });
    world.nexus.replay(99);
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
    await expectStableCount(world, 1);
  });

  it("EDGE: self-mention → no reply; later ordinary mention → one reply", async () => {
    world = await startWorld({ name: "self" });
    seedMention(world, {
      author: world.botPk,
      content: `I mention myself pubky${world.botPk}`,
    });
    await expectStableCount(world, 0);
    const later = seedMention(world, {
      author: world.otherPk,
      content: `other pubky${world.botPk}`,
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, later.uri, world.env.cannedReply);
  });

  it("EDGE: bot-to-bot loop respects maxRepliesPerThread (explicit 1)", async () => {
    world = await startWorld({ name: "loop", maxRepliesPerThread: 1 });
    const first = seedMention(world, {
      author: world.otherPk,
      content: `start pubky${world.botPk}`,
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReplyEndingWith(posts, first.uri, world.env.cannedReply);
    seedMention(world, {
      author: world.otherPk,
      content: `loop pubky${world.botPk}`,
      parent: first.uri,
    });
    const after = await expectStableCount(world, 1);
    expect(after).toHaveLength(1);
  });

  it("EDGE: modelDelayMs honored; later mention still processed within budget", async () => {
    world = await startWorld({ name: "delay", modelDelayMs: 400 });
    const a = seedMention(world, {
      author: world.otherPk,
      content: `slow pubky${world.botPk}`,
    });
    await new Promise((r) => setTimeout(r, 80));
    const b = seedMention(world, {
      author: world.otherPk,
      content: `fast-follow pubky${world.botPk}`,
    });
    const t0 = Date.now();
    const posts = await waitReplies(world, 2);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(isStaging() ? 70_000 : 8_000);
    expectOneValidReply(posts, a.uri, world.env.cannedReply);
    expectOneValidReply(posts, b.uri, world.env.cannedReply);
  });

  it("FAILURE: crash after successful publish → restart does not second-reply; later mention answered", async () => {
    world = await startWorld({ name: "crash" });
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `crash pubky${world.botPk}`,
    });
    await waitReplies(world, 1);
    await world.adapter.stop();
    await world.adapter.start(world.env);
    await expectStableCount(world, 1);
    const later = seedMention(world, {
      author: world.otherPk,
      content: `post-crash pubky${world.botPk}`,
    });
    const posts = await waitReplies(world, 2);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
    expectOneValidReply(posts, later.uri, world.env.cannedReply);
  });

  it("EDGE: start/end boundary re-delivery → one reply", async () => {
    world = await startWorld({ name: "redelivery" });
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `boundary pubky${world.botPk}`,
    });
    await waitReplies(world, 1);
    world.nexus.replay(1);
    await expectStableCount(world, 1);
    const later = seedMention(world, {
      author: world.otherPk,
      content: `after-boundary pubky${world.botPk}`,
    });
    const posts = await waitReplies(world, 2);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
    expectOneValidReply(posts, later.uri, world.env.cannedReply);
  });

  it("EDGE: legacy pk: mention prefix handled", async () => {
    world = await startWorld({ name: "pk-prefix" });
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `hey pk:${world.botPk} please answer`,
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
  });

  it("EDGE: mention inside kind long post handled", async () => {
    world = await startWorld({ name: "long" });
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `${"x".repeat(2100)} pubky${world.botPk}`,
      kind: "long",
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
  });

  it("EDGE: mention in a reply whose parent is a repost — no crash, then ordinary mention answered", async () => {
    world = await startWorld({ name: "repost-parent" });
    const originalId = fakePostId(9001);
    const originalUri = postUri(world.otherPk, originalId);
    world.nexus.setPost(
      makePostView({
        author: world.otherPk,
        id: originalId,
        content: "original",
        indexedAt: world.ts,
      }),
    );
    const repostId = fakePostId(9002);
    const repostUri = postUri(world.otherPk, repostId);
    world.ts += 10;
    world.nexus.setPost(
      makePostView({
        author: world.otherPk,
        id: repostId,
        content: "",
        kind: "short",
        indexedAt: world.ts,
        reposted: originalUri,
      }),
    );
    const mention = seedMention(world, {
      author: world.otherPk,
      content: `on repost pubky${world.botPk}`,
      parent: repostUri,
    });
    const posts = await waitReplies(world, 1);
    expectOneValidReply(posts, mention.uri, world.env.cannedReply);
    const later = seedMention(world, {
      author: world.otherPk,
      content: `ordinary pubky${world.botPk}`,
    });
    const both = await waitReplies(world, 2);
    expectOneValidReply(both, later.uri, world.env.cannedReply);
  });
});
