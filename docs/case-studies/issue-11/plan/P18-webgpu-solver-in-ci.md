---
id: P18
title: Run the WebGPU solver in CI
type: Feature
milestone: M1
blocked_by: [P02]
requirements: [R11, R1]
---

## Goal

The WebGPU version of the 3D solver is compared with the CPU kernel in CI
on Linux too, through a software adapter, in suite `gpu` of the heavy
workflow of {{P02}}. Where CI is meant to have an adapter, a missing one is
a failure, not a silent skip. Longer comparisons (20 000 steps, whole words
at the 3D tiers) are added, and every run reports which adapter it used.

## Why

R11: expensive checks run in manually triggered workflows. R1: the fine 3D
tiers are only usable in real time on a GPU, so this code path carries the
best sound and must not rot. Today a runner that loses its adapter looks
exactly like one that tests everything.

## Current state

- `tests/fdtd-gpu.test.js` asks once for a device (lines 37 and 38):
  `const device = await requestGpuDevice().catch(() => null);` and
  `const noGpu = device ? null : 'no WebGPU adapter in this runtime';`.
  The block `describe('WebGPU 3D FDTD step loop')` (line 124) has four
  tests registered with `itUnless(noGpu)` (`tests/helpers/skip.js`):
  `refuses step() and follows the CPU kernel at the lips`,
  `follows the CPU kernel at a microphone`,
  `renders speech and the RMS pressure field`,
  `measures the load of a 3D tier on the GPU`. Three of them expect
  `relativeError(gpu, cpu)` to be below `1e-3`. The helpers `drive(solver,
steps = 1200, flushEvery = 500)` and `relativeError(actual, expected)`
  are private to that file.
- `requestGpuDevice` (`src/acoustics/fdtd-gpu.js`, line 216) reads
  `globalThis.navigator?.gpu`. Node.js and Bun have none, so the four tests
  are always skipped there. Only Deno can run them.
- CI (`release.yml`, job with `runtime: [node, bun, deno]` and
  `os: [ubuntu-24.04, macos-15, windows-2025]`) runs
  `deno test -A --parallel`. In run 43617553281 of 2026-11-14 the four
  tests passed on `macos-15` (the speech test took 1 s) and on
  `windows-2025` (12 s), and were skipped on `ubuntu-24.04` with
  `[skipped: no WebGPU adapter in this runtime]`. Nothing prints which
  adapter was used. `docs/case-studies/issue-9/README.md` (line 282) says
  that CI has no adapter at all; that is true only for Linux.
- On the development machine (Ubuntu 24.04, no GPU, Deno 2.9.7) all eight
  tests of the file pass in 14 s. `device.adapterInfo` reports
  `description: 'llvmpipe (LLVM 20.1.2, 256 bits)'`, `vendor: '65541'`,
  `isFallbackAdapter: true`. The machine has `libegl1`, `libgles2`,
  `libegl-mesa0` and `libgl1-mesa-dri` (Mesa 25.2.8) and no Vulkan driver:
  the adapter is Mesa's software OpenGL ES.
- {{P02}} puts `"tests/heavy/"` into `test.exclude` of `deno.json`. With
  that, `deno test -A tests/heavy/x.test.js` prints
  `error: No test modules found` (tried with Deno 2.9.7): Deno needs a
  second configuration file to run a heavy test. `scripts/run-heavy.mjs`
  of {{P02}} runs every suite with `node --test`.

## What to do

1. `src/acoustics/fdtd-gpu.js`: add `describeGpuDevice(device)`. It returns
   `null` when `device` or `device.adapterInfo` is missing, else
   `{description, vendor, architecture, fallback}`: the three strings of
   `adapterInfo` (`''` when missing) and
   `fallback = Boolean(adapterInfo.isFallbackAdapter)`. Export it from
   `src/index.js` and declare it in `src/index.d.ts`.
