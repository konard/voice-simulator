---
id: P02
title: Manually triggered workflow for expensive checks
type: Feature
milestone: M0
blocked_by: []
requirements: [R11]
---

## Goal

Add a GitHub Actions workflow `Heavy checks` that a maintainer starts by hand
and that runs the tests which are too slow for every pull request: full 3D
renders, quality reports against recordings, recognition of datasets, voice
copying. Add the folder, the npm script and the helpers that those tests use.

## Why

The issue asks that expensive tests "be moved to manually triggered GitHub
Actions workflows". Without a place for them, slow tests either land in
`npm test` and make every pull request slow, or are never run. Many roadmap
issues ({{P07}}, {{P18}}, {{P19}}, {{P63}}, {{P64}}, {{P67}}) put their slow
checks into this workflow.

## Current state

- Workflows: `example-app.yml`, `links.yml`, `release.yml`, `security.yml`,
  `workflows.yml`. Only `workflows.yml` has `workflow_dispatch`, and it only
  lints workflow files. There is no manual workflow for slow tests.
- `npm test` is `node --test --test-timeout=30000 tests/*.test.js`. The glob
  does not enter sub-folders. CI also runs `bun test --timeout 30000` and
  `deno test -A --parallel` (`release.yml`, job `test`); both search
  sub-folders. `deno.json` has `"test": {"include": ["tests/"], "exclude":
["examples/", "node_modules/"]}`. `bunfig.toml` holds only comments.
- The slowest check today is job `simulation` in `release.yml`
  (`node scripts/check-simulation.mjs`, budget 15 minutes), on every pull
  request that changes code.
- `.gitignore` has the line `reports/` (line 143, under "# jscpd reports").
  It has no leading slash, so it ignores a folder of that name at any depth,
  also `docs/reports/`, where reports that should be kept are committed.
- Measured with Bun 1.4.4 and Deno 2.9.7: a file `tests/heavy/b.test.js` is
  run by `bun test` and `deno test` unless `bunfig.toml` contains
  `[test]` / `pathIgnorePatterns = ["tests/heavy/**"]` and `deno.json` lists
  `"tests/heavy/"` under `test.exclude`. With both lines it is skipped.

Rules that every workflow file in this repository must satisfy (each is
enforced by a test or a script, named in brackets):

1. Top-level `permissions:` is exactly `contents: read`
   (`tests/workflow-permissions.test.js`).
2. No `${{ inputs.* }}`, `${{ github.event.inputs.* }}` or
   `${{ github.head_ref }}` inside a `run:` block; pass them through `env:`
   (same test).
3. Every `actions/checkout` step has `persist-credentials: false`
   (`tests/checkout-credentials.test.js`).
4. One version per action in the whole repository
   (`tests/action-versions.test.js`). In use: `actions/checkout@v7`,
   `actions/setup-node@v7` with `node-version: '24.x'`,
   `actions/upload-artifact@v7`.
5. Runner `ubuntu-24.04`, never `ubuntu-latest`; every `npx -p` package is
   pinned to an exact version (`scripts/check-ci-workflows.mjs`).
6. Every job has `timeout-minutes` (`tests/workflows-lint.test.js`, which has
   a fixed list `activeWorkflows`).
7. The last job is `pipeline-status`, a copy of the job of that name in
   `links.yml` (`if: !cancelled()`, `timeout-minutes: 5`, it runs
   `bash scripts/check-pipeline-status.sh`), with every other job of the
   workflow listed under `needs:`
   (`scripts/check-status-gate-covers-all-jobs.mjs`, run by job
   `status-gate-coverage` in `workflows.yml`;
   `tests/status-gate-coverage.test.js`).
8. actionlint and zizmor (`.github/zizmor.yml`) must pass; they run in
   `workflows.yml`.

## What to do

