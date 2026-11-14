---
id: P11
title: Port the 3D FDTD solver to Rust with WebAssembly SIMD
type: Feature
milestone: M1
blocked_by: [P09, P10]
requirements: [R1, R2, R12]
---

## Goal

Port the sparse-voxel 3D solver (`src/acoustics/fdtd3d.js`) to Rust: first
the step kernel, bit-identical with the present kernels, then the whole
solver behind the `Solver` trait, so that all steps of a block run inside
WebAssembly without a call from JavaScript per step. Add a second build that
uses 128-bit SIMD, chosen at load time, with the scalar build as the
fallback and as the reference.

## Why

The 3D tiers give the best sound and are the slow ones: on one core `high`
runs at 1.32 times real time and `ultra` at 6.77
(`experiments/issue-11-audit.txt`). R1 asks for the highest quality, R2 and
R12 for speed on ordinary CPUs. The present kernel is already WebAssembly,
so the gain must come from three places: no JavaScript call per step (70 000
to 175 000 calls per second of audio today), SIMD, and later threads
({{P12}}).

## Current state

- `fdtd3d.js` (1006 lines), class `Fdtd3d`. `COURANT = 0.5`; the step is
  `dt = COURANT * dx / 35000` s, so `dx` 1 cm gives 70 000 steps per second,
  0.6 cm 116 667, 0.5 cm 140 000, 0.4 cm 175 000. All arrays are
  `Float64Array`.
- The grid is sparse: only air cells and the links between neighbours are
  stored. Measured sizes for the default head
  (`experiments/issue-11-audit-m1.txt`): `dx` 1: 637 cells, 1469 links;
  0.6: 2595, 6583; 0.5: 4298, 11 183; 0.4: 8202, 21 906. With a 40 cm
  `enclosure`: `dx` 1: 59 852 cells, 173 292 links; `dx` 0.5: 477 948 cells,
  1 408 925 links.
- Reference loop `#stepJs()`: for every link in index order
  `u = damping[l] * (velocity[l] - COURANT * (pressure[b] - pressure[a]))`,
  `velocity[l] = u`, `flux = conductance[l] * u`, `divergence[a] += flux`,
  `divergence[b] -= flux`; then for every cell
  `pressure[i] = keep[i] * pressure[i] - gain[i] * divergence[i]`,
  `divergence[i] = 0`.
- `step(glottalFlow, noisePosition, noise)` adds the noise force to
  `velocity` of `noiseLinks`, runs the kernel, adds
  `#sourcePressure(flow) * keep[i]` to `sourceCells`, returns `#measure()`.
- Kernels: `kernel: 'wasm'` (default) uses `src/acoustics/fdtd-kernel.js`,
  332 bytes built by hand from `experiments/wasm/fdtd-kernel.wat`, function
  `step` with eleven `i32` arguments; `linkA`/`linkB` hold byte offsets
  (cell index times 8). `kernel: 'js'` uses `#stepJs`. The file header says
  the two are bit-identical and WebAssembly is about 1.8 times faster on V8;
  the test `renders bit-identically with the wasm and JavaScript kernels`
  (`tests/fdtd3d.test.js`) checks the first claim.
- Per block, `setShape(areas, velumArea, velumIndex, teeth)` updates link
  and cell coefficients (`#setTube`, `#applyTeeth`, `#updateLinks`). These
  use `**` (`lossFactor(area, wallLoss) ** exponent`,
  `low * (high / low) ** (at - lower)`), so the whole solver is class B of
  {{P09}}; the kernel alone is class A.
- `buildVoxelModel(head, options)` (`voxel-model.js`, 821 lines) returns
  `{dx, head, opening, cells, links: {a, b, kind}, openFaces, openMasks,
boundaryAdmittance, radiationRadius, enclosure, lengths, sinuses,
velumDistance, landmarks, teeth}`. `sinuses.js` is used only there.
- The GPU solver (`fdtd-gpu.js`) uses `f32` and is compared with the CPU
  within 1e-3.

## What to do

