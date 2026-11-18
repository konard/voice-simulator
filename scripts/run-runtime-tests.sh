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
remaining=()
for file in tests/*.test.js; do
  if [ "${file}" != tests/voice-match.test.js ] &&
    { [ "${runtime}" != node ] || [ "${file}" != tests/voice-fit.test.js ]; } &&
    { [ "${runtime}" = deno ] || [ "${file}" != tests/recognition-modes.test.js ]; }; then
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
elif [ "${runtime}" = node ]; then
  # Each of the six 40-render matchVoice tests takes 25-40s on Node
  # (spec item 10), and Node runs one file's tests sequentially. In one
  # process with voice-fit the fitting files needed 283s of a 300s budget
  # on macOS and did not finish on Windows, where recognition-modes started
  # after 180s of ordinary files. Start four processes at once instead:
  # the voice-match tests named by the pattern, the voice-match tests it
  # skips (so together they keep every test of the file), voice-fit then
  # recognition-modes, and the ordinary files.
  split='matches a'
  "$@" --test-name-pattern="${split}" "${priority[@]}" &
  first_pid=$!
  "$@" --test-skip-pattern="${split}" "${priority[@]}" &
  rest_pid=$!
  "$@" --test-concurrency=1 tests/voice-fit.test.js \
    tests/recognition-modes.test.js &
  fitting_pid=$!
  "$@" "${remaining[@]}" &
  second_pid=$!
else
  # Deno only needs the matching file started early.
  "$@" "${priority[@]}" &
  first_pid=$!
  "$@" "${remaining[@]}" &
  second_pid=$!
fi
# Reap every child even when a preceding phase has failed.
wait "${first_pid}" || status=$?
wait "${second_pid}" || status=$?
if [ "${runtime}" = node ]; then
  wait "${rest_pid}" || status=$?
  wait "${fitting_pid}" || status=$?
fi
exit "${status}"
