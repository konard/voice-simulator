# Issue 3 / PR 4: false positives, false negatives, warnings and errors in CI/CD

Issue: https://github.com/konard/voice-simulator/issues/3
Pull request: https://github.com/konard/voice-simulator/pull/4
Template compared: https://github.com/link-foundation/js-ai-driven-development-pipeline-template
at `0a62b80` (`data/template-head.txt`).
Best practices followed: `data/hive-mind-CI-CD-BEST-PRACTICES.md`, a copy of
https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md.

## Data in this folder

| Path                                                                             | Content                                                                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `data/issue-3.json`, `data/issue-3-comments.json`                                | The issue and its comments (none besides the body)                                                        |
| `data/pr-4*.json`                                                                | The PR and its conversation and review comments                                                           |
| `data/ci-runs.json`                                                              | The five `main` runs at `b9bb852` named in the issue                                                      |
| `data/ci-logs/main-*.jobs.txt`                                                   | Job conclusions of each of those runs                                                                     |
| `data/ci-logs/main-*-failed.log`                                                 | `gh run view --log-failed` of the three failing runs                                                      |
| `data/ci-logs/annotations.tsv`                                                   | Every annotation (error, warning, notice) of those runs                                                   |
| `data/ci-logs/template/`                                                         | The template's own `main` runs 38049673812 (checks, failed jobs) and 38049674017 (example app)            |
| `data/repository-file-tree.txt`, `data/template-file-tree.txt`                   | File trees used for the comparison                                                                        |
| `data/template-issues.json`                                                      | Template issues read before filing new ones                                                               |
| `data/template-release-notes-e2e-before.txt`, `data/release-notes-e2e-after.txt` | Output of `experiments/issue-3-release-notes-e2e.sh` with the template's formatter and with the fixed one |
| `screenshots/example-app-split-chunks.png`                                       | The example app built after the chunk split                                                               |

The `data/` folder is kept as fetched. Prettier, ESLint, jscpd, the line
limit check and lychee skip it, the same way they skip
`docs/case-studies/*/data/`.

## Starting point

The issue lists five `main` runs at `b9bb852`. Three of them failed:

