#!/usr/bin/env bash
# Bring the JS pipeline template changes since <base> into this repository.
# Usage: experiments/issue-115-template-sync.sh <template-clone> <base> <comparison.tsv> [file...]
# same-base files are replaced by the template head; customized files get a
# 3-way merge (ours, base, template head) and keep conflict markers to fix by
# hand. Files given after the TSV restrict the run.
set -euo pipefail
tpl=$1
base=$2
table=$3
shift 3
repo=$(git rev-parse --show-toplevel)
only=" $* "
while IFS=$'\t' read -r status file; do
  if [ $# -gt 0 ] && [[ "$only" != *" $file "* ]]; then continue; fi
  case "$status" in
    same-base)
      cp "$tpl/$file" "$repo/$file"
      echo "updated  $file"
      ;;
    customized)
      if ! git -C "$tpl" cat-file -e "$base:$file" 2>/dev/null; then
        echo "no-base  $file"
        continue
      fi
      git -C "$tpl" show "$base:$file" > /tmp/sync-base
      if git merge-file -L ours -L base -L template "$repo/$file" /tmp/sync-base "$tpl/$file"; then
        echo "merged   $file"
      else
        echo "CONFLICT $file"
      fi
      ;;
  esac
done < "$table"
