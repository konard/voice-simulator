## Summary

`.github/actions/artifact-transport/package-lock.json` locks `fast-xml-parser@5.11.2`, which has [GHSA-474x-hrwr-fgx4](https://github.com/advisories/GHSA-474x-hrwr-fgx4) (low): quadratic CPU consumption when scanning unterminated stop-node tags, fixed in later releases. The chain is `@actions/artifact@6.3.1` → `@azure/storage-blob@12.34.0` → `@azure/core-xml@1.6.0` → `fast-xml-parser@5.11.2`. It is present at the template head `74de898`.

The Security workflow's npm audit job reports it as a warning on every run, for example in konard/voice-simulator (a repository synced with this template): `GHSA-474x-hrwr-fgx4 [low] fast-xml-parser: Quadratic CPU consumption scanning unterminated stop-node tags in fast-xml-parser@<=5.11.2; npm audit fix resolves it`.

## Reproduction

```sh
git clone https://github.com/link-foundation/js-ai-driven-development-pipeline-template
cd js-ai-driven-development-pipeline-template/.github/actions/artifact-transport
npm ls fast-xml-parser --package-lock-only
npm audit --package-lock-only
```

Output:

```
`-- @actions/artifact@6.3.1
  `-- @azure/storage-blob@12.34.0
    `-- @azure/core-xml@1.6.0
      `-- fast-xml-parser@5.11.2

fast-xml-parser  <=5.11.2
fast-xml-parser: Quadratic CPU consumption scanning unterminated stop-node tags - https://github.com/advisories/GHSA-474x-hrwr-fgx4
fix available via `npm audit fix`
1 low severity vulnerability
```

## Workaround and fix

The ranges already allow the fixed release, so only the lockfile changes:

```sh
cd .github/actions/artifact-transport
npm audit fix --package-lock-only --ignore-scripts
```

This moves `fast-xml-parser` 5.11.2 → 5.12.1, `fast-xml-builder` 1.3.1 → 1.3.2 and `is-unsafe` 2.0.2 → 2.0.3 (all MIT), and `npm audit` reports 0 vulnerabilities. The downstream change is in [konard/voice-simulator#116](https://github.com/konard/voice-simulator/pull/116) (commit `77832fa`).

To catch the next one before the Security run does, Dependabot (or Renovate) could cover the action's directory, for example a `package-ecosystem: npm` entry with `directory: /.github/actions/artifact-transport` in `.github/dependabot.yml`.
