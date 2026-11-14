---
id: P19
title: 'Performance tracking: real-time factor per tier in CI'
type: Feature
milestone: M1
blocked_by: [P02, P13]
requirements: [R11, R12, R13]
---

## Goal

Every run of suite `performance` of the heavy workflow ({{P02}}) measures
the real-time factor (RTF: seconds of work per second of audio) of every
audio tier on both engines, stores it as JSON in the artifact, and fails
when a tier is much slower than a committed baseline, when Rust is slower
than JavaScript, or when a waveguide tier is not clearly faster than real
time on one core. A committed table shows the numbers over time. A pull
request only gets a quick smoke check.

## Why

R12: "fast on CPUs ... fine on single CPU"; R13: the lowest settings must
work. Both are claims about speed, and nothing checks speed today: a change
that makes a tier twice as slow passes every check. R11: the full
measurement is expensive and noisy, so it belongs in the manual workflow.

## Current state

- `src/perf/benchmark.js`: `measureAudioTier(tier, {seconds})` renders
  0.3 s and returns the load. The command `voice-simulator benchmark` prints
  it. Nothing stores a result.
- `experiments/issue-5-tier-costs.mjs` prints the load of every tier
  relative to `minimal`; the `cost` values in `src/perf/lod.js` were copied
  from it by hand.
- Measured once for this plan (`experiments/issue-11-audit.txt`, lines
  `rtf`; one core of an AMD EPYC, JavaScript, one cold run of one
  sentence): `minimal` 0.05, `low` 0.1, `medium` 0.14, `high` 1.32,
  `ultra` 6.77.
- `npm test` has one time bound (`tests/library.test.js`, `stops measuring
a tier once it exceeds the limit`: 500 ms). CI has budgets for whole
  suites only (`scripts/run-with-budget-warning.sh`, for example 100 s for
  the Deno suite).
- `tests/heavy/performance-tiers.test.js` of {{P02}} renders each tier
  once, cold, without the option `engine`, and compares with nothing.
- There is no folder `docs/reports/`. The package version is only in
  `package.json` (`readVersion()` in `bin/voice-simulator.js`).
- Hosted runners of public repositories have 4 CPUs and 16 GB; their CPU
  model changes from run to run.

## What to do

1. `scripts/performance.mjs` exports four pure functions and is a command
   (step 4). No dependencies.
   - `calibrate(runs = 5)`: the best time in seconds of this loop: two
     `Float32Array(4096)` `p` and `q`, `p[2048] = 1`; 2000 times: for
     `i = 1 .. 4094`: `q[i] = p[i - 1] + p[i + 1] - q[i]`; then swap `p`
     and `q`. It measures how fast this machine is.
   - `measureRows({tiers, engines, text, seed = 1, synthesize, now})`: for
     each engine and tier: one warm-up `synthesize('Hi.', {tier, seed,
engine, threads: 1})` (not timed), then `runs` timed calls with `text`;
     `runs` is 5 for `solver: 'waveguide'` and 2 for `fdtd3d`. It returns
     rows `{task: 'synthesis', engine, tier, solver, sampleRate, duration,
runs, seconds, median, rtf}` with `seconds` = the fastest run and
     `rtf = seconds / duration`.
   - `comparePerformance(report, baseline, {tolerance = 1.5, engineSlack =
1.1, realtime = 0.5, partial = false})` returns `{ok, scale, rows,
failures}`. `scale = report.calibration / baseline.calibration`. Rows
     are matched by `task/engine/tier`. Per row:
     `limit = baseline.rtf * scale * tolerance`; `status` is `'slower'`
     when `rtf > limit`, `'faster'` when
     `rtf < baseline.rtf * scale / tolerance`, `'new'` without a baseline
     row, else `'ok'`. A baseline row without a report row is `'missing'`
     (ignored when `partial`). Failures (strings): every `slower` and
     `missing` row; `rust is slower than js at <tier>` when
     `rust.rtf > js.rtf * engineSlack`; `<tier> is not real time on
<engine>` when `solver === 'waveguide'` and `rtf > realtime`.
     `ok = failures.length === 0`.
   - `trendMarkdown(history, tiers)`: the text of step 5.
