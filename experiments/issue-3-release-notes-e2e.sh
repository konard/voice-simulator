#!/usr/bin/env bash
# Run scripts/format-release-notes.mjs against a stub gh and print the body it
# would PATCH onto the release: a multi-paragraph entry with a nested list, a
# rule, a literal \n and quotes must come out unchanged, with both PRs linked.
# Needs network for the use-m bootstrap. Usage: bash experiments/issue-3-release-notes-e2e.sh
set -euo pipefail
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
mkdir "$dir/bin"
cat > "$dir/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$RN_DIR/calls"
case "$*" in
  *"-X PATCH"*) cat > "$RN_DIR/payload.json" ;;
  *commits/68f606a/pulls*) echo '[{"number":41,"title":"Fix things"}]' ;;
  *commits/def5678/pulls*) echo '[{"number":42,"title":"More"}]' ;;
  *releases/7*) node -e 'console.log(JSON.stringify({ body: require("fs").readFileSync(process.env.RN_DIR + "/body.md", "utf8") }))' ;;
esac
STUB
chmod +x "$dir/bin/gh"
printf '%s\n' '### Patch Changes' '' '- 68f606a: First change.' '' '  Second paragraph.' '' \
  '  - nested' '' '  ---' '' '  After a rule, with `\n` and a "quote"' '- def5678: Second entry' > "$dir/body.md"
RN_DIR="$dir" PATH="$dir/bin:$PATH" node scripts/format-release-notes.mjs \
  --release-id 7 --release-version v1.2.3 --repository owner/repo
echo '--- body sent to the release ---'
node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).body)' "$dir/payload.json"
