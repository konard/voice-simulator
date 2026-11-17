#!/usr/bin/env bash
# Schedule expensive fitting files before the ordinary file queue.
# The caller owns the suite deadline and process-group cleanup.
# Usage: bash scripts/run-runtime-tests.sh node|deno|bun [COMMAND ARG...]
# An optional command replaces the runtime for runner regression fixtures.
set -uo pipefail

runtime=${1:-}
if [ "$#" -gt 0 ]; then shift; fi
if [ "$#" -eq 0 ]; then set -- "${runtime}"; fi
case "${runtime}" in
  node) set -- "$@" --test --test-timeout=30000 ;;
  deno) set -- "$@" test -A --parallel ;;
  bun) set -- "$@" test --timeout 30000 ;;
  *) echo 'Expected runtime: node, deno or bun' >&2; exit 2 ;;
esac

priority=(tests/voice-match.test.js)
if [ "${runtime}" = node ]; then
  priority+=(tests/voice-fit.test.js)
fi
remaining=()
for file in tests/*.test.js; do
  if [ "${file}" != tests/voice-match.test.js ] &&
    { [ "${runtime}" != node ] || [ "${file}" != tests/voice-fit.test.js ]; } &&
    { [ "${runtime}" != bun ] || [ "${file}" != tests/recognition-modes.test.js ]; }; then
    remaining+=("${file}")
  fi
done

status=0
if [ "${runtime}" = bun ]; then
  # Bun's sequential DSP tests exceed their individual 30s limit when
  # competing with ordinary files on macOS/Windows. Run matching alone
  # first. Keep ordinary processes: Bun's native parallel workers can lose
  # subprocess exit notifications on macOS (oven-sh/bun#45483).
  # Mode recognition otherwise adds about 100s to the longer second shard.
  # Give it to the first worker after that worker's shorter shard finishes.
  "$@" "${priority[@]}" || status=$?
  (
    worker_status=0
    "$@" --shard=1/2 "${remaining[@]}" || worker_status=$?
    "$@" tests/recognition-modes.test.js || worker_status=$?
    exit "${worker_status}"
  ) &
  first_pid=$!
  "$@" --shard=2/2 "${remaining[@]}" &
  second_pid=$!
else
  # Node's late fitting files otherwise start too close to the deadline.
  # Keep them sequential in this priority queue while ordinary files run.
  # Deno only needs the matching file started early.
  priority_flags=()
  if [ "${runtime}" = node ]; then priority_flags+=(--test-concurrency=1); fi
  "$@" "${priority_flags[@]}" "${priority[@]}" &
  first_pid=$!
  "$@" "${remaining[@]}" &
  second_pid=$!
fi
# Reap both children even when a preceding phase has failed.
wait "${first_pid}" || status=$?
wait "${second_pid}" || status=$?
exit "${status}"
