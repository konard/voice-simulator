---
id: P69
title: Lowest-settings certification: 8 kHz and one core
type: Feature
milestone: M5
blocked_by: [P63, P64, P67, P14]
requirements: [R13, R12, R11]
---

## Goal

Prove with numbers that everything works at the lowest settings: 8 kHz audio
(tier `telephone`), one CPU core, no threads, no SIMD, no GPU and little
memory. Measure a fixed matrix of features, commit the report
`docs/reports/lowest-settings.md`, show the table in `README.md`, and make it
impossible to break a certified cell without noticing.

## Why

Requirement R13 of issue 11 says that synthesis, recognition and voice
copying must all work at the lowest audio settings, and R12 that one CPU is
enough. Each feature is built and tuned at 16 kHz or more by a different
issue. Without one check that covers them together, the lowest settings will
be the first thing to break and the last thing anybody tries.

## Current state

- The lowest tier in `AUDIO_TIERS` (`src/perf/lod.js`) is `minimal` at
  22050 Hz. There is no 8 kHz tier; {{P14}} adds `telephone`.
- 8 kHz output is possible only by an override:
  `synthesize('Hello world.', { tier: 'minimal', sampleRate: 8000 })` works,
  and `analyzeVoice` measures f0 122 Hz and formants 510, 1445, 2395 and
  3175 Hz on it (`experiments/issue-11-audit.txt`). Nothing tests that this
  speech can be understood.
- Speed is not the problem for synthesis: `minimal` renders at a real-time
  factor of 0.05 on one core of the development machine (same file).
- There is no recognition, no voice session and no copy synthesis yet, so
  nothing is known about them at 8 kHz.
- No test measures memory: `grep -rn maxRSS src scripts tests` prints
  nothing. No test pins the process to one core.

## What to do

1. The matrix. Rows are features, columns are conditions. Every column uses
   8000 Hz audio: tier `telephone` for output, and input recordings converted
   to 8000 Hz with `resample`.

   | Row           | What is run                                                           |
   | ------------- | --------------------------------------------------------------------- |
   | `synthesis`   | `synthesize(text, { tier: 'telephone' })`, round-trip set of {{P63}}  |
   | `recognition` | `recognize(..., { level: 'low' })` on the benchmark set of {{P64}}    |
   | `streaming`   | `createRecognizer` fed 20 ms chunks at real-time speed, 60 s          |
   | `voice-fit`   | `fitVoice` on 10 s from each of the presets `male`, `female`, `child` |
   | `session`     | `createVoiceSession({ realtime: true })`, 20 s per preset             |
   | `copy`        | `copyRecording(..., { tier: 'telephone' })` on the golden set         |
   | `modes`       | every mode the markup of {{P38}} offers, rendered and recognised      |

   | Column    | Condition                                                           |
   | --------- | ------------------------------------------------------------------- |
   | `quality` | the result is good enough (limits below)                            |
   | `js-1`    | speed of the JavaScript engine on one core                          |
   | `rust-1`  | speed of the Rust engine on one core, build without SIMD or threads |
   | `memory`  | peak resident memory of the process                                 |

2. Limits. Write them to `tests/heavy/lowest-thresholds.json` as
   `{ "<row>": { "<column>": { "<metric>": limit } } }`.

   | Row           | `quality`                                                                                             | `js-1`, `rust-1`                   |
   | ------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------- |
   | `synthesis`   | word error rate of the round trip ≤ the 16 kHz value + 5 points                                       | real-time factor ≤ 0.25            |
   | `recognition` | phoneme error rate ≤ the 16 kHz value + 5 points; word error rate ≤ + 8 points                        | real-time factor ≤ 0.25            |
   | `streaming`   | same text as the batch result                                                                         | first `partial` ≤ 1 s; load ≤ 0.25 |
   | `voice-fit`   | `vocalTractLength` within 5 %, `pitch` within 3 %                                                     | CPU time ≤ audio time              |
   | `session`     | state `stable` reached; same parameter limits                                                         | CPU time ≤ 0.5 × audio time        |
   | `copy`        | f0 RMSE ≤ 1.5 semitones, `timingError` ≤ 30 ms, the copy is recognised with the same phonemes in 90 % | reported, no limit (not streaming) |
   | `modes`       | the rendered mode is in the recognised `modes` for 80 % of the utterances                             | real-time factor ≤ 0.25            |

   `memory`: peak ≤ 256 MB for every row. "Points" are percentage points of
   the error rate. The 16 kHz value is measured in the same run with tier
   `wideband`. The factor 0.25 leaves a margin of 4 between a CI runner core
   and a slow phone; the app check in step 6 tests that margin separately.
   If a first measurement misses a limit, do not loosen the limit: write the
   cell as `failed` and file an issue (see step 7).

