#!/usr/bin/env bash
set -euo pipefail
# Prepare and run a real static pubky-testnet for jeb-contract.
# npm test will NOT cargo-build; it only execs target/release/pubky-testnet
# when static ports are free. Use this script ahead of time.
export TEST_PUBKY_CONNECTION_STRING="${TEST_PUBKY_CONNECTION_STRING:-postgres://postgres:postgres@127.0.0.1:55435/postgres}"
if ! docker inspect jeb-contract-pg >/dev/null 2>&1; then
  docker run -d --name jeb-contract-pg \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
    -p 55435:5432 postgres:18-alpine
fi
cd /Volumes/vibedrive/vibes-dev/pubky-core
BIN=target/release/pubky-testnet
if [[ ! -x "$BIN" ]]; then
  echo "building pubky-testnet (one-time)..."
  cargo build -p pubky-testnet --release
fi
exec "$BIN"
