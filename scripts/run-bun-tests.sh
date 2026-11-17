#!/usr/bin/env bash
# Two ordinary Bun processes keep the full suite within its existing CI
# budget without using Bun's subprocess-sensitive --parallel workers.
# The caller owns the suite deadline and process-group cleanup.
# Optional COMMAND [ARG...] replaces bun, for runner regression fixtures.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  set -- bun
fi

"$@" test --timeout 30000 --shard=1/2 &
first_pid=$!
"$@" test --timeout 30000 --shard=2/2 &
second_pid=$!

# Reap both processes even when the first fails. A failing second shard
# must also fail the suite, rather than leaving the first shard's status.
status=0
wait "${first_pid}" || status=$?
wait "${second_pid}" || status=$?
exit "${status}"
