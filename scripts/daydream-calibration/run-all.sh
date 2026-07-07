#!/usr/bin/env bash
# Calibration matrix — run the daydream loop TWICE per persona on the real model.
# For each persona: wipe .arkive, seed + run 2 passes, snapshot the store into
# test-fixtures/daydream-calibration/<persona>/. Sequential (shared .arkive).
#
#   bash scripts/daydream-calibration/run-all.sh
#
# Requires .env.local (ANTHROPIC_API_KEY + DAYDREAM_MODEL=claude-opus-4-8).
# NEVER commits .env.local (gitignored).
set -uo pipefail
export PATH="$HOME/.local/node/bin:$PATH"
cd /Users/soda2on/Arkive

set -a; . ./.env.local; set +a
: "${ANTHROPIC_API_KEY:?missing ANTHROPIC_API_KEY}"
echo "MODEL=${DAYDREAM_MODEL}  (must NOT be stub for the real run)"

mkdir -p /tmp/cal
node_modules/.bin/esbuild scripts/daydream-calibration/seed-and-run.ts \
  --bundle --platform=node --format=cjs --target=node22 --outfile=/tmp/cal/bundle.cjs
echo "bundled OK"

for k in priya marcus tomas dana; do
  echo; echo "==================== $k ===================="
  rm -rf .arkive
  if STORAGE_BACKEND=filesystem \
       SEED_FILE="scripts/daydream-calibration/seeds/$k.json" \
       OUT_FILE="/tmp/cal/$k.dump.json" \
       node /tmp/cal/bundle.cjs; then
    dest="test-fixtures/daydream-calibration/$k"
    rm -rf "$dest"; mkdir -p "$dest/arkive-store"
    cp -R .arkive/arkives/. "$dest/arkive-store/"
    cp "/tmp/cal/$k.dump.json" "$dest/dump.json"
    echo "snapshotted -> $dest"
  else
    echo "!!!! $k FAILED (exit $?) — continuing"
  fi
done
echo; echo "ALL DONE"
