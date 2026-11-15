## Summary

The `Check for secrets` step in `.github/workflows/release.yml` installs a package that is now deprecated:

```yaml
run: npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 node scripts/check-secrets.mjs
```

[secretlint 14.0.0](https://github.com/secretlint/secretlint/releases/tag/v14.0.0) (2026-11-15) moved the official rules and presets into `@secretlint/core` and deprecated the rule packages. Every fresh install now prints:

```
npm warn deprecated @secretlint/secretlint-rule-preset-recommend@13.0.7: Built into secretlint v14 and later. Remove this package; the rule id still works. https://github.com/secretlint/secretlint/blob/HEAD/docs/rules/preset-recommend.md
```

Seen in konard/voice-simulator (a repository synced with this template), Checks and release run 43749293266, job "Lint and Format Check". The template head `74de898` has the same step, and `tests/ci-issue-299.test.js` and `tests/workflows-lint.test.js` assert the 13.0.7 pins.

## Reproduction

```sh
npm view @secretlint/secretlint-rule-preset-recommend deprecated
# Built into secretlint v14 and later. Remove this package; the rule id still works. ...
npm cache clean --force   # the warning is printed only when npx installs the package
npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint --version
```

## Workaround and fix

Pin only `secretlint@14.0.0`. `.secretlintrc.json` stays as it is: the [migration guide](https://github.com/secretlint/secretlint/blob/HEAD/docs/migrations/v13-to-v14.md) says the rule id `@secretlint/secretlint-rule-preset-recommend` keeps resolving from `@secretlint/core`, and v14 still supports Node.js 22 and later.

```diff
-        run: npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 node scripts/check-secrets.mjs
+        run: npx --yes -p secretlint@14.0.0 node scripts/check-secrets.mjs
```

The tests then pin `14.0.0` and assert that the preset package is not installed:

```js
it('pins secretlint 14, which has the recommended rules built in', () => {
  const cli = releaseWorkflow.match(/-p secretlint@(\d+\.\d+\.\d+)/)?.[1];
  expect(cli).toBe('14.0.0');
  expect(releaseWorkflow).not.toContain(
    '@secretlint/secretlint-rule-preset-recommend@'
  );
});
```

Checked downstream: with the unchanged config, 13.0.7 and 14.0.0 report the same GitHub and Slack test tokens through both paths of `scripts/check-secrets.mjs`, plain tracked files and gzip evidence over `--stdinFileName`. A clean scan of the repository's 1586 tracked files passes. Downstream change: [konard/voice-simulator#116](https://github.com/konard/voice-simulator/pull/116) (commit `747fe16`).
