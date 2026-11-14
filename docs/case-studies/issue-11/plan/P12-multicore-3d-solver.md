---
id: P12
title: Multicore 3D solver with a single-core fallback
type: Feature
milestone: M1
blocked_by: [P11]
requirements: [R12]
---

## Goal

Let the Rust 3D solver of {{P11}} use several CPU cores for large grids, with
output that is bit-identical for every thread count. One thread stays the
default and the path that every test uses. Add the option
`threads: 'auto' | n`. Threads work natively and, where the page is
cross-origin isolated, in WebAssembly; everywhere else the solver runs on
one thread without any error.

## Why

R12 asks for speed on ordinary CPUs "with support for multicore" while a
single CPU must still work. Rooms and fine grids are too slow on one core:
a 40 cm `enclosure` at `dx` 1 cm has 173 292 links and needs 70 000 steps
per second of audio.

## Current state

- The library has no thread code: `grep -rn "worker_threads\|new Worker"
src bin` finds nothing, and no file mentions `SharedArrayBuffer` or
  `crossOriginIsolated`. The example app has one worker
  (`examples/universal-app/src/engine/synth-worker.js`).
- Grid sizes of the default head (`experiments/issue-11-audit-m1.txt`): `dx`
  1: 1469 links; 0.5: 11 183; 0.4: 21 906. With a 40 cm box: `dx` 1: 173 292
  links; `dx` 0.5: 1 408 925. One step of a small grid is a few
  microseconds of work, less than the cost of waking a thread, so threads
  can only pay for large grids. The research note (section 4) estimates the
  break-even near 50 000 cells; that number is an estimate, not a
  measurement.
- `buildVoxelModel` creates cells and links in grid scan order (first axis
  outermost, `voxel-model.js` lines 413 and 499), so a contiguous range of
  cell indices is a slab of the grid.
- The kernel `step_gather` of {{P11}} has two passes. Pass 1 writes
  `velocity[l]` and `flux[l]` for link `l` and reads `pressure`. Pass 2
  writes `pressure[i]` for cell `i` and reads `flux`. Inside one pass no
  element is written by one index and read by another.
- The app is published on GitHub Pages (`example-app.yml`, job
  `pages-deploy`). GitHub Pages cannot send the `Cross-Origin-Opener-Policy`
  and `Cross-Origin-Embedder-Policy` headers, and without them browsers do
  not allow shared WebAssembly memory. `examples/universal-app/public/`
  holds only `favicon.svg`.
- This machine has 6 cores. GitHub's hosted runners for public repositories
  have 4 (research note, section 7).

## What to do

1. Range kernel, `crates/voice-simulator-core/src/fdtd/kernel.rs`: split
   `step_gather` into `links_pass(grid, from, to)` (pass 1 for links
   `from..to`) and `cells_pass(grid, from, to)` (pass 2 for cells
   `from..to`). `step_gather` calls both with the full range. The SIMD file
   gets the same two functions; a range may start at an odd index.
2. Partition, `fdtd/partition.rs`:
   `pub fn bounds(weights: &[u32], parts: usize) -> Vec<usize>` returns
   `parts + 1` rising indices; bound `k` is the smallest index whose running
   sum of weights is at least `k * total / parts` (integer division), bound
   0 is 0 and the last bound is `weights.len()`. Links use weight 1 each;
   cells use `1 + number of touching links`. Parts may be empty.
3. Team, `fdtd/parallel.rs`. `pub struct Team` holds the two bound lists and
   three `AtomicU32`: `generation`, `phase` (1 links, 2 cells, 3 exit) and
   `pending`.
   - `Team::step(&self, grid)` (leader, part 0): for phase 1 and then 2:
     store `phase`, store `pending = threads - 1`, add 1 to `generation`, do
     its own part, then call `core::hint::spin_loop()` until `pending` is 0.
   - `Team::work(&self, grid, index)` (helper): spin until `generation`
     changes, load `phase`, return on 3, else do part `index` and subtract 1
     from `pending`; repeat.
   - `Team::finish(&self)` sends phase 3.
   - All orderings are `SeqCst`. Helpers write through a raw pointer to the
     arrays. This is the only file of the crate that may contain `unsafe`;
     every block has a `// SAFETY:` comment that names the rule "a part
     writes only its own index range".
   - With `threads == 1` the solver calls `step_gather` and creates no
     `Team`.
