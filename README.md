# pubky-bot-contract

Implementation-independent **behavioral contract** for Pubky bots that reply to mentions.

The harness starts a fixture Nexus, signs a test key up on a **real** homeserver, drives any adapter that implements `start`/`stop`, and asserts publish behavior by reading `/pub/pubky.app/posts/*` back through `@synonymdev/pubky`. Bots **must** publish with the real SDK (`session.storage.putJson`). There is no fake homeserver protocol.

Cases are the same for every bot: a mention must produce **at most one** valid `PubkyAppPost`. The harness never imports bot internals. A Kit bot's publish module is exercised **through the adapter only** (the same `CONTRACT_ADAPTER` entry the reference adapter uses). Do not import `runPublish` or other bot source from this tree.

The tree includes `src/reference-adapter/` — a deliberately tiny poll-and-publish bot whose **only purpose is to prove this harness**. It is test infrastructure, not a product bot.

Knowledge, voice, and red-team evals stay in the bot repo (`scripts/eval-*.ts`). This package covers publish, idempotency, and trust-boundary behavior only.

Directory name on disk remains `jeb-contract`. The npm package name is `pubky-bot-contract`.

## Homeserver modes

| Mode | When | SDK client |
| --- | --- | --- |
| `pubky-testnet` | Static local testnet (ports 6881 / 15411 / 15412 / 6288 free, release binary, Postgres) | `Pubky.testnet()` — `env.testnet === true` |
| `staging` | `CONTRACT_HOMESERVER=staging` or auto-selected when testnet is unavailable and `CONTRACT_STAGING_ADMIN_PASSWORD` is set | `new Pubky()` — `env.testnet === false` |

Selection if `CONTRACT_HOMESERVER` is unset: probe static ports and prereqs → testnet; else staging if the admin password env is set; otherwise **fail fast** (no silent fake).

### Staging (required on this machine when UDP 6881 is taken)

```bash
CONTRACT_HOMESERVER=staging \
CONTRACT_STAGING_ADMIN_PASSWORD="$(cat /tmp/jeb-staging-admin.pw)" \
npm test
```

- Homeserver pubky: `ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy`
- Admin: `GET https://admin.homeserver.staging.pubky.app/generate_signup_token` with `X-Admin-Password`
- The harness mints one single-use token per **new** key (lazily; already-registered keys sign in)
- **Caveat:** runs create throwaway accounts and posts on staging. Teardown best-effort `DELETE`s posts the bot published. Accounts remain (no delete-account API).

Never put the admin password or minted tokens in git, logs, or runtime JSON.

The first-PUT-fails-then-retries case is **dropped**. `@synonymdev/pubky` issues homeserver PUTs through native/WASM HTTP (not injectable `globalThis.fetch`), and the SDK has no `homeserverProxyUrl` / custom base. A fetch interceptor neither fails the real PUT nor is a supported product hook.

### Local pubky-testnet

Homeserver: `8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo`  
Admin: `http://127.0.0.1:6288/generate_signup_token` (`X-Admin-Password: admin`)

```bash
bash scripts/start-testnet.sh
```

`npm test` never runs `cargo`. It only execs `target/release/pubky-testnet` when ports are free. Spawn wait is `CONTRACT_TESTNET_TIMEOUT_MS` (default 90000) with a stderr line every 10s. A failed spawn kills the process group.

## Implement an adapter

Publish **only** via `@synonymdev/pubky`. Use `env.testnet` to pick the client. Do not read harness runtime files. Do not add `envPrefix`, `maxTurnsPerUser`, `blocklist`, or other `ContractEnv` fields until a second bot needs them in this suite.

```ts
import { Pubky, Keypair, PublicKey } from "@synonymdev/pubky";
import type { BotAdapter, ContractEnv } from "pubky-bot-contract";

export default class MyBot implements BotAdapter {
  async start(env: ContractEnv): Promise<void> {
    const pubky = env.testnet ? Pubky.testnet() : new Pubky();
    const signer = pubky.signer(Keypair.fromSecret(Buffer.from(env.secretKeyHex, "hex")));
    const hs = PublicKey.from(env.homeserverPk);
    try {
      await signer.signin();
    } catch {
      await signer.signup(hs, env.signupToken);
    }
    // poll env.nexusUrl, reply with session.storage.putJson(...)
  }
  async stop(): Promise<void> {}
}
```

`BotAdapter`: `start(env)`, `stop()`, optional `debugLastContext()`.

`ContractEnv`:

| Field | Meaning |
| --- | --- |
| `nexusUrl` | Fixture Nexus base URL |
| `homeserverPk` | z32 homeserver key |
| `signupToken` | admin-minted invite (or a reuse placeholder if the key is already registered) |
| `secretKeyHex` | 32-byte bot secret |
| `pgUrl` | optional bot-owned Postgres |
| `cannedReply` | text to publish instead of a model |
| `modelDelayMs` | must delay that long before publish |
| `maxRepliesPerThread` | cap per root thread (harness default 2; loop case sets 1) |
| `testnet` | `true` → `Pubky.testnet()`, `false` → `new Pubky()` |

