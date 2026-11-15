---
'voice-simulator': patch
---

Add the manually started workflow `Heavy checks` (issue 14) for tests that are too slow for every pull request. Such tests live in `tests/heavy/`, named `<suite>-<topic>.test.js`, and run only through `npm run test:heavy -- [--suite <name>] [--limit <n>] [--out <dir>]` (`scripts/run-heavy.mjs`), which writes `reports/heavy/summary.md` with one row per test file and shows it in the run summary; `bun test` and `deno test` now skip the folder. The first heavy test reports the render time and the real-time factor of every audio tier except `reference`. `.gitignore` now ignores only the `reports/` folder at the root, so that kept reports can be committed to `docs/reports/`. The workflow's optional `ref` input accepts a branch or tag of this repository, or a commit already on the default branch (`scripts/resolve-heavy-ref.sh`), so that a run cannot put code from a fork into the default branch's cache. The library itself does not change.
