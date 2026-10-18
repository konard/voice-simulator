## Summary

`examples/universal-app/package-lock.json` on template `main` (0a62b80) contains `sprintf-js` 1.1.3. That version is affected by [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) (denial of service through unbounded precision specifiers, moderate, CVE-2026-97058). The advisory has **no patched release**: it covers `<= 1.1.3`, and 1.1.3 is the latest version.

The `npm-audit` job runs `npm audit --package-lock-only --audit-level=high`, so it passes and the finding never appears as a failure or a warning. That is a false negative for anyone reading the green check. `npm audit` in `examples/universal-app` reports 8 moderate vulnerabilities, all from this one advisory.

## Chain

```
electron-builder 26 -> app-builder-lib 26 -> @electron/get 3.1.0
  -> global-agent 3.0.0 (optionalDependency) -> roarr 2.15.4 -> sprintf-js 1.1.3
```

`npm audit fix --force` proposes downgrading electron-builder to 26.5.0, which is not a fix.

## Suggested fix (applied in konard/voice-simulator#8)

```json
"overrides": { "global-agent": "^4.1.3" }
```

global-agent 4 depends on `globalthis`, `matcher`, `semver` and `serialize-error`, not `roarr`. It still exports `bootstrap()`, the only function `@electron/get` calls (`dist/cjs/proxy.js`). After the override:

- `npm audit` reports 0 vulnerabilities.
- `roarr`, `sprintf-js`, `boolean`, `detect-node`, `es6-error`, `json-stringify-safe` and `semver-compare` leave the lockfile.
- `electron-builder --dir` still downloads Electron through `@electron/get` 3.
- With `ELECTRON_GET_USE_PROXY=1`, `initializeProxy()` sets `global.GLOBAL_AGENT`.

This also removes `boolean@3.2.0`, one of the four permanent deprecation warnings in #243. That issue assumed none of them could be removed yet. The other three (glob 7, inflight, rimraf 2.6.3) still need electron-builder 27, which is `27.0.0-alpha.10` today.

Commits: https://github.com/konard/voice-simulator/commit/235355b (override) and https://github.com/konard/voice-simulator/commit/b8db519 (regression test)