2. `tests/helpers/gpu.js` (new):
   - `async gpuForTests({gpu, env = process.env} = {})` returns
     `{device, noGpu, info}`: `device = await requestGpuDevice(gpu ? {gpu}
: {}).catch(() => null)`; `noGpu` as today; `info =
describeGpuDevice(device)`. When `env.REQUIRE_GPU === '1'` and there is
     no device it throws
     `Error('REQUIRE_GPU=1 but this runtime has no WebGPU adapter')`.
   - Move `drive` and `relativeError` from `tests/fdtd-gpu.test.js` into
     this file and export them. `drive` gets a fourth argument `shapes`
     (the two vowel shapes the test file builds). Move, do not copy:
     `npm run check:duplication` fails on copies.
   - `tests/fdtd-gpu.test.js` uses the helper, and its first GPU test
     starts with `console.log('WebGPU adapter:', JSON.stringify(info))`.
3. `deno.heavy.json` (new, at the root):
   `{"nodeModulesDir": "auto", "test": {"include": ["tests/"]}}`.
4. `scripts/run-heavy.mjs`: files named `gpu-*.test.js` are not given to
   the Node.js command. After it, when such files were selected, run
   `deno test -A --config deno.heavy.json <files> tests/fdtd-gpu.test.js`
   with the same environment (the last file only when `--dir` is the
   default). If `deno --version` cannot be run: with `REQUIRE_GPU=1` print
   `suite gpu needs Deno on PATH` and exit with 1; else write the rows
   `skipped (no Deno)` into `summary.md`. The exit code is the first
   non-zero code of the two commands.
5. `tests/heavy/gpu-solver.test.js`. At the top: `gpuForTests()`, `model =
buildVoxelModel(DEFAULT_HEAD, {dx: 1})`. All tests use
   `itUnless(noGpu)` and push a row `{name, steps, cpuSeconds, gpuSeconds,
error}` to a list. Every GPU solver is destroyed in `finally`
   (`solver.gpu.destroy()`).
   - `long run follows the CPU kernel`: `steps = 4000 * heavyLimit(5)`;
     `drive(new Fdtd3d({model}), steps)` against
     `drive(new Fdtd3d({model, device}), steps)`: equal length, every
     sample finite, `relativeError` below `1e-3`.
   - `speaks the same at tier <name>`, for the first `heavyLimit(2)` names
     of `['high', 'ultra', 'studio']`: `synthesize('həˈloʊ', {ipa: true,
seed: 1, tier, engine: 'js'})` against `await synthesizeAsync` with the
     same options plus `device`: equal length, `relativeError` of the
     samples below `1e-3`. (`engine` is ignored before {{P13}}; after it,
     it keeps the comparison on the JavaScript kernel.)
   - `writes the report` (last): `writeReport('gpu-solver', markdown,
{adapter: info, deno: globalThis.Deno?.version.deno, rows})`. The
     markdown has the adapter line and one table row per entry: name,
     steps or samples, CPU seconds, GPU seconds, relative error (3
     significant digits).
   - If a comparison fails, do not raise the tolerance. Find the first
     block of 500 steps whose own relative error is above `1e-4`, and
     report its index and the adapter in the pull request.
