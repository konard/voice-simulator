#!/usr/bin/env bash
# Repeat the HTTP server tests under Deno to catch the intermittent hang seen
# in CI ("has been running for over 1m0s" in server.test.js / highlight.test.js).
# Usage: experiments/issue-5-deno-server-hang.sh [runs] [per-run timeout s]
set -u
runs=${1:-30}
limit=${2:-40}
cd "$(dirname "$0")/.." || exit 1
hangs=0
for i in $(seq 1 "$runs"); do
  start=$(date +%s.%N)
  timeout "$limit" deno test -A --parallel tests/server.test.js tests/highlight.test.js tests/listening-flags.test.js > /tmp/deno-hang-run.log 2>&1
  code=$?
  end=$(date +%s.%N)
  printf "run %d exit %d %ss\n" "$i" "$code" "$(awk "BEGIN{printf \"%.1f\", $end - $start}")"
  if [ "$code" -ne 0 ]; then
    hangs=$((hangs + 1))
    cp /tmp/deno-hang-run.log "/tmp/deno-hang-fail-$i.log"
  fi
done
echo "failures: $hangs of $runs"