1. Kernel, `crates/voice-simulator-core/src/fdtd/kernel.rs`:
   - `pub struct Grid` with `link_a: Vec<u32>`, `link_b: Vec<u32>` (cell
     indices, not byte offsets), `velocity`, `damping`, `conductance`,
     `flux` (per link, `f64`), `pressure`, `divergence`, `keep`, `gain`
     (per cell, `f64`);
   - `pub fn step_scatter(grid: &mut Grid)`: the loop above, operation by
     operation, with `const COURANT: f64 = 0.5`;
   - `pub fn step_gather(grid: &mut Grid)`: pass 1 computes `velocity` and
     `flux` for every link; pass 2, for every cell, starts with `d = 0.0`
     and, for each link that touches the cell in increasing link order,
     does `d = d + flux[l]` when the cell is `a` and `d = d - flux[l]` when
     it is `b`, then `pressure = keep * pressure - gain * d`. The lists of
     touching links are built once (`incident_start`, `incident_link`,
     `incident_sign`). This gives the same bits as `step_scatter` because
     every cell sees the same additions in the same order; a Rust test
     proves it.
2. Export `vs_fdtd_kernel_new(links, cells) -> i32`,
   `vs_fdtd_kernel_array(handle, which: u32) -> u32` (offset of one of the
   arrays, numbered in the order of step 1), `vs_fdtd_kernel_steps(handle,
count: u32, gather: u32)` and `vs_fdtd_kernel_free(handle)`. They exist
   for the parity test and for {{P12}}.
3. SIMD kernel, `fdtd/kernel_simd.rs`, compiled only with
   `#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]`: the
   gather form with two links (pass 1) and two cells (the final update of
   pass 2) per `f64x2` vector, using `core::arch::wasm32`. Only element-wise
   `add`, `sub`, `mul`; no relaxed SIMD, no fused multiply-add. The sum over
   touching links stays scalar and ordered. A scalar tail handles an odd
   count. If an intrinsic that is needed is `unsafe`, keep all of them in
   this one file with `#[allow(unsafe_code)]` and change the crate attribute
   from `forbid` to `deny`.
4. Second binary. `scripts/build-wasm.mjs` also builds with
   `RUSTFLAGS="-C target-feature=+simd128"` and `--target-dir target/simd`
   and writes `src/engine/voice-simulator-simd.wasm`. `loadEngineModule` of
   {{P09}} gets a second argument `{ simd }`: `'auto'` (default) tries the
   SIMD file first and, when it is missing or `WebAssembly.compile` rejects
   it, loads the scalar file; `false` loads only the scalar file; `true`
   returns `null` when SIMD cannot be used. The result gets `simd: boolean`.
   There is no run-time detection inside WebAssembly, hence two files.
5. Model. `src/engine/pack-model.js` exports `packVoxelModel(model)`, which
   returns one `ArrayBuffer`: a header of `u32` counts, then one section per
   property of `model` that `fdtd3d.js` reads (list them with
   `grep -o "model\.[a-zA-Z]*" src/acoustics/fdtd3d.js | sort -u`: `dx`,
   `opening`, `cells`, `links`, `openFaces`, `boundaryAdmittance`,
   `enclosure`, `lengths`, `sinuses`, `landmarks`, `teeth`). Integers are
   `i32`, numbers `f64`, every section starts at a multiple of 8. Write the
   layout as a table in a comment at the top of `pack-model.js` and of
   `fdtd/model.rs`. `buildVoxelModel` itself stays JavaScript.
6. Solver, `fdtd/solver.rs`: port `Fdtd3d` method by method (`#prepareGrid`,
   `#allocate`, `#fillSinuses`, `#indexLinks`, `#placeMicrophone`,
   `#prepareBoundaries`, `#updateCellCoefficients`, `stepDuration`,
   `#setTube`, `#applyTeeth`, `#updateLinks`, `setNose`, `setShape`,
   `#selectNoiseLinks`, `#noiseForce`, `#sourcePressure`, `#measure`,
   `step`, `field`, `reset`), keeping names (in snake case) and operation
   order, and implement the `Solver` trait of {{P10}}. `step` calls
   `step_gather` (scalar or SIMD). The GPU path (`queueStep`, `flushSteps`,
   `device`) is not ported.
7. Frames. The frame of {{P10}} gets the teeth: slot 14 is 1 when
   `shape.teeth` is present, slot 15 is the number of extra values, and the
   numeric fields of `shape.teeth` that `#applyTeeth` and `#teethSlot` read
   follow the areas in the order they are read. Update `FRAME` in
   `layout.js` and `frame.rs`.
