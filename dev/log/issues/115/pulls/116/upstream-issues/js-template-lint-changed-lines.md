## Summary

`npm run lint` (`scripts/lint.mjs`) keeps a warning on a pull request only when it falls on a changed line. `complexity`, `max-statements`, `max-lines-per-function`, `max-depth` and `max-params` report on the first line of the function. Editing the body of a function leaves that line unchanged, so the pull request passes. The push to `main` then runs the same check with `LINT_ALL_WARNINGS=1` (`release.yml` line 280) and fails on code that was already merged. The pull request's result is a false negative, and the failure surfaces on `main`, where nobody is reviewing.

Seen downstream in konard/voice-simulator: pull request 111 added a branch to the `Waveguide` constructor (complexity 15 to 16). The PR lint printed `1 warning(s) on unchanged lines were not reported`, and the `main` run [43737076349](https://github.com/konard/voice-simulator/actions/runs/43737076349) failed with `Constructor has a complexity of 16. Maximum allowed is 15`. The pre-commit hook would have rejected it too: lint-staged runs `eslint --max-warnings 0` on the whole staged file.

## Reproduction

The script below runs the template's own `scripts/lint.mjs` and `scripts/lint-changed-lines.mjs` (at `74de898`) in a scratch repository. A copy is in the downstream repository: [experiments/issue-115-lint-changed-lines.sh](https://github.com/konard/voice-simulator/blob/b4864053cc4de371dc60fd8511a77c1b39c0959b/experiments/issue-115-lint-changed-lines.sh). Run it with the template's `scripts/` directory as the argument and an ESLint install in `node_modules`.

```sh
mkdir scripts src
cp "$TEMPLATE/scripts/lint.mjs" "$TEMPLATE/scripts/lint-changed-lines.mjs" scripts/
echo "export default [{ files: ['**/*.js'], rules: { complexity: ['warn', 15] } }];" > eslint.config.js
echo '{"type":"module"}' > package.json
pick() { echo 'export function pick(x) {'; for i in $(seq 1 "$1"); do printf '  if (x === %s) {\n    return %s;\n  }\n' "$i" "$i"; done; echo '  return 0;'; echo '}'; }
git init -q -b main && pick 14 > src/pick.js && git add -A && git commit -qm 'complexity 15'
git update-ref refs/remotes/origin/main HEAD
git checkout -q -b feature && pick 15 > src/pick.js && git commit -qam 'complexity 16'
node scripts/lint.mjs; echo "exit $?"
LINT_ALL_WARNINGS=1 node scripts/lint.mjs; echo "exit $?"
```

Output:

```
1 warning(s) on unchanged lines were not reported. Run LINT_ALL_WARNINGS=1 npm run lint to see them.
exit 0

src/pick.js
  1:8  warning  Function 'pick' has a complexity of 16. Maximum allowed is 15  complexity
✖ 1 problem (0 errors, 1 warning)
exit 1
```

The pull request diff touches only lines 44–46. The warning is on line 1.

## Workaround

Run `LINT_ALL_WARNINGS=1 npm run lint` before merging a change to a function body. Alternatively, set `LINT_ALL_WARNINGS: '1'` on pull requests as well; that also reports the warnings that already exist in untouched files.

## Suggested fix

Filter warnings by changed **file**, not by changed line. That is the scope the pre-commit hook already enforces, because lint-staged lints whole staged files with `--max-warnings 0`. A change to the ESLint configuration, to local rules or to the manifests that pin ESLint can change the warnings in any file, so in that case report every warning. The downstream fix is in [konard/voice-simulator#116](https://github.com/konard/voice-simulator/pull/116) (commit `c5dc1df`):

```js
const LINT_CONFIG_FILE =
  /^(?:eslint\.config\.[cm]?js|eslint-rules\/.+|package(?:-lock)?\.json)$/;

export function changesLintConfig(changedFiles) {
  return [...changedFiles.keys()].some((file) => LINT_CONFIG_FILE.test(file));
}

export function filterWarningsToChangedFiles(results, changedFiles, cwd) {
  return results.map((result) => {
    const changed = changedFiles.has(relativePath(result.filePath, cwd));
    const messages = result.messages.filter(
      (message) => message.severity !== 1 || changed
    );
    // ...recount errorCount/warningCount as today
  });
}
```

In `lint.mjs`, use `null` (every warning) when `LINT_ALL_WARNINGS=1` or when `changesLintConfig(changed)` is true. Print the scope, for example `Reporting warnings in N file(s) changed since origin/main.`, so the log shows what was checked. A regression test is to lint the fixture above: the feature branch must exit 1.

The existing `message.line..message.endLine` loop cannot catch this. ESLint reports these rules at the function head (`getFunctionHeadLoc`), so `endLine` is the line of the `{`, not the end of the function. Keeping line filtering would mean mapping each warning to its enclosing function through the AST. It would still miss warnings whose cause lies outside the diff, such as a configuration change. The per-file scope is simpler and matches the hook.
