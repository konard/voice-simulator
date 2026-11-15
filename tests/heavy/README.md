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

| Suite         | What its tests do                                             |
| ------------- | ------------------------------------------------------------- |
| `quality`     | compare rendered speech with recordings and report the scores |
| `recognition` | recognise datasets of recorded speech                         |
| `roundtrip`   | text to audio to text                                         |
| `copy`        | copy a voice from recordings                                  |
| `performance` | measure render time and the real-time factor                  |
| `gpu`         | run the WebGPU solver                                         |

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

| File                                 | What it does                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `performance-tiers.test.js`          | renders one sentence on every tier and reports the real-time factor                                                                                                                                                                                                                                                                         |
| `performance-rust-waveguide.test.js` | renders the same sentence on every waveguide tier with the JavaScript and the Rust renderer, three runs each, and writes `performance-rust-waveguide.md` / `.json` with the median real-time factors, their ratio and the share of frame preparation, copied to `docs/reports/` by issue 22; needs `npm run build:wasm` (skipped otherwise) |
| `quality-baseline.test.js`           | scores every tier against the golden set with `scripts/quality-report.mjs` (one test per tier) and writes `baseline-quality.md` / `.json`, copied to `docs/reports/` by issue 19                                                                                                                                                            |
| `gpu-solver.test.js`                 | compares the WebGPU 3D solver with the CPU kernel over 20 000 steps and the word `həˈloʊ` at tiers `high` and `ultra`, and writes `gpu-solver.md` / `.json` with the adapter, copied to `docs/reports/` by issue 30                                                                                                                         |
