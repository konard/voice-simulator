# Issue 7 / PR 8: false positives, false negatives, warnings and errors in CI/CD

Issue: https://github.com/konard/voice-simulator/issues/7
Pull request: https://github.com/konard/voice-simulator/pull/8
Template compared: https://github.com/link-foundation/js-ai-driven-development-pipeline-template
at `0a62b80` (`data/template-head.txt`).
Best practices followed: `data/hive-mind-CI-CD-BEST-PRACTICES.md`, a copy of
https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md.

## Data in this folder

| Path                                                           | Content                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `data/issue-7.json`, `data/issue-7-comments.json`              | The issue and its one comment (the `main` runs had finished)               |
| `data/pr-8*.json`                                              | The PR and its conversation and review comments (none)                     |
| `data/ci-runs.json`                                            | The latest `main` runs, the five at `829bf09` first                        |
| `data/ci-logs/main-*.jobs.txt`, `data/ci-logs/main-*.log`      | Job conclusions and full logs of the five runs at `829bf09`                |
| `data/ci-logs/annotations.tsv`                                 | Every annotation (error, warning, notice) of those runs                    |
| `data/ci-logs/pr-*.jobs.txt`                                   | Job names and conclusions of PR runs, before and after the matrix name fix |
| `data/example-app-npm-audit-before.json`, `-after.json`        | `npm audit --json` of the example app lock before and after the override   |
| `data/security-and-analysis.json`                              | The repository's security settings as reported by the API                  |
| `data/repository-file-tree.txt`, `data/template-file-tree.txt` | File trees used for the comparison                                         |
| `data/template-issues.json`                                    | Template issues read before filing new ones                                |
| `template-issues/*.md`                                         | Bodies of the template issues filed from this PR (#245, #246, #247)        |

The `data/` folder is kept as fetched. Prettier, ESLint, jscpd, the line
limit check and lychee skip it, the same way they skip
`dev/log/issues/3/pulls/4/data/`.

## Starting point

The issue comment says the `main` runs at `829bf09` had finished. Three of
the five failed:

| Run                                                                                                  | Failure (from `annotations.tsv`)                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Example app [39097205073](https://github.com/konard/voice-simulator/actions/runs/39097205073)        | `preview-regen`: `RELEASE_PR_TOKEN is required to push generated preview images.`                                        |
| Security [39097204907](https://github.com/konard/voice-simulator/actions/runs/39097204907)           | `Dependency graph is disabled for konard/voice-simulator ... A maintainer must act`                                      |
| Checks and release [39097204951](https://github.com/konard/voice-simulator/actions/runs/39097204951) | `release-preflight: npm has no package voice-simulator yet ... Add an NPM_TOKEN repository secret`                       |
| Workflows 39097205023, Broken Link Checker 39097205026                                               | Green. Only notices: `Summary report available` and `Due to capacity constraints ... macOS arm64` (GitHub, not actioned) |

The same three workflows also failed at `a1129cb` and `b9bb852`. As in
issue 3, every log was read for warnings, false positives and false
negatives as well, not only for errors.

## Requirements

| #         | Requirement (issue text)                                                                                   | Where it is handled          |
| --------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------- |
| R1        | Find every false positive, false negative, warning and error in CI/CD and fix them all                     | Findings G1–G6 below         |
| R2        | Use the template's best practices, comparing the full file tree of workflows and CI/CD scripts             | "Template comparison"        |
| R3        | Report in the template any issue that it shares                                                            | Template issues #245–#247    |
| R4        | Follow hive-mind CI-CD-BEST-PRACTICES.md                                                                   | "Best practices"             |
| R5        | Everything in this single pull request                                                                     | PR 8                         |
| R6 (task) | Collect data and a deep analysis in this folder: requirements, root causes, solutions, research, libraries | This file and `data/`        |
| R7 (task) | Apply each fix everywhere the problem occurs                                                               | The "everywhere" lines below |

## Findings

### G1. Example app: `preview-regen` failed on every `main` push (error, false positive, false negative)

- **Symptom:** `Regenerate Preview Images` found drift on every `main`
  push, then failed with `RELEASE_PR_TOKEN is required to push generated
preview images.` In the same run its summary said `Preview images
regenerated and (if applicable) committed to main.`
- **Root cause:** four separate defects.
  1. **Real drift.** The committed images were older than the UI. In
     `example-app-en-light.png`, 519,514 of 1,024,000 pixels (about 51%)
     differ between the image at `829bf09` and a capture of the current UI
     (`experiments/issue-7-png-diff-regions.mjs`).
  2. **False drift.** The HUD shows the device benchmark measured on page
     load, so its numbers change with every runner. Even with no UI change,
     each capture differed from the committed one. A capture of the same
     page also differed by one colour level in scattered pixels
     (`experiments/issue-7-perturb-png.mjs`).
  3. **A push that `main` would accept was refused.** The step required
     `RELEASE_PR_TOKEN` although `main` has no ruleset or branch protection
     (`gh api repos/konard/voice-simulator/rulesets` returns `[]`), and the
     job already holds `contents: write`.
  4. **The summary was not true.** It printed "(if applicable) committed"
     no matter what the commit step did. The failure artifact listed
     `web/` paths that do not exist in this repository.
- **Fix:**
  - `fc08323`: `scripts/update-preview-images.mjs` answers the benchmark
    worker with a fixed `PREVIEW_BENCHMARK` and waits for `.hud .hud-note`
    to disappear. A capture whose pixels differ from the committed image by
    no more than `PIXEL_TOLERANCE = 2` per channel keeps the committed file
    (`writeIfChanged`). The five images were regenerated in the pinned
    Playwright container (`v1.59.1-noble`), so they show the current UI.
    `experiments/issue-7-benchmark-stub.mjs` shows that the stub makes two
    captures identical.
  - `6a307c0`: the push uses `RELEASE_PR_TOKEN` when it is set and the
    built-in `GITHUB_TOKEN` otherwise. If the push is refused without the
    token (for example after a ruleset is added), the step raises
    `::error title=Preview images need RELEASE_PR_TOKEN::`. That error names
    the token permissions, the secrets page and
    `npm run example:web:preview-images`. The summary reports what the
    regenerate and commit steps actually did. The artifact uploads only
    `docs/screenshots/example-app/`.
- **Tests:** `tests/workflow-reliability.test.js`:
  - 'pushes preview drift with the built-in token and names the fix when a
    ruleset refuses it'
  - 'summarizes the preview regeneration outcome that actually happened'
  - 'captures preview images deterministically and ignores rendering noise'
  - the updated upload path test
- **Everywhere:** `preview-regen` is the only job that pushes generated
  files. The `release.yml` job that opens the changeset pull request does
  need `RELEASE_PR_TOKEN`, because a pull request opened with
  `GITHUB_TOKEN` starts no CI. It already fails with an explicit message.
- **Template:** same defects 3 and 4, filed as template issue #245
  (`template-issues/preview-regen-token-summary.md`). There they are hidden
  by #237: `preview-regen` never detects drift, so it never reaches the
  push.

### G2. Security: Dependency graph disabled (error that needs a human)

The `Dependency graph enabled` job already fails on `main` with an explicit
instruction, and only warns on pull requests. This is the behaviour the
issue asks for, so it is kept. `gh api .../dependency-graph/sbom` still
returns 404 on 2026-10-18, so this is listed under maintainer actions.

### G3. Release preflight: no npm credential (error that needs a human)

The preflight already fails on `main` with an explicit instruction (add
`NPM_TOKEN` for the first publish), and only warns on pull requests. On
2026-10-18 `gh secret list` shows no secrets, and `npm view
voice-simulator` returns 404. This is listed under maintainer actions.

### G4. The example app ships a vulnerable `sprintf-js` and the audit hides it (false negative)

- **Symptom:** the Security run is green on `npm-audit`, but `npm audit` in
  `examples/universal-app` reports 8 moderate findings
  (`data/example-app-npm-audit-before.json`). They all come from one
  advisory: GHSA-hp3w-g68c-fv3c (CVE-2026-97058), a denial of service through
  unbounded precision in `sprintf-js` <= 1.1.3. No release is patched.
- **Root cause:** `electron-builder` → `@electron/get@3` → `global-agent@3` →
  `roarr@2` → `sprintf-js@1.1.3`. The gate runs
  `--audit-level=high`, so a moderate finding passes. `npm audit fix
--force` offers to downgrade `electron-builder` to 26.5.0, which does not
  remove it.
- **Decision:** the gate stays at `high`, as best-practices §15 recommends,
  so that unrelated moderate advisories do not block merges. The advisory
  itself is removed instead.
- **Fix** (`235355b`, `b8db519`): an npm `overrides` entry sets
  `global-agent` to `^4.1.3` in the example app. That version no longer
  depends on `roarr` or `sprintf-js`. Its `bootstrap()` API, the only one
  `@electron/get` uses, is unchanged. Afterwards, `npm audit` reports 0
  findings (`data/example-app-npm-audit-after.json`). This also removes the
  `boolean@3.2.0` deprecation warning that F10 of issue 3 listed.
  `tests/security-workflow.test.js` checks the override, the locked
  `global-agent` 4 and that neither `roarr` nor `sprintf-js` is installed.
  `tests/deprecated-packages.test.js` no longer allows `boolean`.
- **Everywhere:** the root lock has no `sprintf-js` or `global-agent`, and
  0 findings.
- **Template:** same lock chain, template issue #246
  (`template-issues/sprintf-js-advisory.md`). It refers to #243.

### G5. Deprecated packages in the example app (warning, blocked upstream)

After G4, `npm ci` in the example app prints three warnings on every run:
`rimraf@2.6.3`, `glob@7.2.3` and `inflight@1.0.6`. They come from `temp`
0.9.4, which is already the latest release and requires `rimraf ~2.6.2`,
through `electron-builder` 26. Only 27.0.0-alpha.10 exists. These stay
listed in `tests/deprecated-packages.test.js`, which fails on any new
deprecated package. Template issue #243 already covers them.

### G6. Skipped matrix jobs showed a raw expression as their name (false report)

- **Symptom:** on every pull request, and on `main` pushes without a
  release, the run listed `Build Docker Image (${{ matrix.platform }})` as
  skipped. It did so in 8 of the recent runs, and 2 runs showed
  `Test (${{ matrix.runtime }} on ${{ matrix.os }})`. Such a name looks like
  a broken workflow and cannot be matched by a required check.
- **Root cause:** GitHub evaluates a job's `if` before it expands the
  matrix. When the condition is false, the matrix is never expanded, so the
  name keeps the literal expression. The GitHub documentation on job
  conditions describes this order:
  https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution.
  Other projects report the same symptom, for example
  https://github.com/GoogleCloudPlatform/genai-databases-retrieval-app/issues/41.
- **Fix** (`c208c1b`): the two jobs that can be skipped have static names,
  `Test` and `Build Docker Image`. When a job runs, GitHub appends the
  matrix values, so names like `Test (node, ubuntu-24.04)` stay readable.
  The matrix keys are ordered (runtime, then OS) to read that way.
  `tests/workflow-reliability.test.js` ('keeps matrix expressions out of
  the names of jobs that can be skipped') checks every workflow. It fails on
  any job with `if:` or `needs:` whose name contains `${{ matrix.`.
- **Verification:** the PR run on `76d5247`
  (`data/ci-logs/pr-39102424355.jobs.txt`) lists `Build Docker Image` as
  skipped, and `Test (deno, windows-2025)` and the others as run.
- **Everywhere:** the other matrix jobs (`codeql`, `npm-audit`,
  `desktop-package`) have no `if` or `needs`, so they are always expanded.
- **Template:** template issue #247
  (`template-issues/skipped-matrix-job-names.md`). The template's own run
  38049673812 shows the same name.

### Not actioned

- `Due to capacity constraints, jobs targeting macOS arm64 runners may
experience longer queue times.` is a GitHub notice about its runner pool.
  No workflow change can remove it.
- `Summary report available at ...` from lychee is an intended pointer to
  the report.

## Template comparison

The `.github/` and `scripts/` trees were compared file by file with the
template at `0a62b80` (`data/*-file-tree.txt`).

- No template workflow or CI script is missing here.
- Scripts that exist here but not in the template:
  - project scripts: `build-g2p-data.mjs`, `build-previous-versions.mjs`,
    `check-simulation.mjs`
  - checks for maintainer actions added in earlier work:
    `check-dependency-graph.sh`, `check-pages.sh`
- Workflow differences from the template, in diff lines: `example-app.yml`
  109, `release.yml` 111, `security.yml` 52, `workflows.yml` 19, `links.yml` 9. They are the project jobs, the fixes from issue 3 and the fixes above.
  The template still uses `actions/checkout@v6` and has no `queue:` ignore
  (template issues #234 and #233).

Each finding was checked against the template's code and its own CI runs:

| Finding                      | Template                   | Issue                |
| ---------------------------- | -------------------------- | -------------------- |
| G1 preview token and summary | Same, hidden by #237       | #245 (new)           |
| G4 `sprintf-js` advisory     | Same lock chain            | #246 (new)           |
| G5 deprecated packages       | Same                       | #243 (existing)      |
| G6 skipped matrix job names  | Same (its run 38049673812) | #247 (new)           |
| G1 false drift, stale images | Project UI (HUD benchmark) | not filed            |
| G2, G3 maintainer actions    | Checks already explicit    | #239, #244 (issue 3) |

## Best practices (hive-mind CI-CD-BEST-PRACTICES.md)

| Principle                           | State after this PR                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| 6 Changesets                        | `.changeset/issue-7-ci-results.md` (patch)                                             |
| 8 Pre-commit hooks                  | Every commit passed lint-staged with `--max-warnings 0`                                |
| 9 Release automation                | Generated files land on `main` without a token unless a ruleset needs one (G1)         |
| 14 Lint the workflows               | actionlint 1.7.12 (queue ignore) and zizmor 1.30.1, both pass                          |
| 15 Audit dependencies               | `--audit-level=high` kept. The one moderate advisory is removed at its source (G4)     |
| 16 Prove you can publish            | The preflight names the exact maintainer action (G3)                                   |
| 17 Broken pipeline or changed world | Dependency graph and npm checks warn on PRs and fail `main` with instructions (G2, G3) |
| Truthful reporting                  | Job summaries report step outcomes (G1). Job names never show raw expressions (G6)     |

The other principles were reviewed for issue 3 (`dev/log/issues/3/pulls/4`)
and nothing in this PR changes them.

## Maintainer actions (cannot be done from a pull request)

Repository settings and secrets were not changed without the owner's
confirmation. Until actions 1 and 2 are done, `main` fails with the
instruction shown, and pull requests only warn:

1. **npm first publish:** add an `NPM_TOKEN` repository secret at
   https://github.com/konard/voice-simulator/settings/secrets/actions. After
   the first release, add a trusted publisher on npmjs.com for
   `konard/voice-simulator` and `release.yml`, then remove the token.
2. **Dependency graph:** enable it at
   https://github.com/konard/voice-simulator/settings/security_analysis.
3. **Optional:** Dependabot alerts and security updates are disabled
   (`data/security-and-analysis.json`). Enabling them would have reported
   G4 without a manual audit.
4. **Optional:** `RELEASE_PR_TOKEN` is needed for `preview-regen` only if a
   ruleset starts requiring pull requests on `main`. The job then fails with
   that instruction.

## Blocked upstream

- G5: three deprecated packages until `electron-builder` 27 and a `temp`
  release without rimraf 2.
- actionlint does not know `queue:` yet (rhysd/actionlint#654). This is
  worked around by an ignore for that one message.

## Research

- GHSA-hp3w-g68c-fv3c: https://github.com/advisories/GHSA-hp3w-g68c-fv3c,
  https://www.vulncheck.com/advisories/sprintf-js-through-1.1.3-denial-of-service-via-unbounded-precision,
  https://www.wiz.io/vulnerability-database/cve/cve-2026-97058,
  https://www.suse.com/security/cve/CVE-2026-97058/
- Job conditions run before the matrix:
  https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution
- Screenshot tolerance in Playwright (`threshold` 0.2 by default,
  `maxDiffPixels`): https://playwright.dev/docs/api/class-snapshotassertions

## Libraries and tools considered

- **Screenshot comparison:** `pixelmatch` and Playwright's `toHaveScreenshot`
  were considered. The capture script already decodes both images in the
  browser, so it compares them on a canvas with a per-channel tolerance and
  adds no dependency. The real fix is the fixed benchmark result, which
  removes the cause of the drift.
- **Proxy agent:** `global-agent` 4 (chosen; the same `bootstrap()` API).
  `@electron/get` 5 drops `global-agent` and is already used by `electron`
  43, but `app-builder-lib` 26 pins `^3`. `hpagent` is the replacement the
  `@electron/get` source names in a TODO.
- **Workflow linting:** actionlint 1.7.12 (Docker image) and zizmor 1.30.1,
  already in use.

## Verification

- Local: `npm test`, `bun test --timeout 30000`, `deno test -A --parallel`,
  `npm run lint` (with and without `LINT_ALL_WARNINGS=1`),
  `npm run format:check`, `npm run check:duplication`,
  `bash scripts/check-file-line-limits.sh`, actionlint with the queue
  ignore, and zizmor.
- CI on PR 8: every workflow is green. The PR description lists the run IDs
  for the final commit.
- G1 and the `main`-only paths (`preview-regen`, the Docker build) can only
  run after the merge. Their scripts are covered by the tests listed above.
