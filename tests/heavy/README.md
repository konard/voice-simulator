# Heavy tests

Tests that are too slow or too large for every pull request: full 3D
renders, quality reports against recordings, recognition of datasets,
round trips and voice copying. They run only through

```bash
npm run test:heavy -- [--suite <name>] [--limit <n>] [--out <dir>]
```

locally, or in the manually started GitHub Actions workflow
[`Heavy checks`](../../.github/workflows/heavy.yml) (see "Heavy checks" in
[docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md)). `npm test`,
`bun test` and `deno test` skip this folder: `npm test` only reads
`tests/*.test.js`, `bunfig.toml` lists `tests/heavy/**` under
`pathIgnorePatterns` and `deno.json` lists `tests/heavy/` under
`test.exclude`.

## File names

Files are named `<suite>-<topic>.test.js`, for example
`performance-tiers.test.js`. The suites are:

| Suite         | What its tests do                                                                |
| ------------- | -------------------------------------------------------------------------------- |
| `quality`     | compare rendered speech with recordings and report the scores                    |
| `recognition` | recognise datasets of recorded speech                                            |
| `roundtrip`   | text to audio to text                                                            |
| `copy`        | copy a voice from recordings (20 seeded heads and all golden speakers, issue 63) |
| `performance` | measure render time and the real-time factor                                     |
| `gpu`         | run the WebGPU solver                                                            |
| `lexicon`     | measure how much of real text the pronunciation lexicons read                    |

`--suite all` (the default) runs every `*.test.js` file of this folder.

## Environment

[`scripts/run-heavy.mjs`](../../scripts/run-heavy.mjs) runs the files one
after another in `node --test` with a one-hour timeout per test; the files
`gpu-*.test.js` need WebGPU and run after them in
`deno test -A --config deno.heavy.json`, together with
`tests/fdtd-gpu.test.js` (see "Suite `gpu`" in
[docs/CONTRIBUTING.md](../../docs/CONTRIBUTING.md)). Both get:

- `HEAVY=1`;
- `HEAVY_LIMIT`: the value of `--limit`, the largest number of items
  (utterances, files) each test may process; unset without `--limit`;
- `HEAVY_OUT`: the report folder, default `reports/heavy`.

Read them through [`helpers/report.js`](helpers/report.js):

- `heavyLimit(fallback)` returns `HEAVY_LIMIT` when it is a positive integer,
  else `fallback`;
- `writeReport(name, markdown, data)` writes `<HEAVY_OUT>/<name>.md` and
  `<HEAVY_OUT>/<name>.json`.

The runner writes `<HEAVY_OUT>/summary.md`: one row per test file with its
result and wall time, followed by every Markdown report the tests wrote. In
GitHub Actions it is also shown in the run summary, and the whole folder is
uploaded as an artifact. `reports/` is never committed; a report that should
be kept is copied to `docs/reports/` by the issue that owns it.

## Tests

| File                                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `performance-tiers.test.js`          | renders one sentence on every tier except `reference` with the JavaScript and the Rust engine on one core (and the 3D tiers on every core with the threads build), checks every render is sound, and writes `performance-tiers.md` / `.json` (schema 1 of `scripts/performance.mjs`); in CI or with `PERFORMANCE_COMPARE=1` it compares them with `docs/reports/performance-baseline.json` (issue 31)                                                                        |
| `performance-rust-waveguide.test.js` | renders the same sentence on every waveguide tier with the JavaScript and the Rust renderer, three runs each, and writes `performance-rust-waveguide.md` / `.json` with the median real-time factors, their ratio and the share of frame preparation, copied to `docs/reports/` by issue 22; needs `npm run build:wasm` (skipped otherwise)                                                                                                                                  |
| `performance-rust-fdtd.test.js`      | renders the same sentence on the tiers `high`, `ultra` and `studio` with the JavaScript, the Rust scalar and the Rust SIMD renderer, interleaved, and writes `performance-rust-fdtd.md` / `.json` with the median real-time factors, their ratios and the SIMD decision of issue 23, copied to `docs/reports/` by issue 23; needs `npm run build:wasm` (skipped otherwise)                                                                                                   |
| `performance-threads.test.js`        | times 2000 kernel steps of the 3D solver on five grids on 1, 2, 3 and 4 threads, natively (`voice-simulator-cli kernel-steps`) and in the threads build of WebAssembly, median of three runs, and writes `performance-threads.md` / `.json` with the steps per second, the speed-ups and the `THREAD_MIN_LINKS` that the rule of issue 24 gives, copied to `docs/reports/` by issue 24; needs the native CLI and `node scripts/build-wasm.mjs --threads` (skipped otherwise) |
| `quality-baseline.test.js`           | scores every tier against the golden set with `scripts/quality-report.mjs` (one test per tier) and writes `baseline-quality.md` / `.json`, copied to `docs/reports/` by issue 19                                                                                                                                                                                                                                                                                             |
| `quality-dynamics-fit.test.js`       | fits the time constants, leads and coarticulation resistance of the articulators to the golden set with `experiments/issue-11-fit-dynamics.mjs` and writes `dynamics-fit.md` / `.json`; the committed result is `experiments/issue-11-fit-dynamics.txt` (issue 38)                                                                                                                                                                                                           |
| `quality-whisper.test.js`            | renders whispered `{W ˈa W}`, `{W ˈi W}` and `{W ˈu W}` against the voiced vowels at tier `high` and checks F1 (one LPC fit over the middle 60 % of the vowel) 100–400 Hz higher and F2 of [i] above 1800 Hz, writes `whisper-formants.md` / `.json`, and runs `say --markup "[whisper]Hello.[/whisper]" --out w.wav` at the default tier (voiced share below 0.05) (issue 53)                                                                                               |
| `gpu-solver.test.js`                 | compares the WebGPU 3D solver with the CPU kernel over 20 000 steps and the word `həˈloʊ` at tiers `high` and `ultra`, and writes `gpu-solver.md` / `.json` with the adapter, copied to `docs/reports/` by issue 30                                                                                                                                                                                                                                                          |
| `lexicon-coverage.test.js`           | measures the share of running words of `fleurs-en` and `fleurs-hi` read from the lexicons (source not `rules`) and the share of syllables of every tenth AISHELL-3 line (`aishell3-train-index`, not mined) read as written, against lower bounds, and writes `lexicon-coverage.md` / `.json` (issue 47); a text that is not fetched is skipped                                                                                                                              |
| `recognition-pitch.test.js`          | measures GPE, VDE and FFE of `trackPitch` on real speech against a laryngograph reference (target FFE at most 0.10) and writes `recognition-pitch.md` / `.json`, copied to `docs/reports/` by issue 59; the candidates PTDB-TUG, Keele and CSTR FDA are refused by the licence policy (`datasets/refused.json`), so the measurement is skipped and the report says so                                                                                                        |
| `recognition-formants.test.js`       | tracks the formants of the golden set with `trackFormants` (f0 of `trackPitch`) and measures the share of voiced speech frames with F1, F2 and F3 valid (target 95 %) and of F2 steps above 300 Hz (target below 2 %), and writes `recognition-formants.md` / `.json`, copied to `docs/reports/` by issue 60; the VTR formant database is refused by the licence policy (`datasets/refused.json`), so no error per formant is measured                                       |
