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

The `roundtrip` suite runs [roundtrip-sentences.test.js](roundtrip-sentences.test.js)
on 80 fixed sentences across four languages, four seeded voice presets and nine
audio tiers.
It writes `roundtrip.md` and `roundtrip.json` to the report folder. See the
[full benchmark report](../../docs/reports/roundtrip.md) for measured rates,
per-preset breakdowns, gate failures and the twenty largest phone errors.

The `copy` suite also checks copy synthesis at medium and studio quality,
and measures how often per-syllable refinement reduces log-spectral
distance. The tests write `copy-synthesis.md` and `copy-refinement.md`
along with their JSON data. Run `node scripts/copy-report.mjs` to write
the synthesis report independently. The MCD limit in
[`copy-thresholds.json`](copy-thresholds.json) is 105% of the first measured
full-corpus mean. Later changes may lower the limits in that file.

## Recognition model

`recognize()` decodes words with a Gaussian-mixture HMM whose parameters are
committed in `src/recognition/data/hmm-model-*.js` (int8, about 2 MB in parts
of 400 kB). It is trained only on speech that this library synthesises from
its own lexicons, so no recording is needed and the licence of the model is
that of the repository. The `roundtrip` suite measures it on sentences that
are never used for training: the training sentences are drawn from the 4000
most frequent words of `src/recognition/data/<lang>.js` with the seeds below,
while the suite reads the fixed sentences of `tests/helpers/roundtrip.js`.
Training runs on a developer machine, not in CI, in three steps:

1. Render labelled utterances, 400 per file, with random heads of the presets
   `any`, `male`, `female` and `child`:

   ```bash
   for lang in en ru hi zh; do
     for job in "1000 telephone 0" "1800 telephone 0" "5000 narrowband 0" \
                "6000 wideband 0" "7000 minimal 0" "8000 telephone 1" \
                "8400 wideband 1"; do
       set -- $job
       PITCH=1 WHISPER=$3 node experiments/issue-75-hmm-gen.mjs \
         $lang 400 $1 $2 /tmp/hmm/$lang-$2-$1.json
     done
   done
   ```

   `PITCH=1` stores the pitch features and the tone units of Mandarin;
   `WHISPER=1` renders the file whispered.

2. Fit the LDA projection (40 dimensions), three states per phone with 16
   Gaussians, and context states with 8 Gaussians for every entry or exit
   context seen in at least 120 frames, then run the round trip of five
   sentences per language as a check:

   ```bash
   MODEL=/tmp/hmm/model.json CD=120 K=16 KCD=8 LDA=40 PITCH_TRACK=1 LIMIT=5 \
     node --max-old-space-size=9000 experiments/issue-75-hmm-wordtrip.mjs \
     telephone en,ru,hi,zh /tmp/hmm/*-*.json
   ```

   `CONTEXT=phone` keys context states on the neighbouring phone and falls
   back to its broad class (place of articulation, vowel backness) when the
   phone context has too few frames; without it only broad classes are used.
   The shipped model was trained this way on the 28 files of step 1 (about
   7.5 minutes for the LDA and the mixtures); the features of all files are
   held in memory, so train on a machine with more than 3 GB.

3. Pack the model into the source tree and run the smoke test:

   ```bash
   node scripts/build-hmm-model.mjs /tmp/hmm/model.json
   node --test tests/roundtrip-smoke.test.js
   ```

`experiments/issue-75-hmm-eval.mjs [tier] [langs] [presets] [from] [to]`
scores the committed model on the round-trip sentences without the rest of the
suite, and `experiments/issue-75-smoke-diagnose.mjs` traces the three smoke
cases: blind decoding, decoding with the known language, the acoustic score
of the reference words and the rank of each reference word among the
candidates that end at its boundaries.

## Environment

[`scripts/run-heavy.mjs`](../../scripts/run-heavy.mjs) runs the files one
after another in `node --test` with a default one-hour timeout per test. The
public-recording recognition benchmark uses a 90-minute timeout to match its
workflow budget. The files `gpu-*.test.js` need WebGPU and run after them in
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
