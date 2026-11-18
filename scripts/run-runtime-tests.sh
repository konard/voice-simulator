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
  # Mode recognition (64-76s alone) goes to whichever worker finishes its
  # shard first. Which shard is shorter depends on the file list: with
  # voice-fit, shard 1/2 took 240-268s and shard 2/2 94-111s, and modes
  # behind shard 1/2 pushed macOS and Windows past 500s (issue 63).
  # mkdir is atomic, so exactly one worker claims modes.
  claim_parent=$(mktemp -d "${TMPDIR:-/tmp}/runtime-modes.XXXXXX") || exit 2
  trap 'rm -rf "${claim_parent}"' EXIT
  "$@" "${priority[@]}" || status=$?
  shard_worker() {
    local worker_status=0
    "$@" || worker_status=$?
    if mkdir "${claim_parent}/modes" 2>/dev/null; then
      "${runner[@]}" tests/recognition-modes.test.js || worker_status=$?
    fi
    return "${worker_status}"
  }
  runner=("$@")
  shard_worker "$@" --shard=1/2 "${remaining[@]}" &
  first_pid=$!
  shard_worker "$@" --shard=2/2 "${remaining[@]}" &
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
