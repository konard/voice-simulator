# Issue 115 / PR 116: false positives, false negatives, warnings and errors in CI/CD

Issue: https://github.com/konard/voice-simulator/issues/115
Pull request: https://github.com/konard/voice-simulator/pull/116
Templates compared (`data/template-*-head.txt`):

- https://github.com/link-foundation/js-ai-driven-development-pipeline-template at `74de898`
- https://github.com/link-foundation/rust-ai-driven-development-pipeline-template at `309387f`
- https://github.com/link-foundation/python-ai-driven-development-pipeline-template at `c532c17`

Best practices followed: `data/hive-mind-CI-CD-BEST-PRACTICES.md`, a copy of
https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md.

## Data in this folder

| Path                                                                       | Content                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `data/issue-115.json`, `data/issue-115-comments.json`                      | The issue and its comments                                                     |
| `data/pr-116*.json`                                                        | The PR and its conversation comments, review comments and reviews              |
| `data/ci-logs/main-runs.json`, `data/ci-logs/main-jobs.tsv`                | The five `main` runs at `0200c48` and the conclusion of every job              |
| `data/ci-logs/*-<run>.log.gz`                                              | Full logs of those five runs and of PR 111's lint job                          |
| `data/ci-logs/*.findings.txt`                                              | Every error, warning, deprecation and suppressed-warning line, by job and step |
| `data/ci-logs/annotations.tsv`                                             | Every annotation (error, warning, notice) of the `main` runs                   |
| `data/security-and-analysis.json`                                          | The repository's security settings as reported by the API                      |
| `data/repository-file-tree.txt`, `data/template-{js,rust,python}-*.txt`    | File trees and heads used for the comparison                                   |
| `data/template-js-comparison.tsv`, `data/template-js-comparison-after.tsv` | Every JS template CI/CD file classified before and after the sync              |
| `upstream-issues/*.md`                                                     | Bodies of the issues filed upstream from this PR                               |

The `data/` folder is kept as fetched. Prettier, ESLint, jscpd, the line
limit check and lychee skip it, as they skip the `data/` folders of earlier
issues.

## Timeline

All times are UTC on 2026-11-15.

