#!/usr/bin/env bash
# Issue 14: checks that the regular test runs never load tests/heavy/.
# Puts a failing canary test into tests/heavy/, runs npm, Bun and Deno
# tests (a few minutes) and removes the canary again. Every run must pass
# and none may mention the canary.
# Run: bash experiments/issue-14-heavy-canary.sh
set -u
cd "$(dirname "$0")/.." || exit 1
canary=tests/heavy/zz-canary.test.js
logs=$(mktemp -d)
trap 'rm -f "$canary"' EXIT
cat > "$canary" <<'JS'
import { it } from 'test-anywhere';
it('canary from tests/heavy', () => {
  throw new Error('CANARY: tests/heavy must not run in regular test runs');
});
JS
status=0
for runner in "npm test" "bun test --timeout 30000" "deno test -A --parallel"; do
  log="$logs/${runner%% *}.log"
  $runner > "$log" 2>&1
  code=$?
  hits=$(grep -c CANARY "$log")
  echo "$runner: exit $code, canary lines $hits"
  if [ "$code" -ne 0 ] || [ "$hits" -ne 0 ]; then status=1; fi
done
echo "logs in $logs"
exit $status
