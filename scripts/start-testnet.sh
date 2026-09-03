#!/usr/bin/env bash
set -euo pipefail
# Start Postgres (if needed) and pubky-testnet for jeb-contract.
export TEST_PUBKY_CONNECTION_STRING="${TEST_PUBKY_CONNECTION_STRING:-postgres://postgres:postgres@127.0.0.1:55435/postgres}"
if ! docker inspect jeb-contract-pg >/dev/null 2>&1; then
  docker run -d --name jeb-contract-pg \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
    -p 55435:5432 postgres:18-alpine
fi
cd /Volumes/vibedrive/vibes-dev/pubky-core
exec cargo run -p pubky-testnet --release