| Time     | Event                                                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15:20:27 | PR 111 merged. Its lint job (43728114958) printed `1 warning(s) on unchanged lines were not reported` and passed.                                                                                                    |
| 16:43:31 | `main` at `0200c48`. Checks and release [43737076349](https://github.com/konard/voice-simulator/actions/runs/43737076349) fails: lint `Constructor has a complexity of 16` and `release-preflight` (no `NPM_TOKEN`). |
| 16:43:31 | Security [43737076272](https://github.com/konard/voice-simulator/actions/runs/43737076272) fails: `Dependency graph is disabled`. Example app, Workflows and Broken Link Checker pass with warnings.                 |
| 17:18:16 | Issue 115 opened.                                                                                                                                                                                                    |
| 17:30    | `de4e2c3` (Waveguide complexity), `c5dc1df` (lint scope).                                                                                                                                                            |
| 17:57    | `8bea06f` (deprecated packages), `355e29a` (data), `9b44404` (dependency graph), `aa00e3e` (licence exceptions), `ff9810e` (ShellCheck).                                                                             |
| 17:58    | `510bac5`, `5840cb6`: sync with the JS template.                                                                                                                                                                     |
| 18:05    | `64ce426` (chunk bytes), `d96c114` (`node:fs` warning).                                                                                                                                                              |
| 18:07    | `ae2bf5c` (Rust warnings), 18:10 `0dc302b` (Ruff), 18:14 `2925fb3` (onset rule Map).                                                                                                                                 |
| 18:16    | `5bb8199` merges `main`.                                                                                                                                                                                             |
| 18:21    | `b486405`: the lint false negative reproduced against the template, filed as template #301.                                                                                                                          |
| 18:23    | `4a1c6de`: CodeQL still flagged the Map; the onset rule becomes a `switch`. Security passes on `2ce1c4d`.                                                                                                            |
| 18:31    | `f28e23d`: previous versions install only their web build dependencies.                                                                                                                                              |
| 18:44    | `d56f2ff`: the Rust step budgets fit the 15 min backstop again (Checks and release 43746539860 had failed on it). `44e9e4a`: the WebGPU warning is asserted.                                                         |

## Requirements

| #         | Requirement                                                                                               | Where it is handled                |
| --------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| R1        | Find every false positive, false negative, warning and error in CI/CD and fix them all                    | Findings F1–F14                    |
| R2        | Use the best practices of the JS, Rust and Python templates; compare every workflow and CI script         | "Template comparison", F7, F9, F10 |
| R3        | Report in the templates the issues they share                                                             | "Upstream issues"                  |
| R4        | Follow hive-mind CI-CD-BEST-PRACTICES.md                                                                  | "Best practices"                   |
| R5        | Everything in this single pull request                                                                    | PR 116                             |
| R6 (task) | Collect data and a deep analysis in this folder: timeline, requirements, root causes, solutions, research | This file and `data/`              |
| R7 (task) | Debug output, off by default, where a root cause is unclear                                               | F3 (`DEPENDENCY_GRAPH_DEBUG=1`)    |
| R8 (task) | Report related upstream issues with a reproduction, a workaround and a fix                                | "Upstream issues"                  |
| R9 (task) | Apply each fix everywhere the problem occurs                                                              | The "Everywhere" lines below       |

## Findings

### F1. Lint passed PR 111 and failed `main` (false negative, then error)

- **Symptom:** `main` failed with `Constructor has a complexity of 16.
Maximum allowed is 15` in `src/acoustics/waveguide.js`. PR 111 had passed
  with `1 warning(s) on unchanged lines were not reported`.
- **Root cause:** `scripts/lint.mjs` kept a warning on a PR only when it
  fell on a changed line. ESLint reports `complexity`, `max-statements`,
  `max-lines-per-function`, `max-depth` and `max-params` at the function
  head (`astUtils.getFunctionHeadLoc`), and `endLine` is the line of `{`. An
  edit inside the body never touches that line. `main` runs with
  `LINT_ALL_WARNINGS=1` and saw it. The pre-commit hook would also have
  refused it: lint-staged lints whole staged files with `--max-warnings 0`.
- **Fix:** `c5dc1df`: warnings are kept for every changed file, and for all
  files when `eslint.config.*`, `eslint-rules/` or the manifests change. The
  log prints the scope. `de4e2c3` moves the wall properties out of the
  `Waveguide` constructor.
- **Tests:** `tests/lint-changed-lines.test.js`;
  `experiments/issue-115-lint-changed-lines.sh` and
  `experiments/issue-115-lint-scope.sh` reproduce the case on a scratch
  repository.
- **Everywhere:** `LINT_ALL_WARNINGS=1 npm run lint` reports 0 warnings on
  the whole tree.
- **Template:** same code, #301.

### F2. Release preflight: no npm credential (error that needs a human)

The preflight fails on `main` with the exact instruction (add `NPM_TOKEN`
for the first publish) and only warns on pull requests. `npm view
voice-simulator` still returns E404. Listed under maintainer actions.

### F3. Security: Dependency graph disabled (error that needs a human)

- **Symptom:** `Dependency graph enabled` failed on `main`. On PRs,
  `dependency-review-action` would fail for a setting, not for the change.
- **Fix:** `9b44404` (template job): the graph is probed on every event.
  PRs skip the review with a warning naming the setting; `main` and
  scheduled runs fail with it. Only a plain HTTP 403 counts as disabled;
  rate limits and unknown answers are retried. `DEPENDENCY_GRAPH_DEBUG=1`
  traces the probe (off by default).
- **State:** the SBOM endpoint still returns 404. Listed under maintainer
  actions.

### F4. Deprecated packages in the example app (warnings)

- **Symptom:** every `npm ci` of the example app warned about `inflight`,
  `glob@7`, `rimraf@2.6.3`; "Build previous versions" also warned about
  `boolean` (`example-app-43737076278.findings.txt`).
- **Root cause:** `electron-builder` 26 → `temp` 0.9.4 (latest) →
  `rimraf ~2.6.2` → `glob` 7 → `inflight`. Previous versions (v1, v2) are
  built from their own old lockfiles, which install Electron although only
  `vite build` runs.
- **Fix:** `8bea06f`: npm `overrides` route `temp`'s `rimraf` to a local
  compat shim and lift `glob`/`minimatch` past the deprecated ranges; the
  lockfile has no deprecated entries. `allowScripts` pins the install
  scripts the build needs. `f28e23d`: `scripts/build-previous-versions.mjs`
  runs `npm uninstall electron electron-builder --package-lock-only` before
  `npm ci`. `experiments/issue-115-previous-version-prune.sh` shows: v1 4
  and v2 3 deprecated entries → 0, 0 locked versions changed, `dist`
  byte-identical, `node_modules` 190 MB → 93 MB.
- **Tests:** `tests/deprecated-packages.test.js`, `tests/universal-app.test.js`
  ('installs only the web build dependencies of a previous version').

### F5. Chunk guard measured UTF-16 units, Vite measures bytes (false negative)

- **Symptom:** Vite printed `Some chunks are larger than 500 kB` on every
  build, but the repository's guard passed.
- **Root cause:** the guard used `string.length`; Vite's reporter uses
  `Buffer.byteLength`. The IPA-heavy entry and both workers (545, 525 and
  529 kB in bytes) were under 500 k code units.
- **Fix:** `64ce426`: the guard counts UTF-8 bytes, and the pronunciation
  dictionaries are their own chunk. Largest chunk: `three`, 358 kB.
  `experiments/issue-115-chunk-guard-units.mjs` reproduces the gap.

### F6. Vite warned about `node:fs/promises` three times per build

- **Root cause:** a literal dynamic `import('node:fs/promises')` in the
  engine loader is externalized by Vite to an empty browser stub (with a
  warning) and rejected by webpack.
- **Fix:** `d96c114`: `process.getBuiltinModule` (Node.js ≥ 20.16, Bun,
  Deno), falling back to a non-literal import marked `@vite-ignore` /
  `webpackIgnore`. `tests/wasm-loader.test.js` covers the `file:` path.

### F7. CI defects already fixed in the JS template (false positives and negatives)

`5840cb6` merges the template changes since the fork (tools:
`experiments/issue-115-template-sync.sh`, `-compare.sh`, `-resolve.py`):

- `artifact-transport` verifies archives; a rerun workflow restarts jobs
  GitHub never gave a runner;
- pipeline-status gates compare with `HEAD_REF`, so fork PRs are not
  treated as superseded;
- the manual changeset step no longer masks Prettier with `|| true`, and
  the preview commit no longer masks `git add`;
- the Workflows run triggers on `*.sh` and `.husky` changes (ShellCheck saw
  no script-only edit before);
- release scripts load `command-stream` and `lino-arguments` from the
  lockfile instead of downloading them at run time;
- Bun runs only `./tests`; `deno.lock` matches `package.json`;
- Pages deploy through `scripts/deploy-pages.mjs`
  (`node --throw-deprecation`), which also removes the `punycode` DEP0040
  warning of `actions/deploy-pages@v5` (actions/deploy-pages#413, #434).

### F8. ShellCheck findings in tracked scripts (false negative)

ShellCheck 0.11.0.1 reported SC2164 and SC2016 in four scripts that no run
had checked (F7, trigger paths). `ff9810e` fixes them; two intentional
single quotes get explained directives.

### F9. Rust warnings did not fail the build (false negative)

- **Root cause:** only Clippy denied warnings; rustc warnings in the wasm,
  CLI and test builds, Cargo manifest warnings and rustdoc were ignored.
- **Fix:** `ae2bf5c` (Rust template): `RUSTFLAGS=-Dwarnings`,
  `scripts/check-cargo-warnings.sh`, `cargo doc` with
  `RUSTDOCFLAGS='-D warnings'`. It found a real unresolved intra-doc link
  (`[h]`, IPA) in `aerodynamics.rs`. The wasm engine is byte-identical.
- **Follow-up:** the two new steps pushed the rust job's step budgets to
  810 s, over the 630 s (70% of 15 min) that `tests/ci-timeouts.test.js`
  allows; run 43746539860 failed on it. `d56f2ff` sets the cargo budgets
  to 60–90 s (observed: 1–5 s).

### F10. Python files were never linted (false negative)

`0dc302b` (Python template): a Ruff job (`ruff==0.17.5`, `ruff check` and
`ruff format --check`) gated by pipeline-status, and the same in
lint-staged. Nine findings fixed, including an unused `import math` in
`scripts/blender/head_model.py`.

### F11. CodeQL: unvalidated dynamic method call (error)

Once the examples were analysed again, CodeQL reported
`js/unvalidated-dynamic-method-call`: the language from a worker message
indexed `ONSETS[key]`, which also returned `Object.prototype` members.
A `Map` (`2925fb3`) still matched the query. `4a1c6de` picks the rule with
a `switch`; Security passes from `2ce1c4d`.

### F12. Licence policy failures after tracking CI lockfiles (error)

`command-stream` pulls 13 MPL-2.0 `@resvg/*` packages, and
`artifact-transport` pulls `buffers` and `chainsaw` (no licence field).
None ships in the package, the app or the engine. `aa00e3e` adds
documented exceptions and makes the policy fixtures use the rules without
the exceptions. Upstream: command-stream#237.

### F13. Expected warning printed as an error in test logs

The WebGPU fallback test printed `WebGPU synthesis failed, using the CPU`
with a stack trace into every test run. `44e9e4a` captures and asserts it.

### F14. Not actioned

- `Due to capacity constraints ... macOS arm64` is a GitHub runner notice.
- lychee's `Summary report available` is an intended pointer.
- The `echo "::error::Desktop package output was not created"` lines in the
  findings file are the script text echoed by the runner, not errors.
- A local Bun failure during the work came from a tree in mid-edit; it
  passed on the committed tree and in CI.

## Template comparison

The JS template's CI/CD files (`.github/`, `scripts/`, `tests/`, hooks and
configs) were classified against this repository
(`experiments/issue-115-template-compare.sh`):

| State        | Before (`template-js-comparison.tsv`) | After (`-after.tsv`) |
| ------------ | ------------------------------------- | -------------------- |
| same as head | 72                                    | 165                  |
| outdated     | 38                                    | 0                    |
| customized   | 43                                    | 45                   |
| missing      | 62                                    | 5                    |

The 45 customized files keep the repository's jobs (Rust, heavy,
simulation, example app, licence and dataset checks). The 5 missing files
are the template's `javascript-first` workflows and tests, and
`tests/index.test.js`, which tests the template's sample `src/`. They do not
apply here.

The Rust template contributed F9 and the Python template F10. Neither has
the changed-lines lint (F1).

## Upstream issues

| Finding | Issue                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/301 (`upstream-issues/js-template-lint-changed-lines.md`) |
| F12     | https://github.com/link-foundation/command-stream/issues/237 (`upstream-issues/command-stream-resvg-dependency.md`)                            |
| F7      | existing: https://github.com/actions/deploy-pages/issues/413, https://github.com/actions/deploy-pages/issues/434                               |

Each filed issue has a reproduction, a workaround and a suggested fix.

## Best practices (hive-mind CI-CD-BEST-PRACTICES.md)

| Principle                        | State after this PR                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Same checks locally and in CI    | PR lint scope matches the pre-commit hook (F1); Ruff runs in both (F10)                |
| Changesets                       | `.changeset/issue-115-ci-results.md` (patch)                                           |
| Lint everything that is tracked  | ShellCheck on every script (F8), Ruff on Python (F10), rustdoc (F9)                    |
| Warnings are errors              | rustc, Cargo and rustdoc (F9); Vite chunk and `node:` warnings removed (F5, F6)        |
| Lint the workflows               | actionlint 1.7.12 and zizmor pass                                                      |
| Timeouts                         | Step budgets ≤ 70% of the job backstop (F9)                                            |
| Broken pipeline or changed world | npm and dependency graph checks warn on PRs and fail `main` with instructions (F2, F3) |
| Truthful reporting               | No masked commands (F7); expected warnings asserted, not printed (F13)                 |

## Maintainer actions (cannot be done from a pull request)

Repository settings and secrets were not changed without the owner's
confirmation. Until 1 and 2 are done, `main` fails with the instruction,
and pull requests only warn.

1. **npm first publish:** add an `NPM_TOKEN` secret at
   https://github.com/konard/voice-simulator/settings/secrets/actions. After
   the first release, add a trusted publisher for `release.yml` and remove
   the token.
2. **Dependency graph:** enable it at
   https://github.com/konard/voice-simulator/settings/security_analysis.
3. **Optional:** enable Dependabot alerts and security updates
   (`data/security-and-analysis.json`).

## Research

- ESLint reports function-level rules at the function head:
  https://github.com/eslint/eslint/blob/main/lib/rules/complexity.js
  (`getFunctionHeadLoc`).
- Vite's chunk warning uses `Buffer.byteLength`:
  https://github.com/vitejs/vite/blob/main/packages/vite/src/node/plugins/reporter.ts
- `process.getBuiltinModule`:
  https://nodejs.org/api/process.html#processgetbuiltinmoduleid
- CodeQL `js/unvalidated-dynamic-method-call`:
  https://codeql.github.com/codeql-query-help/javascript/js-unvalidated-dynamic-method-call/
- rustdoc `broken_intra_doc_links`:
  https://doc.rust-lang.org/rustdoc/lints.html#broken_intra_doc_links
- `npm uninstall --package-lock-only`:
  https://docs.npmjs.com/cli/v11/commands/npm-uninstall
- Ruff: https://docs.astral.sh/ruff/

## Libraries and tools considered

- **Lint scope:** mapping each warning to its enclosing function through
  the AST was rejected; it still misses configuration changes. The
  per-file scope matches lint-staged.
- **Deprecated packages:** `electron-builder` 27 is still an alpha; npm
  `overrides` and a local `rimraf` shim avoid it. For old versions, pruning
  the lockfile was chosen over `npm install --omit=dev` (which would drop
  `vite`) and over re-resolving (which would change the old builds).
- **Python lint:** Ruff (as the Python template), instead of flake8 + black.
- **Workflow lint:** actionlint 1.7.12 (Docker), zizmor, ShellCheck
  0.11.0.1.

## Verification

- Local: `npm test` (exit 0), the focused test files listed above,
  `npm run lint` with and without `LINT_ALL_WARNINGS=1`, Prettier,
  ShellCheck, actionlint and zizmor, and the `experiments/issue-115-*`
  scripts.
- CI on PR 116: the PR description lists the runs of the final commit.
- `main`-only paths (release, preview images, Pages) run after the merge.
  Their scripts are covered by the tests above.