2. Report layout (schema 1), used by the artifact, the baseline and the
   history:
   `{schema: 1, date, commit, version, machine: {cpu, cores, platform,
arch, runtime}, text, calibration, rows}`. `date` is an ISO string;
   `commit` is `process.env.GITHUB_SHA` or the output of
   `git rev-parse HEAD`; `version` from `package.json`; `cpu` is
   `os.cpus()[0].model`; `cores` is `os.availableParallelism()`; `runtime`
   is `'node ' + process.versions.node`.
3. Rewrite `tests/heavy/performance-tiers.test.js`:
   - tiers: the first `heavyLimit(n)` of `AUDIO_TIERS` without `reference`
     (`n` = all of them); engines: `'js'`, and `'rust'` unless `noRust` of
     {{P09}} is set (then the Rust tests use `itUnless(noRust)`);
   - text `'The quick brown fox jumps over the dog.'`;
   - `calibrate()` before and after the rows; the report stores the
     smaller value;
   - test `every render is sound`: all samples finite, peak 0.01 to 1;
   - test `speed rules hold`: `comparePerformance` against
     `docs/reports/performance-baseline.json` with
     `partial = HEAVY_LIMIT is set`. It runs when `process.env.CI` or
     `PERFORMANCE_COMPARE=1` is set; elsewhere it is registered with
     `itUnless('baseline comparison runs in CI only')`. The test fails
     with the list of failures;
   - if `createEngine({engine: 'rust', threads: 'auto'})` reports
     `threads > 1` ({{P12}}), add rows with the engine label `rust-mt` for
     the `fdtd3d` tiers; they are compared with their own baseline rows
     only;
   - `writeReport('performance-tiers', markdown, report)`: the markdown
     has the machine line and a table: tier, engine, RTF, baseline RTF
     times `scale`, ratio, status, and for `js` rows the measured cost
     (`rtf / rtf of minimal`) next to `tier.cost`. Add the line
     `cost of <tier> is off by more than 1.5x` under the table where that
     is true; it is a note, not a failure.
4. Command `node scripts/performance.mjs <command> <report.json>`:
   - `compare [--baseline <file>] [--tolerance <n>]`: prints the table,
     exits with 1 when `ok` is false;
   - `baseline`: writes the report to
     `docs/reports/performance-baseline.json`;
   - `trend`: puts the report into
     `docs/reports/performance-history.json` (`{schema: 1, runs: [...]}`,
     sorted by `date`; a run with the same `commit` is replaced), writes
     `docs/reports/performance.md` again and runs the local `prettier
--write` on the three files. A missing or unreadable file, or another
     `schema`: message and exit code 2.
5. `docs/reports/performance.md` (generated, never edited by hand): a
   title, three sentences (what RTF is; one core; each cell is
   `JavaScript / Rust`), then one table row per run: date, commit (7
   characters), version, CPU, cores, calibration in ms, then one column per
   tier with two numbers of two significant digits, for example
   `0.05 / 0.02`; `-` where a row is missing.
6. `.github/workflows/heavy.yml`: before the test step, when
   `inputs.suite` is `performance` or `all`, build the engine as the job
   `rust` of {{P09}} does (`rustup show`, then
   `node scripts/build-wasm.mjs --require`), and give the test step
   `REQUIRE_WASM: '1'` for these suites.
7. First numbers. Run `Heavy checks` with `suite=performance` five times
   on this branch. For every row compute the largest `rtf / calibration`
   divided by the smallest; record the worst value in the pull request.
   If it is above 1.25, set the default `tolerance` to that value times
   1.2 (rounded to one decimal) and say so in the code. Download the
   report of the median run, then run `baseline` and `trend` with it and
   commit the three files.
