/**
 * Refresh recorded staging Nexus fixtures (read-only).
 *
 *   npx tsx scripts/record-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NEXUS = process.env.NEXUS_URL ?? "https://nexus.staging.pubky.app";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/staging");

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${NEXUS}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function write(name: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + "\n");
}

async function main(): Promise<void> {
  const influencers = (await getJson("/v0/stream/users?source=influencers&limit=10")) as Array<{
    details: { id: string };
  }>;
  let chosen: string | null = null;
  let notifications: unknown = null;
  for (const u of influencers) {
    const id = u.details.id;
    const page = (await getJson(`/v0/user/${id}/notifications?limit=50`)) as Array<{
      body?: { type?: string };
    }>;
    const types = new Set(page.map((n) => n.body?.type));
    if (types.has("mention") && types.has("reply")) {
      chosen = id;
      notifications = page;
      break;
    }
  }
  if (!chosen || !notifications) {
    throw new Error("No influencer notifications page contained both mention and reply");
  }
  write("notifications.json", notifications);

  const mention = (notifications as Array<{ body: { type?: string; post_uri?: string } }>).find(
    (n) => n.body?.type === "mention" && n.body.post_uri,
  );
  if (!mention?.body.post_uri) throw new Error("mention missing post_uri");
  const m = /^pubky:\/\/([a-z0-9]+)\/pub\/pubky\.app\/posts\/([^/]+)$/i.exec(mention.body.post_uri);
  if (!m || !m[1] || !m[2]) throw new Error("bad post_uri");
  write("post.json", await getJson(`/v0/post/${m[1]}/${m[2]}`));
  write("post_details.json", await getJson(`/v0/post/${m[1]}/${m[2]}/details`));

  const reply = (notifications as Array<{ body: { type?: string; parent_post_uri?: string } }>).find(
    (n) => n.body?.type === "reply" && n.body.parent_post_uri,
  );
  if (!reply?.body.parent_post_uri) throw new Error("reply missing parent_post_uri");
  const p = /^pubky:\/\/([a-z0-9]+)\/pub\/pubky\.app\/posts\/([^/]+)$/i.exec(
    reply.body.parent_post_uri,
  );
  if (!p || !p[1] || !p[2]) throw new Error("bad parent_post_uri");
  write(
    "post_replies.json",
    await getJson(`/v0/stream/posts?source=post_replies&author_id=${p[1]}&post_id=${p[2]}&limit=10`),
  );

  write("user.json", await getJson(`/v0/user/${chosen}`));
  write("user_details.json", await getJson(`/v0/user/${chosen}/details`));

  const readme = `# Staging fixtures

Recorded **${new Date().toISOString().slice(0, 10)}** from \`${NEXUS}\` (read-only).

Source user (notifications page with both \`mention\` and \`reply\`): \`${chosen}\`

Refresh:

\`\`\`
npm run record-fixtures
\`\`\`

Files:

- \`notifications.json\` — \`GET /v0/user/{id}/notifications?limit=50\`
- \`post.json\` — \`GET /v0/post/{author}/{id}\` for a mentioned post
- \`post_details.json\` — \`GET /v0/post/{author}/{id}/details\` (flat details object, including \`lock\`)
- \`post_replies.json\` — \`GET /v0/stream/posts?source=post_replies&author_id=&post_id=\`
- \`user.json\` — \`GET /v0/user/{id}\`
- \`user_details.json\` — \`GET /v0/user/{id}/details\`
`;
  writeFileSync(join(OUT, "README.md"), readme);
  console.log(`Wrote fixtures for user ${chosen} to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