4. Threshold. `pub const THREAD_MIN_LINKS: usize`. A solver uses a team
   only when `threads > 1` and its link count is at least this value. Set it
   with step 8; until then use 100 000.
5. Native. `voice-simulator-cli` gets `--threads <n|auto>` (default 1) for
   `render-job`. It starts `n - 1` helpers with `std::thread::scope` for the
   whole render, each calling `Team::work`. `auto` is
   `max(1, std::thread::available_parallelism() - 1)`. No new dependency
   (not `rayon`): the two passes are the only parallel code.
6. WebAssembly. Shared memory needs the standard library built with
   atomics, which stable Rust does not ship (research note, section 3). So:
   - `scripts/build-wasm.mjs --threads` builds a third file,
     `src/engine/voice-simulator-threads.wasm`, with a nightly toolchain
     pinned by date in the constant `THREADS_TOOLCHAIN` of that script,
     `-Z build-std=panic_abort,std`,
     `-C target-feature=+atomics,+bulk-memory,+mutable-globals` (plus
     `+simd128` if {{P11}} ships the SIMD file) and
     `--target-dir target/threads`. The memory is imported and shared; link
     with a fixed initial size of 512 pages and a maximum of 16 384 pages
     and put both numbers into `src/engine/layout.js` as `THREAD_MEMORY`.
     Write the exact flags that work into `docs/RUST-ENGINE.md`.
   - Exports: `vs_team_new(renderer, threads) -> i32`,
     `vs_team_work(team, index)` (returns when the leader sends exit) and
     `vs_thread_init(stack_top, tls)`, which sets the stack pointer and the
     thread-local block of a helper instance. Every helper instance needs
     its own stack (64 KiB from `vs_alloc`) before it calls anything else.
   - `src/engine/thread-pool.js` exports
     `createThreadPool(module, memory, count)`. It starts `count - 1`
     workers from `src/engine/thread-worker.js` (`Worker` in browsers, Bun
     and Deno; `node:worker_threads` in Node.js). Each worker instantiates
     the same `WebAssembly.Module` with the same memory, calls
     `vs_thread_init`, then waits with `Atomics.wait` on a control word.
     Before a render the pool stores the team handle, wakes the workers,
     and each calls `vs_team_work`. `pool.close()` ends the workers.
   - `loadEngineModule` gets the option `threads`. It loads the threaded
     file only when all of these hold: `threads` is not 1, the file exists,
     `globalThis.crossOriginIsolated !== false`, `SharedArrayBuffer`
     exists, and creating the shared memory does not throw. Otherwise it
     loads the single-thread file as before. The result gets
     `threads: number`.
7. Option. `loadEngineModule` takes `threads` and `simd`. If
   `src/engine/index.js` of {{P13}} exists, `createEngine({ threads, simd })`
   passes both on unchanged; if not, {{P13}} adds that when it is done.
   `threads` is 1 (default), a positive integer, or `'auto'`
   (`max(1, cores - 1)`, at most 8, where `cores` is
   `navigator.hardwareConcurrency` or `os.availableParallelism()`); `simd`
   is `'auto'` (default), `true` or `false`. A request that cannot be met is
   never an error: the engine reports the real count in `engine.threads`.
8. Measure with `tests/heavy/performance-threads.test.js` (suite
   `performance` of {{P02}}): 2000 kernel steps on five grids (`dx` 1, 0.5
   and 0.4; `dx` 1 and 0.5 with `enclosure` 40 cm) for 1, 2, 3 and 4
   threads, native and WebAssembly, median of three runs; report
   `performance-threads` with steps per second and the speed-up. Set
   `THREAD_MIN_LINKS` to the link count of the smallest grid where 2
   threads are at least 1.3 times faster than 1; if there is none, set it
   to `usize::MAX`, keep the code, and say so in `docs/RUST-ENGINE.md`.
