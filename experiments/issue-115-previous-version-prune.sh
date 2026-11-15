#!/usr/bin/env bash
# Does pruning the desktop packagers from a previous version's lockfile change
# its web build? (issue 115)
#
# scripts/build-previous-versions.mjs installed the whole app of an old commit,
# electron and electron-builder included, although only `vite build` runs.
# Their trees hold every deprecated package the Example app log still warned
# about (inflight, glob 7, rimraf 2, boolean). This script builds one previous
# version twice, with the lockfile as committed and with
# `npm uninstall electron electron-builder --package-lock-only`, lists the
# deprecated lockfile entries of both, and compares the two dist folders.
#
# Usage: experiments/issue-115-previous-version-prune.sh [COMMIT]
#   COMMIT defaults to the newest entry of previous-versions.json.
# Install scripts are skipped (--ignore-scripts) in both builds, so the
# experiment does not download Electron; vite build does not need them.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
commit=${1:-$(node -p "require('$repo/examples/universal-app/previous-versions.json').at(-1).commit")}
work=$(mktemp -d)
trap 'git -C "$repo" worktree remove --force "$work/full" 2>/dev/null; git -C "$repo" worktree remove --force "$work/pruned" 2>/dev/null; rm -rf "$work"' EXIT

deprecated() {
  node -e "const l=require(process.argv[1]);for(const [k,v] of Object.entries(l.packages))if(v.deprecated)console.log('  '+k)" "$1/examples/universal-app/package-lock.json"
}

for variant in full pruned; do
  git -C "$repo" worktree add -q --detach "$work/$variant" "$commit"
  app="$work/$variant/examples/universal-app"
  if [ "$variant" = pruned ]; then
    (cd "$app" && npm uninstall electron electron-builder --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null)
  fi
  echo "--- $variant: deprecated lockfile entries"
  deprecated "$work/$variant"
  (cd "$app" && npm ci --ignore-scripts --no-audit --no-fund 2>&1 | grep -c 'npm warn deprecated' | sed 's/^/  npm ci deprecation warnings: /') || true
  (cd "$app" && GITHUB_PAGES=false npm run build >/dev/null 2>&1)
  (cd "$app/dist" && find . -type f -print0 | sort -z | xargs -0 sha256sum) >"$work/$variant.sha"
  echo "  dist files: $(wc -l <"$work/$variant.sha"), node_modules: $(du -sh "$app/node_modules" | cut -f1)"
done

echo "--- pruned entries that changed version or integrity (expected: none)"
node -e "
const [full, pruned] = process.argv.slice(1).map((dir) => require(dir + '/examples/universal-app/package-lock.json').packages);
let changed = 0;
for (const [key, entry] of Object.entries(pruned)) {
  if (key && (full[key]?.version !== entry.version || full[key]?.integrity !== entry.integrity)) {
    console.log('  ' + key + ' ' + full[key]?.version + ' -> ' + entry.version);
    changed++;
  }
}
console.log('  ' + changed + ' changed, ' + (Object.keys(full).length - Object.keys(pruned).length) + ' removed');
process.exitCode = changed ? 1 : 0;
" "$work/full" "$work/pruned"

if cmp -s "$work/full.sha" "$work/pruned.sha"; then
  echo "dist is byte-identical"
else
  echo "dist differs:"
  diff "$work/full.sha" "$work/pruned.sha" || true
  exit 1
fi
