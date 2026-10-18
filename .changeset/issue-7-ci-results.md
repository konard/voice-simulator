---
'voice-simulator': patch
---

Fix the false CI results found in issue 7. The example-app preview images now render the same way on every run, so main no longer reports drift that is not there, and the images match the current UI. The preview job pushes changes with the built-in token when `RELEASE_PR_TOKEN` is not set, says what to do when a ruleset refuses that push, and its summary reports what actually happened. The example app no longer installs the unpatched `sprintf-js` (GHSA-hp3w-g68c-fv3c) or the deprecated `boolean` package, and skipped matrix jobs no longer show a raw `${{ matrix.* }}` expression in their names.