9. Browser isolation. Add a section "Threads in the browser" to
   `docs/RUST-ENGINE.md`: the two headers a server must send
   (`Cross-Origin-Opener-Policy: same-origin`,
   `Cross-Origin-Embedder-Policy: require-corp`), and that GitHub Pages
   cannot send them. For such hosts the app may ship `coi-serviceworker`
   (MIT) as a separate file in `examples/universal-app/public/`: a service
   worker that adds the headers, at the price of one page reload on the
   first visit. Add it only behind the build variable
   `VITE_CROSS_ORIGIN_ISOLATION=1`, default off; the published app stays on
   one thread until {{P13}} has shipped and the numbers of step 8 justify
   it. Add the two headers to the Vite dev server only when the same
   variable is set.

## Tests

Rust (`cargo test`):

- `bounds cover the range`: for weights from `Random::new(1)` and 1 to 8
  parts, bounds rise, start at 0 and end at the length.
- `ranges equal the whole`: `links_pass` and `cells_pass` over the bounds
  of 3 parts give the same bits as `step_gather`.
- `threads do not change the result`: the grid of `gather equals scatter`
  ({{P11}}), 200 steps with a `Team` of 1, 2, 3 and 4 threads
  (`std::thread::scope`); every array equals `step_gather` bit for bit.

`tests/rust-threads.test.js`:

- `one thread is the default`: `loadEngineModule()` returns
  `threads === 1`.
- `falls back without isolation`: with `globalThis.crossOriginIsolated`
  set to `false`, `loadEngineModule(undefined, {threads: 4})` returns
  `threads === 1` and a render works.
- `threaded render is bit-identical` (skipped with a reason when the
  threaded file is missing): `'Hello.'`, seed 1, tier `high`,
  `enclosure: {width: 40, height: 40, depth: 40}`, 0.2 s; samples for
  `threads` 2 and 4 equal those for 1 under `===`.
- `small grids stay on one thread`: tier `high` without enclosure and
  `threads: 4` reports `engine.threads === 1` for that render.

## Acceptance criteria

- [ ] `cargo test --workspace` passes, including `threads do not change the
result`.
- [ ] `voice-simulator-cli render-job job.bin --threads 1` and
      `--threads 4` print the same SHA-256 for a `high` job with a 40 cm
      enclosure.
- [ ] `node --test tests/rust-threads.test.js` passes; where the threaded
      file was built, no test of it is skipped.
- [ ] `grep -rn "unsafe" crates/voice-simulator-core/src` lists only
      `fdtd/parallel.rs` (and `fdtd/kernel_simd.rs` if {{P11}} needed it).
- [ ] The report `performance-threads` is attached to the pull request;
      `THREAD_MIN_LINKS` equals the value that the rule of step 8 gives.
- [ ] Without the threaded file, and with `threads: 1`, every test of
      {{P10}} and {{P11}} passes unchanged.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Threads for the waveguide: it has 8 to 44 sections per step.
- Rendering several sentences at once on different cores, and trying many
  voice candidates in parallel ({{P67}}, {{P65}}).
- Making threads the default, and the worker of the app: {{P13}}.
- A fallback that splits the grid over workers without shared memory: every
  step would copy the slab borders between workers, which is slower than one
  thread.
- `Document-Isolation-Policy` and Electron or Capacitor headers.

## References

- MDN, "Window: crossOriginIsolated property",
  https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated
- `coi-serviceworker`, https://github.com/gzuidhof/coi-serviceworker
- `wasm-bindgen-rayon` (what a threaded Rust build needs),
  https://github.com/RReverser/wasm-bindgen-rayon
- MDN, "Navigator: hardwareConcurrency property",
  https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency
- Research note `docs/case-studies/issue-11/research/5-performance-and-physics.md`,
  sections 3 and 4.