3. Measuring program `scripts/lowest-settings.mjs`. The call
   `node scripts/lowest-settings.mjs --row <name> --engine <js|rust>` runs
   one row in this process and prints one JSON object
   `{ row, engine, metrics, seconds, audioSeconds, peakRssMb }`. Optional
   arguments: `--limit <n>` (use only the first n items of the row's data)
   and `--out <dir>` (also write the object to `<dir>/<row>-<engine>.json`).
   - `peakRssMb` is `process.resourceUsage().maxRSS / 1024` (Node.js reports
     kilobytes on Linux).
   - Time is CPU time: `process.cpuUsage()` user plus system, so that a busy
     runner does not change the result much.
   - `--engine js` passes `engine: 'js'` to every call. `--engine rust`
     passes `engine: 'rust'` and asks for one thread and the build without
     SIMD with the options {{P12}} documents; if `createEngine` has no such
     options, add `threads: 1` and `simd: false` to it in this issue. When
     the engine or the feature does not exist in Rust, print
     `{ row, engine, unavailable: '<reason>' }`.
   - No worker threads and no GPU in this program.
4. Heavy test `tests/heavy/lowest-settings.test.js`. Add the suite `lowest`
   to the list in `scripts/run-heavy.mjs`, to the `suite` options of
   `.github/workflows/heavy.yml` and to `tests/heavy/README.md`.
   - For each row and engine start a new process:
     `taskset -c 0 node --max-old-space-size=192 scripts/lowest-settings.mjs`
     with the arguments above and `UV_THREADPOOL_SIZE=1`. Without `taskset`
     (macOS, Windows) run it unpinned and mark the report "not pinned"; the
     CI runner has it.
   - Compare with the limits. A cell is `certified`, `failed` or
     `unavailable`.
   - Write the report with `writeReport('lowest-settings', markdown, data)`
     of {{P02}}: the matrix with the measured number and the limit in every
     cell, the runner (CPU model from `os.cpus()[0].model`), Node.js version,
     commit and command.
5. Committed result and the ratchet.
   - Copy the report to `docs/reports/lowest-settings.md` and
     `docs/reports/lowest-settings.json` with
     `node scripts/lowest-settings.mjs --publish reports/heavy`.
   - `--publish` refuses to write when a cell that is `certified` in the
     committed JSON is not `certified` in the new one, unless
     `--allow-regression "<reason>"` is given; the reason is then printed in
     the report under "Regressions".
   - The heavy test fails when a cell certified in the committed JSON fails
     now.
   - Limits in `lowest-thresholds.json` may only become stricter. Say so in
     `docs/CONTRIBUTING.md`, together with the rule: a pull request that
     changes an engine, a tier, the recogniser, the session or the copy must
     run `Heavy checks` with `suite=lowest` and link the run.
   - Put the matrix into `README.md` between the comment lines
     `<!-- lowest-settings:start -->` and `<!-- lowest-settings:end -->`
     (`--publish` rewrites that part) with a link to the report.
6. The app. `scripts/check-app-lowest.mjs` builds the app and opens it in
   Chromium with `Emulation.setCPUThrottlingRate` 6 and the tier fixed to
   `telephone`: speak a 10 s text and require that the synthesis worker
   reports a real-time factor below 1 and that the first sound starts within
   1 s. If the recognition panel of {{P62}} exists, recognise the same audio
   from a file and require the text back. Call it from
   `tests/heavy/lowest-app.test.js` (skips with a message without Chromium)
   and add the numbers to the report as the row `app`.
7. For every `failed` or `unavailable` cell open a GitHub issue with the
   measured number and link it in the report. The certification is complete
   only when no cell is `failed`.

## Tests

`tests/lowest-settings.test.js` (fast, part of `npm test`; a guard, not the
certification):

- `speaks at 8 kHz`: `synthesize('Hello world.', { tier: 'telephone' })` has
  `sampleRate` 8000, finite samples and a peak between 0.01 and 1.
- `understands its own 8 kHz speech`: `recognize` of that audio with
  `level: 'low'` returns the text `hello world`.
- `runs one row`: the script with the arguments
  `--row synthesis --engine js --limit 1` prints JSON with `peakRssMb`
  below 256.
- `refuses a regression`: `--publish` with a fixture where a certified cell
  failed exits with code 1 and leaves the files unchanged; with
  `--allow-regression "test"` it writes them.
- `keeps the README table current`: the text between the two README markers
  equals the table made from `docs/reports/lowest-settings.json`.

## Acceptance criteria

- [ ] `npm run test:heavy -- --suite lowest` passes locally on Linux and in a
      run of `Heavy checks` with `suite=lowest`; the run is linked in the
      pull request.
- [ ] Every cell of the columns `quality`, `js-1` and `memory` is
      `certified`. Cells of `rust-1` are `certified` or `unavailable` with a
      linked issue; none is `failed`.
- [ ] `docs/reports/lowest-settings.md` and `.json` are committed with the
      measured numbers, limits, runner, commit and command.
- [ ] The README shows the matrix and
      `node --test tests/lowest-settings.test.js` passes in under 30 s.
- [ ] `docs/CONTRIBUTING.md` contains the ratchet rule.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Making a failing feature work at 8 kHz. This issue measures and reports;
  the fix belongs to the issue it files.
- Sample rates below 8000 Hz.
- Real phones. The throttled browser and the pinned core are stand-ins that
  can be repeated; results from real devices may be added to the report by
  hand with the device named.
- Tracking speed over time for every tier: {{P19}}.

## References

- ITU-T Recommendation G.711 (8 kHz telephone speech, 300-3400 Hz band).
- Node.js documentation, `process.resourceUsage()` and `process.cpuUsage()`.
- Chrome DevTools Protocol, `Emulation.setCPUThrottlingRate`.
- `experiments/issue-11-audit.mjs` and `experiments/issue-11-audit.txt`
  (today's numbers at 8 kHz).
- `docs/VISION.md`, sections "Running everywhere" and "How quality is
  judged".