| Run                                                                                                  | Failure (from `annotations.tsv`)                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Example app [39021393300](https://github.com/konard/voice-simulator/actions/runs/39021393300)        | `configure-pages`: `Get Pages site failed ... Not Found`                                                                                                   |
| Checks and release [39021393361](https://github.com/konard/voice-simulator/actions/runs/39021393361) | `Test (deno on windows-2025)` timed out. `Release Preflight`: `npm OIDC package exchange rejected (404); configure a trusted publisher or bootstrap token` |
| Security [39021393487](https://github.com/konard/voice-simulator/actions/runs/39021393487)           | `Dependency graph is disabled for konard/voice-simulator ... A maintainer must act`                                                                        |

The issue covers more than these errors. It also asks for warnings, false
positives (red without a real fault) and false negatives (green while
something is broken). Every log was read for those too. The rest of this
document lists each finding, its root cause, the fix and how the fix is
verified.

## Requirements

| #         | Requirement (issue text)                                                                                   | Where it is handled                             |
| --------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| R1        | Find every false positive, false negative, warning and error in CI/CD and fix them all                     | Findings F1–F17 below                           |
| R2        | Use the template's best practices, comparing the full file tree of workflows and CI/CD scripts             | "Template comparison"                           |
| R3        | Report in the template any issue that it shares                                                            | Template issues #233–#244 and a comment on #234 |
| R4        | Follow hive-mind CI-CD-BEST-PRACTICES.md                                                                   | "Best practices"                                |
| R5        | Everything in this single pull request                                                                     | PR 4                                            |
| R6 (task) | Collect data and a deep analysis in this folder: requirements, root causes, solutions, research, libraries | This file and `data/`                           |
| R7 (task) | Apply each fix everywhere the problem occurs                                                               | The "everywhere" line under each finding        |

## Findings

### F1. Deno on Windows test timeout, and a cleanup error that hid it (error)

- **Symptom:** `Test (deno on windows-2025)` failed in the Changesets
  fixture test. The report showed `rmSync` `EBUSY`, not the timeout.
- **Root cause:**
  1. Under `deno test --parallel` on Windows, starting one `node.exe` took
     about 10 s. `node -e console.log` ran past its 10 s limit, and the
     fixture used 19.4 s of its 20 s limit. The traces from
     `experiments/issue-3-changeset-fixture-timing.mjs` and
     `experiments/trace-changeset-fixture.cjs` show this.
  2. On timeout only the direct child was killed. `cmd.exe`, `npx` and
     `prettier` kept the temporary directory open.
  3. The failed `rmSync` then replaced the timeout as the reported error.
- **Fix** (`37c4d88`, `91cae3c`, `4b02ce8`):
  - `runBounded` starts POSIX children as process-group leaders and kills
    the whole group. On Windows it uses `taskkill /T /F`.
  - `removeFixture` never lets a cleanup error hide the test result.
  - A run past half its budget prints its timed trace.
  - Each command limit comes from one 25 s guard below the 30 s per-test
    limit, not from a guess about runner speed.
- **Everywhere:** the jscpd spawn in `tests/issue-228-regressions.test.js`
  made the same 15 s speed bet and now uses the shared guard.
- **Template:** same defect, template issue #240. The template's own
  `main` run 38049673812 fails the same way
  (`data/ci-logs/template/checks-38049673812-failed.log`).

### F2. Release preflight 404 said nothing actionable (error that needs a human)

- **Root cause:** `voice-simulator` is not on npm yet (`npm view
voice-simulator` returns 404). npm can only add a trusted publisher to a
  package that is already published. The preflight message offered two
  fixes and did not say which one applies.
- **Fix** (`d64bf2d`): the preflight reads the public package document and
  names the fix that applies:
  - The package is unpublished: add an `NPM_TOKEN` secret (the message
    links the settings page) for the first publish.
  - The package exists: add a trusted publisher for this repository and
    `release.yml`.
- **Behaviour:** on pull requests it is a warning, so the PR stays green.
  On `main` it fails with that explicit instruction until a maintainer acts.
- **Template:** template issue #239, plus a comment that the template's own
  `main` fails the same way.

### F3. Example app: `configure-pages` `Not Found` (error that needs a human), and the missing Pages read grant

- **Root cause:**
  1. Pages was not set to deploy from GitHub Actions.
  2. Pull requests never run the Pages steps, so nothing warned before the
     merge.
  3. `web-build` granted only `contents: read`. The Pages API answers a
     request it does not authorise with the same 404 as a disabled site.
- **Fix** (`79d20b2`, `4135915`):
  - `scripts/check-pages.sh` runs before `configure-pages`. It warns on pull
    requests. On `main` it fails with the settings link until the source is
    "GitHub Actions".
  - `web-build` grants `pages: read`.
  - `tests/check-pages.test.js` checks the script and its wiring.
- **Current state:** `gh api repos/konard/voice-simulator/pages` now
  reports `build_type: workflow`, so this check passes.
- **Template:** template issue #244.

### F4. Security: Dependency graph disabled (error that needs a human)

The `Dependency graph enabled` job already failed on `main` with an
explicit instruction, and only warned on pull requests. That behaviour is
correct, so it is kept. `gh api .../dependency-graph/sbom` still returns 404
on 2026-10-17, so this is listed under maintainer actions.

### F5. Vite chunk size warning (warning)

- **Symptom:** every web build printed `(!) Some chunks are larger than 500
kB`, in the desktop packaging jobs and the preview job. `index.js` was
  1049 kB.
- **Root cause:** three.js and React were bundled into the entry chunk.
  three.js alone is 1.33 MB of rendered code (measured with
  `experiments/vite-chunk-report.config.mjs`).
- **Fix** (`f7af9ae`): each prebuilt three.js file and React get their own
  chunk; the largest is now 363 kB. A `chunk-size-guard` plugin turns any
  future oversize chunk into a build error. `tests/universal-app-chunks.test.js`
  covers it. Screenshot: `screenshots/example-app-split-chunks.png`.
- **Template:** not filed. The template's bundle is 145 kB, so it does not
  hit this.

### F6. Lint exited 0 with warnings, and `main` hid them all (false negative)

- **Root cause:**
  - `scripts/lint.mjs` printed warnings on changed lines but always exited 0.
  - On `main` it reported none: `5 warning(s) on unchanged lines were not
reported`.
  - The pre-commit hook runs `--max-warnings 0`, so CI was weaker than the
    hook.
- **Fix** (`9e6ca0c`):
  - Reported warnings fail.
  - Pushes to `main` report every warning (`LINT_ALL_WARNINGS=1`).
  - The five comments that cited PR and issue numbers now describe current
    behaviour.
- **Template:** template issue #241. The template has six such warnings.

### F7. Preview drift detection could never see drift (false negative)

- **Root cause:** the preview job runs in the Playwright container.
  - `run:` blocks there use `sh`, which has no `[[`.
  - git refused the root-owned checkout (`dubious ownership`).
  - `git status` failed silently, so the step always printed `Preview images
already current.`
- **Fix** (`710c9ee`):
  - The job defaults to `bash` and trusts the checkout.
  - It assigns the `git status` output first, so a git failure fails the
    step.
  - The test checks every container job in every workflow. It runs the
    step's own script outside a repository, in a changed checkout and in a
    clean one.
- **Template:** template issue #237.

### F8. Windows CRLF broke a wiring test (Windows false positive)

The Windows checkout converts `example-app.yml` to CRLF, so the permissions
regex never matched there. The fix (`a58f20c`) normalises line endings
before matching. The template was not filed: its Windows CI passes, so
there is no evidence it shares the problem.

### F9. ESLint 9 no longer supported (warning)

- **Where the notice appeared** (`data/ci-logs`, full `main` logs):
  - `deno test`, in every Deno job: `npm:eslint@9.39.4 (This version is no
longer supported ...)`.
  - The preview job's `Install browser automation dependencies` step, a
    registry-resolving `npm install`.
- **Correction:** the message of commit `9f7d4f5` also names `npm ci`. That
  is inaccurate. `npm ci` prints only the `deprecated` fields stored in the
  lockfile, and the root lockfile was written before ESLint 9 was
  deprecated.
- **Fix** (`9f7d4f5`): upgrade to ESLint 10.12.0 and declare `@eslint/js`,
  which `eslint.config.js` imported without declaring and which ESLint 10
  no longer pulls in. 10.12.0 is used, not 10.13.0, because Deno refuses
  packages younger than 24 hours. The new recommended rules found dead
  initial values and rethrows that dropped `cause`. Those were fixed and no
  rule was disabled.
- **Template:** template issue #238.

### F10. Deprecated packages in the example app (warning, blocked upstream)

- **Symptom:** `npm ci` in the example app prints four warnings on every
  run: `rimraf@2.6.3`, `glob@7.2.3`, `inflight@1.0.6` and `boolean@3.2.0`.
- **Root cause:** all four come in through electron-builder 26. Forcing
  newer versions breaks the callback APIs that `temp` and `@electron/asar`
  3 use.
- **Fix** (`e644815`): `tests/deprecated-packages.test.js` lists each
  package with the upstream change that removes it. Any other deprecated
  package fails the test, and so does a listed one that disappears.
- **Blocked:** the four warnings stay until electron-builder 27
  (`@electron/asar` 4, `@electron/get` 5) and a `temp` release without
  rimraf 2.
- **Template:** template issue #243.

### F11. Code-change detection skipped non-JS files (false negative)

`detect-code-changes` counted only `.mjs`, `.cjs`, `.js`, `.json`, `.yml`
and `.yaml`. A pull request that changed only a shell script, a type
declaration, the `Dockerfile` or `bunfig.toml` skipped lint, tests, the
changeset check and the Docker build, and went green untested. Every file
outside the exclusions now counts as code (`25e064d`). This is template
issue #235, which already existed.

### F12. Bun failed on the `bunfig.toml` fixture (test error)

Bun reads `bunfig.toml` from its working directory, so the detector run
under Bun failed to start on the JavaScript placeholder. The fixture now
holds valid TOML (`744a5a5`). This is local to this repository.

### F13. Actions a major version behind (warning)

`actions/checkout` and `actions/setup-node` moved to v7, and
`actions/setup-java` to v6 (`742a3c1`). setup-node v7 no longer exports a
placeholder `NODE_AUTH_TOKEN`; the publish steps set it from `NPM_TOKEN`.
A test keeps every use of an action on one ref. Template issue #234 already
existed; a comment on it adds setup-java v6.1.0:
https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/234#issuecomment-6233200202

### F14. A due release or deploy reported as cancelled (false positive)

All seven write jobs share one concurrency group. With the default `queue:
single`, a third writer that starts waiting cancels the one already
waiting. `queue: max` is documented by GitHub for this case. actionlint
1.7.12 predates it, so only that message is ignored, until
rhysd/actionlint#654 (open) ships (`70e4f7d`). Template issue #233 already
existed.

### F15. Release notes lost content (false negative in publishing)

- **Root cause:** `format-release-notes`:
  - trimmed every line, so a second paragraph or a nested list fell out of
    its entry;
  - cut everything after the first `---`, which dropped every later entry;
  - undid shell escaping that the JSON body never had;
  - linked only the first commit's PR.
- **Fix** (`9643526`): the sections are kept as Changesets wrote them, and
  every entry's PR is linked. The tests are
  `tests/release-notes-description.test.js` and
  `experiments/issue-3-release-notes-e2e.sh` (before and after output in
  `data/`).
- **Template:** template issue #236 already existed. The separate `---` and
  first-PR-only losses were filed as #242.

### F16. `deploy-pages` DEP0040 warning (warning, blocked upstream)

`actions/deploy-pages@v5` (latest release v5.0.1) prints `[DEP0040] The
punycode module is deprecated`. This is visible in the template's deploy
job (`data/ci-logs/template/example-app-38049674017.log`, line 1793). It
comes from the action's bundled `@actions/artifact`, and is tracked
upstream in actions/deploy-pages#413 and #434, both open. No workflow-side
fix exists short of replacing the official action, so it is blocked.
Filing upstream was not part of the authorised work.

### F17. Placeholder `.gitkeep` and the `dev/log` data

The task's initial commit added `.gitkeep`; it is removed (`ff711e9`). The
data in this folder is exempt from formatting, lint, size, duplication and
link checks (`7e93064`). `tests/check-file-line-limits.test.js` fails
without the exemption and passes with it.

## Template comparison

The `.github/` and `scripts/` trees were compared file by file with the
template at `0a62b80`.

- Scripts here and not in the template:
  - Project scripts: `build-g2p-data.mjs`, `check-simulation.mjs`.
  - Already on `main`: `check-dependency-graph.sh`.
  - Added by this PR: `check-pages.sh`.
- No template workflow or CI script is missing here.
- The five workflows differ from the template only by project jobs and the
  fixes above.

Each finding was checked against the template, both its code and its own
CI runs:

| Finding                    | Template                  | Issue                       |
| -------------------------- | ------------------------- | --------------------------- |
| F1 Deno/Windows fixture    | Same (its `main` fails)   | #240 (new)                  |
| F2 preflight 404 message   | Same (its `main` fails)   | #239 (new)                  |
| F3 Pages source check      | Same                      | #244 (new)                  |
| F6 lint warnings           | Same                      | #241 (new)                  |
| F7 preview drift           | Same                      | #237 (new)                  |
| F9 ESLint 9 / `@eslint/js` | Same                      | #238 (new)                  |
| F10 deprecated packages    | Same                      | #243 (new)                  |
| F11 change detection       | Same                      | #235 (existing)             |
| F13 action versions        | Same                      | #234 (existing) + comment   |
| F14 queue                  | Same                      | #233 (existing)             |
| F15 release notes          | Same                      | #236 (existing), #242 (new) |
| F5, F8, F12                | Not shared or no evidence | not filed                   |

Template #232 (Dependabot changeset exemption) does not apply here, because
no Dependabot PRs are configured.

## Best practices (hive-mind CI-CD-BEST-PRACTICES.md)

| Principle                             | State after this PR                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1 Run checks only on relevant changes | Change detection counts every non-excluded file (F11)                                        |
| 2 File size limits                    | `check-file-line-limits.sh`, with data folders exempt                                        |
| 3 / 4 Formatting, linting             | Prettier and ESLint 10. Lint warnings fail (F6)                                              |
| 5 Fast-fail ordering                  | Unchanged, same as the template                                                              |
| 6 Changesets                          | `.changeset/ci-false-results-cleanup.md` (patch)                                             |
| 7 Validate the merge result           | `simulate-fresh-merge.sh` on pull requests, unchanged                                        |
| 8 Pre-commit hooks                    | lint-staged with `--max-warnings 0`, now matched by CI                                       |
| 9 Release automation                  | Release notes keep every entry (F15)                                                         |
| 10 Concurrency                        | `queue: max` on writers (F14)                                                                |
| 11 Secrets detection                  | secretlint, unchanged                                                                        |
| 14 Lint the workflows                 | actionlint (digest-pinned) and zizmor, both pass                                             |
| 15 Audit dependencies                 | npm audit, plus the deprecated-package test (F10)                                            |
| 16 Prove you can publish              | Preflight names the exact maintainer action (F2)                                             |
| 17 Broken pipeline or changed world   | Pages, Dependency graph and npm checks warn on PRs and fail `main` with instructions (F2–F4) |

## Maintainer actions (cannot be done from a pull request)

Repository settings and secrets were not changed without the owner's
confirmation. Until these actions are done, `main` fails with the
instruction shown, and pull requests only warn:

1. **npm first publish:** add an `NPM_TOKEN` repository secret
   (https://github.com/konard/voice-simulator/settings/secrets/actions). After
   the first release, add a trusted publisher on npmjs.com for
   `konard/voice-simulator` and `release.yml`, then remove the token.
   Checked on 2026-10-17: `gh secret list` shows no secrets, and the package
   is not on npm.
2. **Dependency graph:** enable it at
   https://github.com/konard/voice-simulator/settings/security_analysis.
   Checked on 2026-10-17: the SBOM endpoint returns 404.
3. **Pages:** already done (`build_type: workflow`).

## Blocked upstream

- F10: four deprecated packages through electron-builder 26.
- F16: the DEP0040 warning in `actions/deploy-pages@v5.0.1`.
- actionlint does not know `queue:` yet (rhysd/actionlint#654). This is
  worked around by an ignore for that one message.

## Libraries and tools considered

- **Process-tree kill:** `tree-kill` and `execa`'s `cleanup` were
  considered. A process group (POSIX) plus `taskkill /T /F` (Windows) needs
  no dependency, and it works the same under Node, Bun and Deno.
- **Chunk size:** Vite's `build.rollupOptions.output.manualChunks` and
  `chunkSizeWarningLimit`. The limit was not raised, because that only
  hides the warning; a guard plugin makes the warning an error.
- **Release notes:** `@changesets/changelog-github` produces PR links per
  entry. The repository's own formatter was fixed so it keeps its existing
  format.
- **Workflow linting:** actionlint 1.7.12 and zizmor 1.30.1, already in
  use.
- **Deprecations:** `npm ls`/`npm view` and the lockfile's `deprecated`
  field. The test reads the lockfile, so it needs no network.

## Verification

- Local: `npm test`, `bun test --timeout 30000`, `deno test -A --parallel`,
  `npm run lint` (with and without `LINT_ALL_WARNINGS=1`),
  `npm run format:check`, `npm run check:duplication`,
  `bash scripts/check-file-line-limits.sh`, actionlint with the queue
  ignore, and zizmor.
- CI on PR 4: every workflow is green. The PR description lists the run
  IDs for the final commit.
