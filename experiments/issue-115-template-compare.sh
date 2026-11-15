#!/usr/bin/env bash
# Classify every CI/CD file of a pipeline template against this repository.
# Usage: experiments/issue-115-template-compare.sh <template-clone> <base-commit>
# Output (TSV): status, path
#   same-head    identical to the template head
#   same-base    identical to the base commit, outdated (fast-forward)
#   customized   differs from both (needs a 3-way merge)
#   missing      present in the template only
set -euo pipefail
tpl=$1
base=$2
repo=$(git rev-parse --show-toplevel)
cd "$tpl"
git ls-files | grep -E '^(\.github/|scripts/|tests/|\.husky/|\.changeset/config|eslint|\.prettier|\.jscpd|\.lychee|lychee|package\.json$|\.gitignore$|\.editorconfig$|\.npmrc$|\.nvmrc$|\.node-version$)' |
  while read -r f; do
    if [ ! -f "$repo/$f" ]; then
      echo -e "missing\t$f"
    elif cmp -s "$f" "$repo/$f"; then
      echo -e "same-head\t$f"
    elif git cat-file -e "$base:$f" 2>/dev/null && cmp -s <(git show "$base:$f") "$repo/$f"; then
      echo -e "same-base\t$f"
    else
      echo -e "customized\t$f"
    fi
  done