1. Create `tests/heavy/` with `tests/heavy/README.md` that explains: files are
   named `<suite>-<topic>.test.js`; suites are `quality`, `recognition`,
   `roundtrip`, `copy`, `performance`, `gpu`; they are run only by
   `npm run test:heavy`.
2. Exclude the folder from the regular runs:
   - `bunfig.toml`: add
     ```toml
     [test]
     pathIgnorePatterns = ["tests/heavy/**"]
     ```
   - `deno.json`: add `"tests/heavy/"` to `test.exclude`.
   - `npm test` needs no change.
3. Create `scripts/run-heavy.mjs`. Usage:
   `node scripts/run-heavy.mjs [--suite <name>] [--limit <n>] [--out <dir>]`.
   - `--suite`: one of `all`, `quality`, `recognition`, `roundtrip`, `copy`,
     `performance`, `gpu`; default `all`. Any other value: print the list and
     exit with code 2.
   - `--limit`: positive integer, the largest number of items (utterances,
     files) each test may process; default: no limit. It is passed to the
     tests as the environment variable `HEAVY_LIMIT`.
   - `--out`: folder for reports, default `reports/heavy`; passed as
     `HEAVY_OUT`. Create it if missing.
   - `--dir`: folder with the test files, default `tests/heavy`. It exists
     so that the runner itself can be tested with a temporary folder.
   - Select `<dir>/<suite>-*.test.js` (all `*.test.js` for `all`), sorted by
     name. Run
     `node --test --test-timeout=3600000 --test-concurrency=1 <files>` with
     `HEAVY=1` in the environment and pass its exit code on.
   - If no file matches, print `suite <name>: no test files` and exit 0.
   - At the end write `<out>/summary.md`: one table row per test file with
     its result and wall time, then the content of every `<out>/*.md` written
     by the tests. If the environment variable `GITHUB_STEP_SUMMARY` is set,
     append `summary.md` to that file.
4. Add `"test:heavy": "node scripts/run-heavy.mjs"` to `package.json`. In
   `.gitignore` change the line `reports/` to `/reports/`, so that only the
   folder at the root is ignored and `docs/reports/` can be committed.
5. Create `tests/heavy/helpers/report.js` exporting:
   - `heavyLimit(fallback)`: `Number(process.env.HEAVY_LIMIT)` if it is a
     positive integer, else `fallback`;
   - `writeReport(name, markdown, data)`: writes `<HEAVY_OUT>/<name>.md` and
     `<HEAVY_OUT>/<name>.json` (`JSON.stringify(data, null, 2)`), default
     folder `reports/heavy`.
6. Add the first heavy test `tests/heavy/performance-tiers.test.js`: for each
   tier in `AUDIO_TIERS` except `reference`, call
   `synthesize('The quick brown fox jumps over the dog.', {tier, seed: 1})`,
   measure the wall time, expect every sample to be finite and the peak
   between 0.01 and 1, and write the table (tier, sample rate, duration,
   seconds, real-time factor) with `writeReport('performance-tiers', ...)`.
   `heavyLimit(6)` limits the number of tiers.
7. Create `.github/workflows/heavy.yml`:
   - `name: Heavy checks`;
   - `on: workflow_dispatch` only, with inputs `suite` (type `choice`, options
     `all`, `quality`, `recognition`, `roundtrip`, `copy`, `performance`,
     `gpu`, default `all`), `ref` (type `string`, default empty: the branch
     chosen in the form), `limit` (type `string`, default empty);
   - the same top-level `permissions` and `env` blocks as `links.yml`;
   - job `heavy`: `runs-on: ubuntu-24.04`, `timeout-minutes: 330`,
     `concurrency` group
     `check-${{ github.workflow }}-${{ github.ref }}-${{ inputs.suite }}` with
     `cancel-in-progress: true`. Steps: checkout (`ref: ${{ inputs.ref }}`,
     `persist-credentials: false`), setup-node, `npm install` (as job `test`
     in `release.yml` does), then
     `bash scripts/run-with-budget-warning.sh 18000 "Heavy checks" npm run test:heavy -- --suite "$SUITE" $LIMIT_FLAG`
     where `SUITE` and `LIMIT` come from `env:` and the script builds
     `LIMIT_FLAG` as `--limit $LIMIT` only when `LIMIT` matches `^[0-9]+$`;
     then `actions/upload-artifact@v7` with `if: ${{ !cancelled() }}`, name
     `heavy-${{ inputs.suite }}-${{ github.run_id }}`, path `reports/heavy`,
     `retention-days: 30`;
   - job `pipeline-status` as in rule 7 with `needs: [heavy]`.