Against another bot, staging plus `CONTRACT_ADAPTER` are required. Adapters may need extra env — the Kit adapter (`dist-contract/contract-adapter.js`) also requires `JEB_CONTRACT_MODE=1` and `DATABASE_URL`, and should run with `PUBKY_BOT_SECRET_KEY_FILE` unset so the harness-minted key is the only secret:

```bash
cd /Volumes/vibedrive/vibes-dev/pubky-ai-bot-kit && npm run -s build && npm run -s build:contract
cd /Volumes/vibedrive/vibes-dev/jeb-contract
env -u PUBKY_BOT_SECRET_KEY_FILE \
JEB_CONTRACT_MODE=1 \
DATABASE_URL=postgres://johncarvalho@127.0.0.1:5432/jeb_contract_test \
CONTRACT_HOMESERVER=staging \
CONTRACT_STAGING_ADMIN_PASSWORD="$(cat /tmp/jeb-staging-admin.pw)" \
CONTRACT_ADAPTER=/Volumes/vibedrive/vibes-dev/pubky-ai-bot-kit/dist-contract/contract-adapter.js \
npx vitest run tests/contract.test.ts
```

Create `jeb_contract_test` first if it does not exist. Do not echo the password file. Generic adapters that need no extra env:

```bash
CONTRACT_HOMESERVER=staging \
CONTRACT_STAGING_ADMIN_PASSWORD="$(cat /tmp/jeb-staging-admin.pw)" \
CONTRACT_ADAPTER=/abs/path/to/adapter.js \
npm test
```

Per-run isolation: fixture Nexus binds port 0; runtime JSON lives in a temp dir (`JEB_CONTRACT_RUNTIME`).

## Fixture Nexus shapes

Recorded staging envelopes live under `fixtures/staging/`. TypeScript shapes for a Kit bot author are in `src/nexus-types.ts`. Build poll/fetch code against those types, not against a live Nexus dump.

| Type | Fixture file | Request |
| --- | --- | --- |
| `NexusNotification` | `notifications.json` | `GET /v0/user/{id}/notifications` |
| `NexusPostView` / `NexusPostDetails` | `post.json`, `post_details.json` | `GET /v0/post/{author}/{id}` and `/details` |
| `NexusPostView[]` | `post_replies.json` | `GET /v0/stream/posts?source=post_replies&author_id=&post_id=` |
| `NexusUserView` / `NexusUserDetails` | `user.json`, `user_details.json` | `GET /v0/user/{id}` and `/details` |

`NexusNotification.body.type` includes `mention`, `reply`, `follow`, `tag_post`, `tag_profile`, `repost`, `post_deleted`, `post_edited`, `new_friend`, `lost_friend`, `untag_post`. Contract cases drive `mention` (and skip malformed / non-mention bodies). A mention body has `mentioned_by` and `post_uri`; a reply body has `replied_by`, `parent_post_uri`, and `reply_uri`.

`NexusPostView.details` has `content`, `id`, `indexed_at`, `author`, `kind`, `uri` (optional `attachments`, `lock`). `relationships` may include `replied`, `reposted`, `mentioned`.

Refresh fixtures with `npm run record-fixtures` (read-only against staging Nexus). See `fixtures/staging/README.md`.

## Cases

- **HAPPY mention**: consume once, fetch post + ancestors + profiles, publish exactly one valid `PubkyAppPost` with `parent` = mention URI; restart still one.
- **Deleted parent**: 404 → no reply, no crash; later mention gets one reply.
- **Malformed notification**: missing fields / wrong type skipped; later mention answered.
- **Transient Nexus 5xx**: retries then exactly one reply.
- **25-post ancestor chain**: reply exists, no crash; `debugLastContext()` created_at order if implemented.
- **100 duplicate notifications**: exactly one reply.
- **Self-mention**: no reply; later ordinary mention answered.
- **Bot-to-bot loop**: sets `maxRepliesPerThread=1` explicitly (suite default is 2 so a single reply never hits the cap). No second reply in the same thread. The one published reply may carry a bot-defined last-reply policy prefix; the canned body must still appear exactly once as a suffix. Other cases keep exact equality so padding cannot pass unnoticed.
- **modelDelayMs**: delay honored; a later mention still finishes within budget (staging budget 70s).
- **Crash after publish**: stop immediately after the write, restart, no second reply; later mention answered.
- **start/end re-delivery**: overlapping poll window, one reply.
- **legacy `pk:` prefix**: mention post content uses `pk:{id}`; still replies.
- **kind long**: mention in a long post; still replies.
- **Reply-to-repost**: mention whose parent is a repost; no crash, then an ordinary mention is answered.
