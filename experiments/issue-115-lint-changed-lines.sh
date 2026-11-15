#!/usr/bin/env bash
# Reproduce the changed-lines lint false negative of issue 115.
#
# A pull request adds one branch to the body of a function at the complexity
# limit. ESLint reports `complexity` on the line of the function header, which
# the pull request does not touch, so a lint that keeps only warnings on
# changed lines passes the pull request; the push to main, which reports
# every warning (LINT_ALL_WARNINGS=1), fails on the same code.
#
# Usage: experiments/issue-115-lint-changed-lines.sh [SCRIPTS_DIR]
#   SCRIPTS_DIR holds lint.mjs and lint-changed-lines.mjs; default: this
#   repository's scripts/. Pass a clone of the JS pipeline template's scripts/
#   to see the false negative (`npm run lint` exits 0, main exits 1).
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
scripts=$(cd "${1:-$repo/scripts}" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

mkdir scripts src
cp "$scripts/lint.mjs" "$scripts/lint-changed-lines.mjs" scripts/
echo "export default [{ files: ['**/*.js'], rules: { complexity: ['warn', 15] } }];" >eslint.config.js
echo '{"type":"module"}' >package.json
ln -s "$repo/node_modules" node_modules
echo node_modules >.gitignore

# pick() with `branches` if-statements has a complexity of branches + 1.
pick() {
  echo 'export function pick(x) {'
  for i in $(seq 1 "$1"); do
    printf '  if (x === %s) {\n    return %s;\n  }\n' "$i" "$i"
  done
  echo '  return 0;'
  echo '}'
}

commit() { git -c user.name=repro -c user.email=repro@example.invalid commit -qam "$1"; }

git init -q -b main
pick 14 >src/pick.js
git add -A
commit 'complexity 15'
git update-ref refs/remotes/origin/main HEAD
git checkout -q -b feature
pick 15 >src/pick.js
commit 'one more branch: complexity 16'

echo '--- the pull request diff ---'
git diff -U0 main -- src/pick.js
status=0
echo '--- npm run lint on the pull request ---'
node scripts/lint.mjs || status=$?
echo "exit $status"
status=0
echo '--- LINT_ALL_WARNINGS=1, as on a push to main ---'
LINT_ALL_WARNINGS=1 node scripts/lint.mjs || status=$?
echo "exit $status"