8. Register the workflow in the policy checks: add `heavy.yml` to
   `activeWorkflows` in `tests/workflows-lint.test.js`, add
   `.github/workflows/heavy.yml` to the `status-gate-coverage` step in
   `workflows.yml`, and add `'heavy.yml': 'covers all 1 other job(s).'` and
   the path to `tests/status-gate-coverage.test.js`.
9. Document: a section "Heavy checks" in `docs/CONTRIBUTING.md` (how to start
   the workflow in the Actions tab and with
   `gh workflow run heavy.yml -f suite=quality -f limit=5`, how to run
   `npm run test:heavy -- --suite performance` locally, where reports go:
   `reports/` is never committed, a report that should be kept is copied to
   `docs/reports/` by the issue that owns it) and a row in
   `docs/CI-TIMEOUT-BUDGETS.md`.

## Tests

Add `tests/heavy-runner.test.js` (fast, part of `npm test`):

- `rejects an unknown suite`: `run-heavy.mjs --suite nope` exits with 2.
- `reports an empty suite`: `--suite copy --dir <empty temporary folder>`
  exits with 0 and prints `suite copy: no test files`.
- `runs only the chosen suite and writes a summary`: `--dir` points to a
  temporary folder with `quality-a.test.js` (passes) and `copy-b.test.js`
  (fails). With `--suite quality` the exit code is 0 and `summary.md` has one
  row. With `--suite all` the exit code is 1 and `summary.md` has two rows.
- `heavyLimit falls back`: `heavyLimit(7)` is 7 without the variable and 3
  with `HEAVY_LIMIT=3`.
- `keeps heavy tests out of the regular runs`: `bunfig.toml` contains
  `tests/heavy/**` and `deno.json` `test.exclude` contains `tests/heavy/`.

## Acceptance criteria

- [ ] `npm test`, `bun test --timeout 30000` and `deno test -A --parallel` do
      not run any file from `tests/heavy/` (check the file lists they print).
- [ ] `npm run test:heavy -- --suite performance --limit 2` passes locally in
      under 2 minutes and writes `reports/heavy/performance-tiers.md`,
      `performance-tiers.json` and `summary.md`.
- [ ] `git check-ignore reports/heavy/x.md` prints the path and
      `git check-ignore docs/reports/x.md` prints nothing.
- [ ] `node scripts/check-ci-workflows.mjs` and
      `node scripts/check-status-gate-covers-all-jobs.mjs .github/workflows/heavy.yml`
      exit with 0.
- [ ] A run of `Heavy checks` with `suite=performance` on the pull request
      branch is green, shows the table in the run summary and has the
      artifact; the link to the run is in the pull request description.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- The heavy tests themselves, except the one in step 6: each later issue adds
  its own.
- A GPU runner or a software WebGPU adapter for suite `gpu`: {{P18}}.
- Tracking performance over time: {{P19}}.
- Scheduled (cron) runs. The workflow is manual only.

## References

- GitHub Docs, "Manually running a workflow" and "Workflow syntax:
  `on.workflow_dispatch.inputs`".
- `docs/CI-TIMEOUT-BUDGETS.md` and `docs/BEST-PRACTICES.md` in this
  repository.