8. `docs/CONTRIBUTING.md`, section "Heavy checks": when to add a row to
   the trend (every pull request that changes `src/acoustics/`,
   `src/engine/` or `crates/`, and every minor release); when to replace
   the baseline (a wanted change of speed, with the reason in the pull
   request; a `faster` row is the hint to do it). The workflow never
   commits: a person runs the two commands.

## Tests

`tests/performance-tracking.test.js` (fast; made-up reports):

- `equal reports pass`: `ok` is true and every status is `'ok'`.
- `a slow tier fails`: one `rtf` times 1.6: `ok` is false and the failure
  names the tier and the engine; times 1.4: `ok` is true.
- `a slower machine is forgiven`: every `rtf` and `calibration` times 3:
  `scale` is 3 and `ok` is true.
- `rust must not be slower`: `rust.rtf = js.rtf * 1.2` gives the failure
  `rust is slower than js at minimal`.
- `waveguide tiers must be real time`: `rtf` 0.6 at `telephone` fails also
  when the baseline has 0.6; 0.6 at `high` (`fdtd3d`) does not.
- `missing and new rows`: a baseline row without a report row fails, but
  not with `partial: true`; a new row has the status `'new'` and passes.
- `faster is reported`: `rtf` divided by 2 gives `'faster'` and `ok`.
- `trend keeps one row per commit`: `trend` twice with the same commit in
  a temporary folder (option `--dir <folder>`) leaves one run; the
  markdown has one table row with `0.05 / 0.02`.
- `calibrate returns a positive time below 1 s`.

`tests/performance-smoke.test.js` (in `npm test`, every runtime, about
1 s): for `telephone` ({{P14}}; `minimal` until it exists) and `minimal`
on each engine that loads: after one warm-up, the best of three renders of
`'Hello world.'` has `rtf < 0.5`. With both engines: the best of five on
Rust is at most 1.5 times the best of five on JavaScript at `minimal`.

## Acceptance criteria

- [ ] `node --test tests/performance-tracking.test.js
tests/performance-smoke.test.js` passes; the smoke file takes less than
      5 s.
- [ ] `PERFORMANCE_COMPARE=1 npm run test:heavy -- --suite performance`
      passes locally and `reports/heavy/performance-tiers.json` has two
      rows per tier with `schema: 1`.
- [ ] `node scripts/performance.mjs compare
reports/heavy/performance-tiers.json` exits with 0; after multiplying one
      `rtf` in a copy by 2 it exits with 1 and names the row.
- [ ] Five runs of `Heavy checks` with `suite=performance` are green; their
      links, the spread of step 7 and the wall time of the suite are in the
      pull request.
- [ ] `docs/reports/performance-baseline.json`,
      `docs/reports/performance-history.json` and
      `docs/reports/performance.md` are committed and
      `npm run format:check` passes.
- [ ] In the baseline every waveguide tier has `rtf < 0.5` on both engines
      and no `rust` row is slower than its `js` row.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Speed of recognition and voice copy: {{P65}} and {{P68}} add rows with
  their own `task` to the same report.
- Speed on the GPU: a software adapter ({{P18}}) says nothing about it.
- Browser speed on user devices: {{P16}} measures it at load time.
- Making anything faster: {{P11}}, {{P12}}, {{P25}}.
- A bot that comments on pull requests or commits the trend.

## References

- GitHub Docs, "GitHub-hosted runners" (4 CPUs, 16 GB),
  https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- MDN, "Performance: now() method" (timer resolution),
  https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
- `experiments/issue-11-audit.txt` (first numbers) and
  `experiments/issue-5-tier-costs.mjs` (how `cost` is calibrated).
- Research note `docs/case-studies/issue-11/research/5-performance-and-physics.md`,
  section 7.