8. `RustVoiceRenderer` accepts `solver: 'fdtd3d'`: it packs the model
   (`options.model ?? buildVoxelModel(head, {dx, microphone, enclosure,
piriform, vallecula})`, as the JavaScript factory does) and passes it to
   `vs_renderer_new`. `device` still throws `ENGINE_UNSUPPORTED`.
9. Measure with `tests/heavy/performance-rust-fdtd.test.js` (suite
   `performance` of {{P02}}): the pangram, seed 1, tiers `high`, `ultra`,
   `studio`; engines JavaScript (`kernel: 'wasm'`), Rust scalar, Rust SIMD;
   three runs, median real-time factor; report `performance-rust-fdtd`.
   Ship the SIMD file only if it is at least 1.15 times faster than scalar
   on `high`; otherwise keep the code and the build flag, do not copy the
   file into `src/engine/`, and write the measured number into
   `docs/RUST-ENGINE.md`.

## Tests

Rust unit tests (`cargo test`):

- `gather equals scatter`: random grid from `Random::new(1)` with 500 cells
  and 1400 links, 200 steps; every array is equal bit for bit.

`tests/rust-fdtd.test.js` (skipped without the binary):

- `kernel is bit-identical with JavaScript`: build
  `new Fdtd3d({model: buildVoxelModel(DEFAULT_HEAD, {dx: 1}), kernel: 'js'})`,
  copy its coefficient arrays into a Rust kernel, set `pressure[0] = 1` in
  both, run 2000 steps (JavaScript: `solver.step(0, 0, 0)`, which adds no
  source and no noise); every value of `pressure` and `velocity` is finite
  and equal under `===`, for `gather` 0 and 1.
- `SIMD is bit-identical with scalar`: the same with both binaries; skipped
  with a reason when the runtime rejects the SIMD file.
- `packs and unpacks a model`: counts and the first and last element of
  every section survive `packVoxelModel`.
- `solver matches`: 2000 steps with the shape of `aː` (from `tractShape`),
  flow impulse at step 0; `sqrt(sum((a - e)^2) / sum(e^2))` below 1e-9.
- `render matches`: `'Hello.'`, seed 1, tier `high`; largest absolute sample
  difference below 1e-4. The same with `enclosure: {width: 40, height: 40,
depth: 40}` and with `teeth: false`.
- `loader falls back to scalar`: `loadEngineModule(undefined, {simd:
'auto'})` with the SIMD file renamed returns a module with `simd ===
false`.

## Acceptance criteria

- [ ] `cargo test --workspace` passes, including `gather equals scatter`.
- [ ] `REQUIRE_WASM=1 node --test tests/rust-fdtd.test.js` passes on Node.js,
      and with `bun test` and `deno test -A`.
- [ ] The report `performance-rust-fdtd` is attached to the pull request. The
      Rust scalar real-time factor is not above the JavaScript one on any of
      the three tiers. The SIMD ratio is recorded and the rule of step 9 is
      applied.
- [ ] `voice-simulator-cli render-job` of a `high` job prints the same
      SHA-256 as the scalar WebAssembly render.
- [ ] `npm run build:wasm -- --check-size` passes for each shipped file.
- [ ] All tests of `tests/fdtd3d.test.js` pass unchanged (the JavaScript
      solver and its hand-written kernel are not touched).
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Threads and domain decomposition: {{P12}}.
- A single-precision (`f32`) CPU solver. It would double the SIMD width but
  changes the output; decide after the numbers of this issue exist.
- Reordering cells or links for better memory locality: it changes the
  order of additions, so the JavaScript reference would have to change too.
- The WebGPU solver; running it in CI is {{P18}}.
- Removing `fdtd-kernel.js`. It stays as the kernel of the JavaScript engine.
- New physics ({{P24}}, {{P25}}); {{P70}} ports what is added later.

## References

- Bilbao, S. (2009). Numerical Sound Synthesis. Wiley.
  doi:10.1002/9780470749012.
- WebAssembly SIMD in `core::arch::wasm32`:
  https://doc.rust-lang.org/core/arch/wasm32/index.html
- Fast, parallel applications with WebAssembly SIMD:
  https://v8.dev/features/simd
- Browser support of SIMD: https://webassembly.org/features/
- Research notes, sections 2 and 4:
  `docs/case-studies/issue-11/research/5-performance-and-physics.md`.
