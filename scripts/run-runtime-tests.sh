#!/usr/bin/env bash
# Schedule the expensive matching file before the ordinary file queue.
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

remaining=()
for file in tests/*.test.js; do
  if [ "${file}" != tests/voice-match.test.js ]; then
    remaining+=("${file}")
  fi
done

status=0
if [ "${runtime}" = bun ]; then
  # Bun's sequential DSP tests exceed their individual 30s limit when
  # competing with the other shard on macOS/Windows. Run matching alone
  # first; then overlap the remaining native shards as before.
  "$@" tests/voice-match.test.js || status=$?
  "$@" --shard=1/2 "${remaining[@]}" &
  first_pid=$!
  "$@" --shard=2/2 "${remaining[@]}" &
  second_pid=$!
else
  # Node/Deno parallelize files, but the alphabetically last matching
  # file otherwise starts too late to finish inside the suite deadline.
  "$@" tests/voice-match.test.js &
  first_pid=$!
  "$@" "${remaining[@]}" &
  second_pid=$!
fi

# Reap both children even when a preceding phase has failed.
wait "${first_pid}" || status=$?
wait "${second_pid}" || status=$?
exit "${status}"