6. `.github/workflows/heavy.yml`, job `heavy`, three steps before the step
   that runs the tests, each with
   `if: inputs.suite == 'gpu' || inputs.suite == 'all'`:
   - `Install the software OpenGL ES driver`: `sudo apt-get update`, then
     `sudo apt-get install -y --no-install-recommends libegl1 libgles2
libegl-mesa0 libgl1-mesa-dri`;
   - `Setup Deno`: copy the step of that name from `release.yml` (same
     pinned commit of `denoland/setup-deno`, `deno-version: v2.x`);
   - `Show the WebGPU adapter`: `deno run -A scripts/gpu-adapter.mjs`. This
     new script prints `JSON.stringify(describeGpuDevice(await
requestGpuDevice()))` and always exits with 0.
     Add to the `env:` of the test step
     `REQUIRE_GPU: ${{ (inputs.suite == 'gpu' || inputs.suite == 'all') &&
'1' || '' }}`. The rules of {{P02}} for workflows apply.
7. If the adapter line of the first run is `null`, try in this order and
   keep the first that works; write all adapter lines into the pull
   request:
   - add the package `mesa-vulkan-drivers` (Mesa's software Vulkan driver)
     to the install step;
   - run the comparison of step 5 in headless Chrome instead of Deno
     (flags `--enable-unsafe-webgpu --enable-unsafe-swiftshader`), from a
     page that imports `src/index.js`. Check the flag names against the
     Chrome documentation first. If this also fails, report the issue as
     blocked with the three logs; do not weaken `REQUIRE_GPU`.
8. `release.yml`, step `Run tests (Deno)`: add
   `env: REQUIRE_GPU: ${{ matrix.os != 'ubuntu-24.04' && '1' || '' }}`.
   macOS and Windows have an adapter today; if a new runner image loses
   it, the job fails with the message of step 2.
9. Documentation: `docs/CONTRIBUTING.md`, section "Heavy checks": the suite
   `gpu` needs Deno; `REQUIRE_GPU`; the four package names for Linux.
   Correct the sentence in `docs/case-studies/issue-9/README.md`
   (line 282) to "skipped in CI on Linux only". Copy the report of the
   first green run to `docs/reports/gpu-solver.md`.

## Tests

`tests/gpu-helper.test.js` (fast, every runtime):

- `no adapter is a skip reason`: `gpuForTests({gpu: {requestAdapter: async
() => null}, env: {}})` resolves with `device === null`, `info === null`
  and `noGpu === 'no WebGPU adapter in this runtime'`.
- `REQUIRE_GPU turns it into a failure`: the same with
  `env: {REQUIRE_GPU: '1'}` rejects with a message that contains
  `REQUIRE_GPU=1`.
- `describes a device`: `describeGpuDevice({adapterInfo: {description:
'x', vendor: 'v', isFallbackAdapter: true}})` equals `{description: 'x',
vendor: 'v', architecture: '', fallback: true}`;
  `describeGpuDevice(null)` is `null`.

`tests/heavy-runner.test.js` of {{P02}}, one more case: a temporary `--dir`
with `gpu-a.test.js` and `quality-a.test.js` and a `PATH` without Deno:
`summary.md` has `skipped (no Deno)` for the first file and the exit code
is 0; with `REQUIRE_GPU=1` the exit code is 1.

`tests/heavy/gpu-solver.test.js` is described in step 5.

## Acceptance criteria

- [ ] Local, with Deno: `REQUIRE_GPU=1 npm run test:heavy -- --suite gpu`
      exits with 0 and `reports/heavy/gpu-solver.md` names the adapter and
      has at least 3 rows, each with an error below 1e-3.
- [ ] A manual run of `Heavy checks` with `suite: gpu` on this branch is
      green; its log shows a non-null adapter line and no test name with
      `[skipped:`. The run link, the adapter line and the seconds of the
      install step and of the test step are in the pull request.
- [ ] `REQUIRE_GPU=1 node --test tests/fdtd-gpu.test.js` exits with a
      non-zero code and prints `REQUIRE_GPU=1 but this runtime has no
WebGPU adapter`.
- [ ] The three Deno jobs of `release.yml` are green on the pull request,
      and the macOS and Windows logs contain `WebGPU adapter:`.
- [ ] `docs/reports/gpu-solver.md` is committed.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Installing the driver in the per-push Deno job on Linux. The maintainer
  decides with the two timings of the manual run.
- A runner with a real GPU, and speed claims: a software adapter says
  nothing about GPU speed. Speed over time: {{P19}}.
- WebGPU in the Rust engine ({{P11}} keeps the JavaScript GPU solver).
- Browser tests of the app with WebGPU.

## References

- `tests/fdtd-gpu.test.js`, `tests/helpers/skip.js`,
  `src/acoustics/fdtd-gpu.js` (the code this issue extends).
- CI run 43617553281 of this repository (jobs `Test (deno, ...)`): where
  the GPU tests run today.
- wgpu, the WebGPU implementation inside Deno,
  https://github.com/gfx-rs/wgpu
- Research note `docs/case-studies/issue-11/research/5-performance-and-physics.md`,
  section 7.
