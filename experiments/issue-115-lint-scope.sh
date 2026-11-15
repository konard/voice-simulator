#!/usr/bin/env bash
# Issue 115: replays the lint of pull request #111 (head 7b7d63f, base
# f6bcd15) with the lint scripts before and after the fix. The old script
# filtered warnings to changed lines and passed; the fixed one reports the
# complexity warning of the WaveguideTract constructor, as main did.
# Usage: bash experiments/issue-115-lint-scope.sh (needs node_modules).
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'git -C "${repo}" worktree remove --force "${work}/pr" >/dev/null 2>&1 || true; rm -rf "${work}"' EXIT
git -C "${repo}" worktree add --detach "${work}/pr" 7b7d63f >/dev/null 2>&1
ln -s "${repo}/node_modules" "${work}/pr/node_modules"
for version in before after; do
  if [ "${version}" = before ]; then
    git -C "${repo}" show 0200c48:scripts/lint.mjs >"${work}/pr/scripts/lint.mjs"
    git -C "${repo}" show 0200c48:scripts/lint-changed-lines.mjs >"${work}/pr/scripts/lint-changed-lines.mjs"
  else
    cp "${repo}/scripts/lint.mjs" "${repo}/scripts/lint-changed-lines.mjs" "${work}/pr/scripts/"
  fi
  status=0
  (cd "${work}/pr" && LINT_BASE_REF=f6bcd15 node scripts/lint.mjs) || status=$?
  echo "== ${version} the fix: exit ${status}"
done
