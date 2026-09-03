# jeb-contract

Implementation-independent **behavioral contract** for Pubky answer bots (working name **Jeb**).

It does not implement a product bot. It starts a fixture Nexus, signs a test key up on a local `pubky-testnet` homeserver, drives any adapter that implements `start`/`stop`, and asserts publish behavior by reading `/pub/pubky.app/posts/*` back through `@synonymdev/pubky`.

The tree includes `src/reference-adapter/` — a deliberately tiny poll-and-publish bot whose **only purpose is to prove this harness**. It is test infrastructure, not an answer bot.

## Requirements

- Node ≥ 20
- Docker (Postgres for pubky-testnet) and a Rust toolchain with the `pubky-core` checkout at `/Volumes/vibedrive/vibes-dev/pubky-core`
- No API keys. Staging Nexus is used only by `npm run record-fixtures` (read-only).

## How to run pubky-testnet

Homeserver public key (static testnet): `8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo`  
Admin (signup tokens): `http://127.0.0.1:6288/generate_signup_token` with header `X-Admin-Password: admin`

```bash
# Dedicated Postgres (ephemeral DBs; pubky-testnet adds ?pubky-test=true semantics via TEST_PUBKY_CONNECTION_STRING)
docker run -d --name jeb-contract-pg \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  -p 55435:5432 postgres:18-alpine

export TEST_PUBKY_CONNECTION_STRING='postgres://postgres:postgres@127.0.0.1:55435/postgres'

cd /Volumes/vibedrive/vibes-dev/pubky-core
cargo run -p pubky-testnet --release
```

Prepare a real testnet **before** `npm test` with `scripts/start-testnet.sh` (builds the release binary if needed and execs it). `npm test` never runs `cargo build` / `cargo run`. It only execs `target/release/pubky-testnet` when:

1. Admin is not already up on `:6288`
2. A bind probe shows **6881 / 15411 / 15412 / 6288** all free
3. The release binary already exists
4. Postgres is reachable (`TEST_PUBKY_CONNECTION_STRING` or `127.0.0.1:55435`)

Otherwise it goes straight to the in-process fallback homeserver (no spawn). If it does spawn, wait is capped by `CONTRACT_TESTNET_TIMEOUT_MS` (default 90000) with a stderr line every 10s. A failed spawn kills the **whole process group** (embedded PostgreSQL included) on timeout, teardown, SIGINT, and SIGTERM.

Per-run isolation: fixture Nexus and fallback homeserver bind port 0. Runtime state is a temp file (`JEB_CONTRACT_RUNTIME`, printed at setup) so two concurrent `CONTRACT_ADAPTER=… npm test` processes do not share ports or `harness-runtime.json`.

## Implement an adapter

```ts
import type { BotAdapter, ContractEnv } from "jeb-contract";

export default class MyBot implements BotAdapter {
  async start(env: ContractEnv): Promise<void> { /* poll env.nexusUrl, sign in, reply */ }
  async stop(): Promise<void> { /* halt polling */ }
  // optional:
  debugLastContext() { return { ancestors: [] }; }
}
```

`ContractEnv`:

| Field | Meaning |
| --- | --- |
| `nexusUrl` | Fixture Nexus base URL |
| `homeserverPk` | z32 homeserver key |
| `signupToken` | admin-minted invite |
| `secretKeyHex` | 32-byte bot secret |
| `pgUrl` | optional bot-owned Postgres |
| `cannedReply` | text to publish instead of a model |
| `modelDelayMs` | must delay that long before publish |
| `maxRepliesPerThread` | cap per root thread (contract default 1) |

Compile your adapter to ESM/CJS that Node can `import()`.

## Run

```bash
cd /Volumes/vibedrive/vibes-dev/jeb-contract
npm install
npm test
```

Against another bot:

```bash
CONTRACT_ADAPTER=/abs/path/to/adapter.js npm test
```

The module must `export default class` implementing `BotAdapter`, or `export const adapter`, or `export class ReferenceAdapter`.

Refresh staging shape fixtures (read-only):

```bash
npm run record-fixtures
```

## Cases

- **HAPPY mention**: consume once, fetch post + ancestors + profiles, publish exactly one valid `PubkyAppPost` with `parent` = mention URI; restart still one.
- **Deleted parent**: 404 → no reply, no crash; later mention gets one reply.
- **Malformed notification**: missing fields / wrong type skipped; later mention answered.
- **Transient Nexus 5xx**: retries then exactly one reply.
- **25-post ancestor chain**: reply exists, no crash; `debugLastContext()` created_at order if implemented.
- **100 duplicate notifications**: exactly one reply.
- **Self-mention**: no reply; later ordinary mention answered.
- **Bot-to-bot loop**: no more than `maxRepliesPerThread` (default 1) in the same thread.
- **modelDelayMs**: delay honored; a later mention still finishes within budget.
- **Publish failure**: first PUT to `/pub/pubky.app/posts/` returns 5xx (fetch intercept); still exactly one reply after retry; later mention answered.
- **Crash after publish**: stop immediately after the write, restart, no second reply; later mention answered.
- **start/end re-delivery**: overlapping poll window, one reply.
- **legacy `pk:` prefix**: mention post content uses `pk:{id}`; still replies.
- **kind long**: mention in a long post; still replies.
- **Reply-to-repost**: mention whose parent is a repost; no crash, then an ordinary mention is answered.
