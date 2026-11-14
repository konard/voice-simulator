# Performance engineering and physical-model quality for a Rust and WebAssembly voice simulator

Scope note. This file collects research for moving a physical voice simulator to a Rust core compiled to WebAssembly, and for raising the quality of its physics without neural networks.
Research date: November 2026. Platform facts were checked against official documentation (MDN, caniuse, webassembly.org feature data, Rust and wasm-bindgen docs, GitHub docs, Chrome developer blog); crate licences and versions were read from the crates.io API on 2026-11-14.
Paper DOIs were validated against the Crossref metadata API and are printed as plain identifiers (`10.xxxx/...`), not as links; every hyperlink below was opened or returned by a search during this research.
Anything recalled from memory or derived by my own arithmetic is marked "(unverified)" or "(estimate)". Figures in "(estimate)" items are planning numbers, not measurements.

## Part A: Rust and WebAssembly engine

### 1. Toolchain and packaging

Status of the tools:

- The `rustwasm` GitHub organisation was sunset: announced 2025-07-21, archived in September 2025. `wasm-bindgen` moved to its own `wasm-bindgen` organisation with new maintainers; other repositories were archived or handed to existing maintainers ([Inside Rust blog](https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org)).
- `wasm-pack` was not abandoned: it now lives at [wasm-bindgen/wasm-pack](https://github.com/wasm-bindgen/wasm-pack) (MIT/Apache-2.0, not archived). The [releases page](https://github.com/wasm-bindgen/wasm-pack/releases) lists v0.14.0, v0.15.0 and v0.15.1 (latest, dated 30 Oct, bundling Binaryen v130); the page does not show the year, presumably 2026 (unverified).
- `wasm-bindgen` itself is active: crates.io lists 0.2.130 updated 2026-10-30 ([repository](https://github.com/wasm-bindgen/wasm-bindgen)).
- `wasm32-unknown-unknown` is a Tier 2 Rust target. `std` is partial (`std::thread::spawn` panics). Several post-MVP features are enabled by default, including nontrapping-fptoint and bulk-memory since Rust 1.87. More are enabled with `-Ctarget-feature=+simd128`. A strict "MVP" binary needs nightly `-Zbuild-std` with `-Ctarget-cpu=mvp`; `wasm32v1-none` is the `no_std` target for WebAssembly 1.0 ([rustc platform support](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)).

Two build pipelines are viable:

- With wasm-bindgen (rich JS API, strings, objects): `cargo build --release --target wasm32-unknown-unknown`, then `wasm-bindgen --target web <file.wasm> --out-dir <dir>`, then `wasm-opt`. The CLI version must equal the library version, and `wasm-opt` should be pinned ([Life after wasm-pack](https://nickb-dev.pages.dev/blog/life-after-wasm-pack-an-opinionated-deconstruction)). `wasm-pack build` wraps the same steps.
- Without wasm-bindgen (raw C ABI): `crate-type = ["cdylib", "rlib"]`, exported functions written as `#[unsafe(no_mangle)] pub extern "C" fn ...` taking integers, floats and pointers into linear memory. JavaScript calls `WebAssembly.instantiate` and reads `exports.memory.buffer` through typed arrays. There is no generated glue, so the same `.wasm` loads identically in browsers, workers, `AudioWorkletGlobalScope`, Node, Bun and Deno. This matches the interface style of a hand-written WAT kernel, so it is the lowest-risk migration path for the DSP core.

wasm-bindgen output targets ([deployment reference](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html)):

| `--target`          | Output                        | Notes                                                              |
| ------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `bundler` (default) | ESM that imports the `.wasm`  | Needs a bundler with wasm support                                  |
| `web`               | ESM with an explicit `init()` | Works natively in browsers and Deno; needed for wasm-bindgen-rayon |
| `nodejs`            | CommonJS                      | `experimental-nodejs-module` gives ESM                             |
| `deno`              | ESM for Deno                  |                                                                    |
| `module`            | Source phase imports          | Docs say "only supported in ESBuild and Node.js 24"                |
| `no-modules`        | Global script                 | Legacy                                                             |

Recommendations for the crate layout:

- Workspace with a pure `core` crate (`#![no_std]` plus `alloc`, no I/O, no threads, no clock), a thin `wasm` crate (cdylib, raw exports, optional wasm-bindgen feature for a convenience API), a `cli` crate (native binary for batch synthesis and CI), and optionally a `napi` crate later.
- `no_std` in the core keeps formatting and panic machinery out of the binary. Release profile: `opt-level = 3` for the kernel (or `"s"` for glue), `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`, `strip = true`, then `wasm-opt -O3` (or `-Oz`). A DSP-only kernel built this way should fit in tens of kilobytes before compression (estimate); set a CI budget (for example 150 kB raw for the scalar engine) and fail the build when exceeded.
- Native Node addon via napi-rs is optional. napi-rs v3 can build one addon as native binaries plus a `wasm32-wasip1-threads` fallback with generated loaders, but its docs list gaps for the WASI fallback under Bun and Deno ([announcement](https://napi.rs/blog/announce-v3), [WebAssembly notes](https://napi.rs/docs/concepts/webassembly), [compatibility](https://napi.rs/docs/more/support-compatibility)). The measured gap between wasm and native is modest: Jangda et al. (USENIX ATC 2019) found SPEC CPU benchmarks 45% (Firefox) to 55% (Chrome) slower than native on average, with peaks of 2.08x and 2.5x ([paper page](https://www.usenix.org/conference/atc19/presentation/jangda), [arXiv](https://arxiv.org/abs/1901.09056v3)). Use the native Rust CLI for heavy offline work, and wasm everywhere else.

How the npm package should carry the `.wasm`:

| Method                                                                          | Pros                                                                                                                                                                                               | Cons                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Separate `.wasm` file resolved with `new URL('./engine.wasm', import.meta.url)` | Streaming compile, cacheable, smallest transfer                                                                                                                                                    | Needs correct `application/wasm` MIME for streaming; Node needs a file read instead of fetch (unverified for current Node)                                                                                                                                                                                                                                               |
| Inline base64 in a JS module                                                    | Zero configuration in every bundler and runtime, works in workers and worklets                                                                                                                     | About 33% larger before compression, no streaming compile, parsed on the JS thread                                                                                                                                                                                                                                                                                       |
| Bundler-specific import                                                         | Vite: `import init from './x.wasm?init'`, `?url` plus `WebAssembly.instantiateStreaming`; files below `assetsInlineLimit` are inlined as base64 ([Vite features](https://vite.dev/guide/features)) | Ties the library to one bundler; keep it in the app, not in the package                                                                                                                                                                                                                                                                                                  |
| ESM integration (`import source mod from './x.wasm'`)                           | Standard, no glue                                                                                                                                                                                  | Still experimental per [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import/source); [TC39 proposal](https://github.com/tc39/proposal-source-phase-imports); Mozilla announced intent to ship in Firefox 153 ([dev-platform thread](https://groups.google.com/a/mozilla.org/g/dev-platform/c/yaGHBIugfQA)); do not depend on it yet |

- Recommended: publish the `.wasm` as a real file listed in the package `exports`, with a loader that accepts a URL, bytes or a compiled `WebAssembly.Module`, and add a second entry point with the base64-inlined scalar build for zero-configuration use.
- Deno imports `.wasm` as a module since Deno 2.1; streaming compilation needs the `application/wasm` MIME type ([Deno docs](https://docs.deno.com/runtime/reference/wasm/)). Bun lists `.wasm` among bundler loader extensions ([Bun loaders](https://bun.com/docs/bundler/loaders)) but gives no detail; plain `WebAssembly.instantiate` on bytes is the portable route for Bun (unverified beyond that).
- Vite workers: `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })` is the documented portable form ([Vite features](https://vite.dev/guide/features)).

### 2. SIMD and floating-point determinism

Fixed-width 128-bit SIMD and relaxed SIMD support ([webassembly.org features](https://webassembly.org/features/) and its [features.json](https://raw.githubusercontent.com/WebAssembly/website/main/features.json), [caniuse SIMD](https://caniuse.com/wasm-simd), [caniuse relaxed SIMD](https://caniuse.com/wf-wasm-simd-relaxed)):

| Engine                 | Fixed 128-bit SIMD | Relaxed SIMD                         | Threads         |
| ---------------------- | ------------------ | ------------------------------------ | --------------- |
| Chrome / Edge          | 91                 | 114                                  | 74              |
| Firefox                | 89                 | 145 (features.json) or 146 (caniuse) | 79              |
| Safari / iOS Safari    | 16.4               | Not shipped (flag only)              | 14.1 (iOS 14.5) |
| Node.js                | 16.4               | 21                                   | 16.4            |
| Deno                   | 1.9                | 1.33                                 | 1.9             |
| Wasmtime               | 0.33               | 15                                   | 15              |
| Global share (caniuse) | 96.78%             | 78.5%                                | see section 3   |

- Rust exposes the instructions in [`core::arch::wasm32`](https://doc.rust-lang.org/core/arch/wasm32/index.html), enabled with `#[target_feature(enable = "simd128")]` or `-Ctarget-feature=+simd128`. There is no runtime detection inside one module: the docs state the binary "will either have SIMD and can only run on engines which support SIMD, or it will not have SIMD at all". Ship two binaries (scalar and simd128) and pick one in JS, for example with a tiny validation probe; V8's guidance is the same ([v8.dev SIMD](https://v8.dev/features/simd)).
- `std::simd` (portable SIMD) is still unstable; the [tracking issue](https://github.com/rust-lang/rust/issues/86656) is open with no stabilisation date. On stable Rust use `core::arch::wasm32` directly, or the `wide` crate (Zlib/Apache-2.0/MIT) which maps to simd128 on wasm and SSE/AVX/NEON natively.
- LLVM auto-vectorises at `-O2`/`-O3` when simd128 is enabled ([v8.dev SIMD](https://v8.dev/features/simd)). For stencils, write the inner loop over contiguous slices with bounds checks hoisted (`chunks_exact`, pre-sliced rows) and no data-dependent branches; verify with `wasm-objdump` or `wasm2wat` that `f32x4`/`f64x2` instructions appear, because silent fallback to scalar is common (unverified as a general rate; check per kernel).
- Expected gain: 128-bit lanes hold two f64 or four f32. An f64 kernel therefore gains at most 2x, an f32 kernel at most 4x, before memory effects. V8 reports about 2.5x to 2.8x on a real workload (14-15 FPS to 38-40 FPS, [v8.dev SIMD](https://v8.dev/features/simd)). For a 7-point stencil plan on 1.5x (f64) and 2.5x to 3.5x (f32) (estimate).

Determinism rules that matter for reproducible waveforms:

- Rust guarantees IEEE 754-2008 results with round-to-nearest-even for `+ - * /`, `sqrt`, `mul_add` and casts, and its semantics forbid silently contracting `a * b + c` into a fused multiply-add ([RFC 3514](https://rust-lang.github.io/rfcs/3514-float-semantics.html)). Transcendental functions (`sin`, `exp`, `powf`) are not covered and may differ between platforms.
- WebAssembly arithmetic is deterministic except for NaN bit patterns and sign, threads with shared memory, relaxed SIMD and resource exhaustion ([Nondeterminism.md](https://github.com/WebAssembly/design/blob/master/Nondeterminism.md)). Wasmtime can canonicalise NaNs for fully deterministic runs ([Wasmtime docs](https://docs.wasmtime.dev/examples-deterministic-wasm-execution.html)).
- Relaxed SIMD is nondeterministic by design: `relaxed_madd` computes "with either one rounding or two roundings", and relaxed min/max differ for NaN and signed zero ([`core::arch::wasm32`](https://doc.rust-lang.org/core/arch/wasm32/index.html)). It is also absent from Safari. Do not use it in the engine.
- Practical policy:
  - Golden waveforms are defined by the scalar build. Scalar wasm and scalar native (x86-64 and AArch64) agree bit for bit if the code uses only basic operations and `sqrt`, never produces NaN, and takes `sin`/`exp`/`pow` from one pure-Rust implementation (the `libm` crate) on every target.
  - Element-wise SIMD (same operations per lane, no horizontal reordering of sums) is bit-identical to scalar. Reductions (energy, error norms) change summation order; fix the order or compare with a tolerance.
  - Explicit `mul_add` is correctly rounded everywhere but is slow without hardware FMA and is not a wasm instruction; avoid it in hot loops.
  - A leapfrog update that reads step `n` buffers and writes step `n+1` buffers gives the same bits for any thread count, because no cell depends on another cell written in the same pass.
  - A JavaScript reference stays bit-identical to an f64 Rust kernel for basic operations. For an f32 kernel the JS reference must wrap every operation in `Math.fround` (unverified that this is sufficient for all operations used; test it).
  - 32-bit x87 targets (i586) deviate from IEEE semantics per RFC 3514; do not use them for golden data.

### 3. Threads, SharedArrayBuffer and cross-origin isolation

- `SharedArrayBuffer` (SAB) and shared wasm memory are only available when `crossOriginIsolated` is true, which needs `Cross-Origin-Opener-Policy: same-origin` plus `Cross-Origin-Embedder-Policy: require-corp` or `credentialless` ([MDN crossOriginIsolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated), [MDN COEP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)).
- Support: SAB in Chrome 68, Edge 79, Firefox 79, Safari and iOS Safari 15.2, 97.13% global ([caniuse](https://caniuse.com/sharedarraybuffer)). `credentialless` in Chrome/Edge 96 and Firefox 119, not in Safari, 79.51% global ([caniuse](https://caniuse.com/mdn-http_headers_cross-origin-embedder-policy_credentialless)).
- GitHub Pages cannot set response headers. Workaround: [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) (MIT). A service worker re-serves every response with COOP/COEP added. Drawbacks: the page reloads once on first visit; the script must be a separate, un-bundled file on the same origin (no CDN); it needs a secure context; all cross-origin subresources must then satisfy COEP (or use its `credentialless` mode where supported); it does not work where service workers are unavailable (some private modes and embedded webviews, unverified per browser).
- Document-Isolation-Policy shipped in Chrome 137 desktop with `isolate-and-require-corp` and `isolate-and-credentialless` modes; Firefox does not support it and Safari has given no signal ([Chrome blog](https://developer.chrome.com/blog/document-isolation-policy), [caniuse](https://caniuse.com/mdn-http_headers_document-isolation-policy), [explainer](https://github.com/explainers-by-googlers/document-isolation-policy/)). It is also a response header, so it does not remove the GitHub Pages limitation.
- [wasm-bindgen-rayon](https://github.com/RReverser/wasm-bindgen-rayon) (1.3.0, Apache-2.0, [docs.rs](https://docs.rs/crate/wasm-bindgen-rayon/latest)) runs a Rayon pool on Web Workers. It requires nightly Rust, `-C target-feature=+atomics,+bulk-memory`, `-Z build-std=panic_abort,std`, `--target web`, and cross-origin isolation. So a threaded build is a third artefact, built with a pinned nightly, loaded only when `crossOriginIsolated` is true.
- Emscripten pthreads have the same header requirement and the same "two builds" consequence: its docs say a single binary cannot fall back to single-threaded operation, blocking calls on the main thread busy-wait, and memory growth with threads is slow for JS access ([Emscripten pthreads](https://emscripten.org/docs/porting/pthreads.html)). Nothing there is an advantage over Rust for this project.
- Fallback without SAB: several independent workers, each with its own wasm instance, exchanging `Float32Array` buffers as transferables. This suits coarse-grained work (one candidate, one utterance, one frequency sweep per worker). It does not suit per-time-step halo exchange in FDTD.
- `navigator.hardwareConcurrency` is Baseline since March 2022; browsers may report fewer logical cores than exist ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency)). `navigator.deviceMemory` is non-standard, has limited availability and reports a coarse, clamped value ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory)); treat it as a hint only. Use `max(1, hardwareConcurrency - 1)` workers and cap at about 4 on phones (estimate).
- iOS Safari: WebKit bug reports say only about 300 MB is reliably available to wasm pages ([bug 269777](https://bugs.webkit.org/show_bug.cgi?id=269777)) and that shared memories with large maxima failed on iOS 16.4 ([bug 255103](https://bugs.webkit.org/show_bug.cgi?id=255103)). Keep the initial memory small, declare a modest maximum for shared memory, and avoid reload loops. No official limit is documented (unverified).
- Electron can set COOP/COEP itself because the app controls how pages are served (unverified against Electron docs). A Chromium intent thread states that SAB "never worked on WebView" on Android at that time ([blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/1NKvbIj3dq4)); for Capacitor assume single-threaded wasm unless a device test proves otherwise (unverified for current WebView and WKWebView).

Decision: single-threaded wasm (scalar and simd128) is the default and must be sufficient. Threads are an optional accelerator behind a feature check.

### 4. Parallelising the solvers

Cost model for explicit FDTD (standard results, see Bilbao 2009 `10.1002/9780470749012`):

- The standard 3D leapfrog scheme is stable for `c * dt / dx <= 1 / sqrt(3)`. With `c = 350 m/s`, a 4 mm cell needs a solver rate of at least about 152 kHz and a 1 cm cell about 61 kHz (my arithmetic). Any cost model must use the internal solver rate, not the output audio rate.
- Halving the cell size multiplies cells by 8 and steps by 2: cost grows with `dx^-4`. Lowering the output sample rate alone saves nothing in the 3D solver.
- The vocal tract is small. A tract of about 100 cm3 has roughly 1 600 air cells at 4 mm and 100 000 at 1 mm, before the radiation volume (estimate). At two or three f32 fields per cell the whole problem fits in the L1 or L2 cache.

Consequences:

- Large-domain FDTD on multi-core CPUs is limited by memory bandwidth, and published single-node speed-ups are well below the core count: one shared-memory study is Ruiz-Cabello et al. 2020 (`10.1371/journal.pone.0238115`), and auto-tuned stencil work is Datta et al. 2008 (`10.1109/SC.2008.5222004`). Search summaries quote about 3x for AVX plus OpenMP over the best sequential code and about 40x for CUDA in room acoustics (unverified; primary numbers not read). GPU room codes: Webb and Bilbao 2011 (`10.1109/ICASSP.2011.5946404`), Micikevicius 2009 (`10.1145/1513895.1513905`); the NESS project reports large-room codes far from real time even on HPC ([NESS acceleration](https://www.ness.music.ed.ac.uk/acceleration)).
- For vocal-tract grids the limit is the opposite: each time step is so short (microseconds) that fork-join overhead per step can exceed the work. Threading a 2 000-cell grid will be slower than one core (estimate). Thread the 3D solver only for fine grids (roughly more than 50 000 active cells, estimate) using persistent workers and a barrier, not a task spawn per step.
- Order of work for the 3D kernel: (1) f32 fields, (2) compact sparse layout, (3) simd128, (4) cheaper physics tiers, (5) threads.
- f32 or f64: f32 halves memory traffic and doubles SIMD width. Keep f64 for the 1D waveguide, the source ODEs and recursive filters, where cost is negligible and low-frequency precision matters. Keep an f64 scalar 3D build as the reference for golden tests, and bound the f32 error against it (for example below -90 dB relative to the signal, to be measured).
- Sparse voxel layout: store active cells in x-runs (row segments) sorted in scan order so the inner loop is a contiguous slice; keep neighbour access as fixed strides inside a padded dense bounding box where possible, and use index lists only at boundaries. Precompute a per-cell boundary code or admittance so the interior loop is branch-free.
- Slab decomposition: split the bounding box along the tract's long axis into one slab per thread, pressure pass then velocity pass (staggered grid), or a two-buffer scalar-wave update. Both are race-free and bit-reproducible. Red-black ordering is only needed for in-place implicit or Gauss-Seidel style updates, which an explicit leapfrog scheme does not use.
- Cache blocking (tiling in y and z) matters only when one x-y plane no longer fits in L1; at vocal-tract sizes it is unnecessary (estimate).
- 1D waveguide: about `fs / 1000` junctions per sample for a 17.5 cm tract (section 12), so 48 junctions at 48 kHz, around 2.3 million junction updates per second. That is a few percent of one core (estimate). Do not parallelise it.
- Analysis-by-synthesis (voice copying, parameter fitting, recognition by synthesis) is embarrassingly parallel across candidates: population-based optimisers such as CMA-ES evaluate a whole generation independently (restart CMA-ES: Auger and Hansen 2005, `10.1109/cec.2005.1554902`). This works with plain workers and no SAB, and natively with Rayon. It is the best use of extra cores.
- Single-core path: the same code with a pool of size one; candidates are evaluated sequentially in time slices so the worker can still answer messages.

### 5. Real-time audio in browsers

- An `AudioWorkletProcessor` is called once per render quantum of 128 frames (2.67 ms at 48 kHz, 16 ms at 8 kHz, my arithmetic). MDN documents a `renderSizeHint` option (`"default"`, `"hardware"` or an integer) and `latencyHint` ([MDN AudioContext constructor](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)); treat `renderSizeHint` as not yet portable (unverified per browser).
- Chrome's design-pattern article recommends: wasm inside the worklet for light DSP; for heavy DSP a Worker that renders ahead into a SAB ring buffer read by the worklet, coordinated with `Atomics`. It gives the budget as about 3 ms per quantum at 44.1 kHz ([Audio Worklet design pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern)).
- Recommended architecture: the engine never runs in the worklet. The worklet is a sink with a small ring buffer and an underrun counter. Two transports:
  - SAB ring buffer (single producer, single consumer, wait-free) when `crossOriginIsolated` is true. An existing JS implementation is `ringbuf.js` (reported as MPL-2.0 by an aggregator, unverified); a Rust-side equivalent is `rtrb` (MIT/Apache-2.0, [repository](https://github.com/mgeier/rtrb)).
  - `MessagePort` fallback otherwise: the worker posts transferable `Float32Array` chunks (for example 20 to 50 ms) to a port owned by the worklet; the worklet copies them into a local ring buffer. This needs a deeper jitter buffer (100 to 300 ms, estimate) because message delivery competes with other work on the audio thread's queue.
- Latency equals the ring buffer fill plus `baseLatency` plus `outputLatency`. For interactive articulation control aim for 30 to 60 ms of queued audio with SAB and accept 150 ms or more on the fallback (estimate).
- Sample rates: MDN states `AudioContext({ sampleRate })` accepts 3 000 to 768 000 Hz and throws `NotSupportedError` otherwise ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)). The specification previously only required 8 000 to 96 000 Hz for buffers; the working group decided in November 2025 that contexts must accept the wider range, closed in January 2026 ([WebAudio issue 2649](https://github.com/WebAudio/web-audio-api/issues/2649)). The `sampleRate` option itself is supported from Chrome 74, Firefox 61 and Safari 14.1 ([caniuse](https://caniuse.com/mdn-api_audiocontext_audiocontext_options_samplerate_parameter)). An 8 kHz context should therefore work, but behaviour on Safari and Android devices was not tested (unverified).
- Safer design: keep the context at the device rate and resample in the worker (8 kHz to 48 kHz is an exact factor of 6; use a polyphase FIR or the `rubato` crate). This keeps the quantum at 2.67 ms, avoids device-specific resamplers, and lets quality tiers change rate without recreating the context.
- Background tabs: Chrome throttles background timers but treats audible tabs as foreground, with a grace period of a few seconds after audio stops ([Chrome background tabs](https://developer.chrome.com/blog/background_tabs)). Drive the producer from buffer level, not from `setInterval`, and expect throttling when silent (other browsers unverified).
- WebCodecs is not needed: the stream is raw PCM generated locally, and no encoded transport is involved.

Microphone capture for analysis:

- Request `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })`. These and `sampleRate`, `sampleSize`, `latency` are defined constraints; feature-detect with `getSupportedConstraints()` and read back `track.getSettings()` because browsers may ignore them ([MDN MediaTrackConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints)).
- Route `MediaStreamAudioSourceNode` to an `AudioWorkletNode` that forwards frames through the same ring buffer or port mechanism in the reverse direction. Samples arrive at the context rate; store that rate with the recording and resample in Rust to the analysis rate (for example 16 kHz for pitch and formants, 8 kHz for the lowest tier).
- Processing left on (noise suppression, AGC) distorts spectral tilt and level, which biases source-parameter fitting; report in the UI when the browser refused to disable it.

### 6. Non-blocking device benchmarking and adaptive quality

Available primitives:

| API                                   | Support                                                                                                                                                                                    | Use                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Worker micro-benchmark                | Everywhere                                                                                                                                                                                 | The real measurement; never blocks the main thread                          |
| `requestIdleCallback`                 | Chrome 47, Firefox 55, Safari off by default, 81.25% ([caniuse](https://caniuse.com/requestidlecallback))                                                                                  | Decide when to start; fall back to `setTimeout` after `load`                |
| `scheduler.postTask`                  | Chrome 94, Firefox 142, no Safari, 80.57% ([caniuse](https://caniuse.com/mdn-api_scheduler_posttask))                                                                                      | `priority: "background"` for the kick-off                                   |
| `scheduler.yield`                     | Chrome 129, Firefox 142, no Safari, 75.81% ([caniuse](https://caniuse.com/mdn-api_scheduler_yield), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield))               | Slice long tasks on single-core devices                                     |
| Compute Pressure (`PressureObserver`) | Experimental; Chrome/Edge 125 desktop only, 28.16% ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Compute_Pressure_API), [caniuse](https://caniuse.com/mdn-api_pressureobserver)) | Optional hint (`nominal`, `fair`, `serious`, `critical`) to step down early |
| `performance.now()`                   | 5 microseconds when isolated, 100 microseconds otherwise ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now))                                                         | Time slices of at least 20 ms so quantisation stays below 0.5%              |

Benchmark design:

- Run inside the engine worker, with the exact wasm binary that will be used, on a tiny fixed scene per tier family: 1D waveguide, 2D or 2.5D grid, coarse 3D grid.
- Start after first paint (idle callback or 1 to 2 s timeout). Run 3 to 5 slices of 20 to 40 ms each with a yield between them; take the median real-time factor (compute seconds per audio second). Total cost under 250 ms of one core (estimate).
- Derive per-tier cost by scaling with active cells times solver steps, which is exact for explicit schemes up to cache effects.
- Cache the result in `localStorage` or IndexedDB keyed by engine build hash, user agent and `hardwareConcurrency`, with a time-to-live (for example 7 days). On the next visit start with the cached tier immediately and re-measure in the background.
- Until the benchmark finishes, start on the cheapest tier that is always safe (1D at low rate), then step up. First sound must never wait for the benchmark.
- Synthesis itself is the continuous benchmark: for each chunk record compute time divided by audio duration. Thermal throttling, battery savers and background load show up there within seconds; there is no portable thermal API apart from the experimental Compute Pressure sources.

Controller design, borrowing from adaptive video streaming:

- Mapping: tier cost per audio second plays the role of bitrate; measured compute speed plays the role of network throughput; seconds of audio queued ahead play the role of the playback buffer.
- Throughput rule: choose the best tier whose predicted real-time factor is below a safety factor (the current 20% headroom corresponds to 0.8) of the smoothed measured speed. Good at start-up and after seeks.
- Buffer rule: BOLA chooses quality from buffer level alone and is provably near-optimal without throughput prediction (Spiteri, Urgaonkar, Sitaraman 2016, `10.1109/INFOCOM.2016.7524428`). Model-predictive control combines both (Yin et al. 2015, `10.1145/2785956.2787486`). The production lesson from dash.js is to use throughput rules when the buffer is low and buffer rules when it is high (Spiteri, Sitaraman, Sparacio 2019, `10.1145/3336497`).
- Add hysteresis: step down immediately on underrun risk, step up only after several seconds of margin, and limit switches per minute. Babylon's `SceneOptimizer` uses the same pattern (target 60 FPS, check every 2 000 ms, apply optimisations by priority until the target is met, optional "improvement mode" to raise quality) ([Babylon docs](https://doc.babylonjs.com/features/featuresDeepDive/scene/sceneOptimizer)). Drei's `PerformanceMonitor` keeps a 0 to 1 factor starting at 0.5 and moved in 0.1 steps by `onIncline` and `onDecline` callbacks ([drei docs](https://drei.docs.pmnd.rs/performances/performance-monitor), [R3F scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)).
- Offline (non-interactive) rendering needs no governor: render slower than real time at the requested tier and stream progress.

Click-free switching between tiers:

- Keep the voice source, noise generators and articulatory state outside the tract solver so they are continuous across a switch.
- Switch at chunk boundaries, preferably in closures and pauses where radiated energy is near zero.
- Otherwise pre-roll the new solver with the same source signal and geometry for about 30 ms, then crossfade over 5 to 20 ms. Rationale: a formant with 50 Hz bandwidth decays with time constant `1 / (pi * B)`, about 6.4 ms, so 30 ms of pre-roll reaches roughly -40 dB of the missing history (my arithmetic). The overlap doubles cost briefly; schedule it when the buffer is healthy.
- Exact state transfer is possible but not required: 3D to 1D by averaging pressure over cross-sections into forward and backward plane waves, 1D to 3D by imposing plane-wave fields. Treat as a later refinement.
- Always output at one fixed rate from the worker's resampler so tier changes alter bandwidth, not the stream format.

### 7. Manually triggered CI for expensive tests

Facts from GitHub documentation:

- `workflow_dispatch` inputs may be `boolean`, `choice`, `number`, `environment` or `string`; at most 25 top-level inputs; payload at most 65 535 characters; read them through the `inputs` context, which preserves booleans ([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).
- Standard hosted runners for public repositories: `ubuntu-latest` 4 CPU, 16 GB RAM, 14 GB SSD; Linux arm64 4 CPU, 16 GB; `windows-latest` 4 CPU, 16 GB; `macos-latest` 3 CPU (M1), 7 GB; private repositories get 2 CPU, 8 GB on Linux ([hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)).
- Limits: 6 hours per job, 35 days per workflow run, 256 jobs per matrix, 20 concurrent jobs on the Free plan (5 macOS) ([limits](https://docs.github.com/en/actions/reference/limits)).
- Cache: 10 GB per repository by default, entries unused for 7 days are evicted, caches are scoped by branch, keys are up to 512 characters ([dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)).
- Artifacts: default retention is 90 days; public repositories can set 1 to 90 days ([retention settings](https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization)); `retention-days` on upload cannot exceed the repository limit ([storing workflow data](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow)). From 2026-10-01 the same retention setting also governs checks, workflow runs and statuses ([changelog](https://github.blog/changelog/2026-08-27-actions-retention-will-cover-checks-workflow-runs-and-statuses)).

Useful actions and tools:

- [dtolnay/rust-toolchain](https://github.com/dtolnay/rust-toolchain) (MIT): `uses: dtolnay/rust-toolchain@stable` with `targets: wasm32-unknown-unknown`; the toolchain is chosen by the ref (`@stable`, `@nightly`, `@1.89.0`).
- [Swatinem/rust-cache](https://github.com/Swatinem/rust-cache) v2 caches `~/.cargo` and `target`; run it after the toolchain step. Its licence is LGPL-3.0, which is irrelevant to the shipped code (CI-only tool) but worth knowing.
- [taiki-e/install-action](https://github.com/taiki-e/install-action) (MIT/Apache-2.0) installs pinned prebuilt tools: `tool: wasm-pack@<version>,cargo-deny@<version>`; whether `wasm-bindgen-cli` is in its supported tool list was not checked (unverified), the documented alternative is `cargo install wasm-bindgen-cli --vers <version>`.
- Licence and advisory gates: `cargo deny check licenses` with an SPDX allow list in `deny.toml` ([cargo-deny licences](https://embarkstudios.github.io/cargo-deny/checks/licenses/cfg.html), [template](https://github.com/EmbarkStudios/cargo-deny/blob/main/deny.template.toml)); `cargo audit` against the RustSec database ([rustsec.org](https://rustsec.org/)). Allow list for a public-domain project: `Unlicense`, `CC0-1.0`, `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `Zlib`, `ISC` (plus `Unicode-3.0` if a dependency needs it, unverified).
- wasm tests: `wasm-bindgen-test` runs under Node by default with `wasm-pack test --node`, or manually with `runner = 'wasm-bindgen-test-runner'` and `cargo test --target wasm32-unknown-unknown`; headless browsers are configurable ([wasm-bindgen-test usage](https://wasm-bindgen.github.io/wasm-bindgen/wasm-bindgen-test/usage.html)). For raw-export modules a plain Node test that loads the `.wasm` and compares against native golden files is simpler. Running the same tests under Wasmtime is possible via a WASI target (unverified setup).

Sketch of a manual workflow (action versions deliberately left as placeholders; pin them when adopting):

```yaml
name: heavy-tests
on:
  workflow_dispatch:
    inputs:
      suite:
        description: Expensive suite to run
        type: choice
        options: [physics-golden, fdtd-convergence, copy-synthesis, all]
        default: physics-golden
      sample_rate:
        description: Output sample rate in Hz
        type: choice
        options: ['8000', '16000', '48000']
        default: '8000'
      upload_audio:
        description: Keep rendered audio as artifacts
        type: boolean
        default: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    strategy:
      fail-fast: false
      matrix:
        shard: [0, 1, 2, 3]
    env:
      SUITE: ${{ inputs.suite }}
      SAMPLE_RATE: ${{ inputs.sample_rate }}
    steps:
      - uses: actions/checkout@PINNED
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - uses: Swatinem/rust-cache@v2
      - uses: actions/cache@PINNED
        with:
          path: data/corpus
          key: corpus-${{ hashFiles('data/corpus.lock') }}
      - run: cargo run --release -p cli -- test --suite "$SUITE" --rate "$SAMPLE_RATE" --shard ${{ matrix.shard }}/4
      - if: ${{ inputs.upload_audio }}
        uses: actions/upload-artifact@PINNED
        with:
          name: audio-${{ matrix.shard }}
          path: out/
          retention-days: 7
```

- Pass inputs through `env`, never interpolate them into shell text.
- Split by shard so each job stays far below 6 hours; four 4-core runners give 16 cores for free on a public repository.
- Key dataset caches by a lock file with checksums; keep datasets under a few gigabytes to stay within the 10 GB cache, and download from the original host on a miss.
- Run cheap determinism checks (scalar wasm equals native golden hash) on every push; keep convergence studies, corpus-level copy synthesis and long renders manual.

### 8. Rust crates and licences

Versions, licences and dates are from the crates.io API on 2026-11-14. "OK" means compatible with an Unlicense/public-domain project under the stated allow list.

| Crate                                                            | Purpose                       | Licence                                                                         | Latest (updated) | Maturity and notes                                        |
| ---------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| [rustfft](https://github.com/ejmahler/RustFFT)                   | FFT                           | MIT OR Apache-2.0, OK                                                           | 6.4.1 (2025-09)  | Mature, SIMD paths incl. wasm                             |
| [realfft](https://github.com/HEnquist/realfft)                   | Real FFT wrapper              | MIT, OK                                                                         | 3.5.1 (2026-10)  | Maintained                                                |
| [microfft](https://gitlab.com/teskje/microfft-rs)                | `no_std` fixed-size FFT       | MIT, OK                                                                         | 0.6.0 (2024-04)  | Small, embedded focus                                     |
| [ndarray](https://github.com/rust-ndarray/ndarray)               | N-d arrays                    | MIT OR Apache-2.0, OK                                                           | 0.17.2 (2026-01) | Mature; not needed in the hot kernel                      |
| [nalgebra](https://github.com/dimforge/nalgebra)                 | Linear algebra                | Apache-2.0, OK                                                                  | 0.35.0 (2026-05) | Mature                                                    |
| [rayon](https://github.com/rayon-rs/rayon)                       | Data parallelism              | MIT OR Apache-2.0, OK                                                           | 1.12.0 (2026-04) | Mature; on wasm needs wasm-bindgen-rayon                  |
| [wide](https://github.com/Lokathor/wide)                         | Portable SIMD types on stable | Zlib OR Apache-2.0 OR MIT, OK                                                   | 1.7.1 (2026-09)  | Maintained; simd128 support                               |
| [pulp](https://github.com/sarah-quinones/pulp/)                  | SIMD with runtime dispatch    | MIT, OK                                                                         | 0.22.3 (2026-06) | Native dispatch; wasm value limited                       |
| [dasp](https://github.com/rustaudio/dasp)                        | Sample and signal types       | MIT OR Apache-2.0, OK                                                           | 0.11.0 (2020-05) | Stale; avoid new dependence                               |
| [rubato](https://github.com/HEnquist/rubato)                     | Resampling                    | MIT OR Apache-2.0, OK                                                           | 5.1.0 (2026-11)  | Active                                                    |
| [pitch-detection](https://github.com/alesgenova/pitch-detection) | McLeod/YIN style pitch        | MIT/Apache-2.0, OK                                                              | 0.3.0 (2022-06)  | Low activity                                              |
| [pyin](https://github.com/Sytronik/pyin-rs)                      | pYIN                          | MIT, OK                                                                         | 1.2.0 (2024-07)  | Small user base                                           |
| [hound](https://github.com/ruuda/hound)                          | WAV I/O                       | Apache-2.0, OK                                                                  | 3.5.1 (2023-09)  | Stable, finished                                          |
| [symphonia](https://github.com/pdeljanov/Symphonia)              | Audio decoding                | MPL-2.0, not on the allow list                                                  | 0.6.1 (2026-08)  | Mature; file-level copyleft, keep to CLI or tests if used |
| [claxon](https://github.com/ruuda/claxon)                        | FLAC decoding                 | Apache-2.0, OK                                                                  | 0.4.3 (2020-08)  | Stable, finished                                          |
| [cpal](https://github.com/RustAudio/cpal)                        | Native audio I/O              | Apache-2.0, OK                                                                  | 0.18.2 (2026-08) | Active; CLI only                                          |
| [wgpu](https://github.com/gfx-rs/wgpu)                           | WebGPU                        | MIT OR Apache-2.0, OK                                                           | 30.0.2 (2026-11) | Active; large binary on web (unverified size)             |
| [argmin](https://github.com/argmin-rs/argmin)                    | Optimisation framework        | MIT OR Apache-2.0, OK                                                           | 0.11.0 (2025-09) | Maintained                                                |
| [cmaes](https://github.com/pengowen123/cmaes)                    | CMA-ES                        | MIT OR Apache-2.0, OK                                                           | 0.2.2 (2024-12)  | Small; consider an in-house implementation                |
| [nlopt](https://github.com/adwhit/rust-nlopt)                    | NLopt bindings                | MIT bindings; C library has mixed licences incl. LGPL parts (unverified detail) | 0.8.1 (2025-03)  | Needs C toolchain; avoid for wasm                         |
| [rustfst](https://github.com/Garvys/rustfst)                     | Weighted FSTs                 | MIT/Apache-2.0, OK                                                              | 1.3.1 (2026-04)  | Maintained                                                |
| [kiddo](https://github.com/sdd/kiddo)                            | k-d tree                      | MIT OR Apache-2.0, OK                                                           | 6.3.0 (2026-09)  | Active                                                    |
| [fundsp](https://github.com/SamiPerttu/fundsp)                   | DSP graph library             | MIT OR Apache-2.0, OK                                                           | 0.23.0 (2026-01) | Active; reference for filter designs                      |
| [criterion](https://github.com/criterion-rs/criterion.rs)        | Benchmarks                    | Apache-2.0 OR MIT, OK                                                           | 0.8.2 (2026-02)  | Standard; dev-dependency only                             |

- Also checked: `libm` 0.2.16 (MIT) for cross-target transcendental functions, `rtrb` 0.4.1 (MIT OR Apache-2.0) for ring buffers, `wasm-bindgen-test` 0.3.80, `napi` 3.16.2 (MIT), `faer` 0.24.4 (MIT), `divan` 0.1.21, `wasm_thread` 0.3.3, `web-audio-api` 1.8.0 (MIT). `cobyla` 1.0.4 has a non-standard licence string; avoid.
- Policy: the wasm core should depend on nothing but `core`, `alloc` and optionally `libm`. Everything else belongs to the CLI, analysis tools or dev-dependencies, enforced by `cargo deny`.

## Part B: Physics quality

Two perceptual results should steer priorities before any detail:

- Birkholz and Drechsel 2021 (`10.1016/j.specom.2021.06.002`, [author PDF](https://vocaltractlab.de/publications/birkholz-2021-speech-communication.pdf)) added piriform fossae, transvelar coupling and laryngeal wall radiation to an articulatory synthesiser; listeners did not prefer the versions with these features, and the authors conclude that they matter less for naturalness than the voice source (result as summarised in search results; full text not re-read).
- Blandin, Didone and Birkholz 2024 (ISSP 2024, `10.21437/issp.2024-4`, [ORBi record](https://orbi.uliege.be/handle/2268/319000)) compared 1D and 3D acoustic models for seven static phonemes and found no significant effect of the acoustic model on rated naturalness; differences appear mainly above about 5 kHz.
- Added by the case study author after a second search: an earlier study of the same group (Blandin and others 2023, IEEE/ACM Transactions on Audio, Speech, and Language Processing 31, 3837-3847, [ORBi record](https://orbi.uliege.be/handle/2268/307849)) compared sustained vowels from a 1D model, a 3D model and a bandwidth extension without a physical basis, and listeners favoured the more physically accurate stimuli; the authors limit the result to /o/ and /u/. So the evidence is mixed: 3D is audibly better for some vowels, and no overall effect was found across seven phonemes (both results as summarised in search results; full texts not read).

So the largest audible gains per unit of compute are in the source, noise and articulation models, not in tract dimensionality.

### 9. Voice source

| Model                           | Reference                                                                                      | State and cost per sample                                                                                            | Strength                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| LF (parametric flow derivative) | Fant, Liljencrants, Lin 1985 (STL-QPSR 4/1985, no DOI)                                         | One exponential-sinusoid or exponential evaluation per sample; parameter solve once per period                       | Cheap, well-studied voice-quality control                |
| LF with `Rd`                    | Fant 1995 (STL-QPSR, no DOI); Gobl 2017 `10.21437/interspeech.2017-1140`                       | Same; one control from pressed (about 0.3) to breathy (about 2.7) (range from memory, unverified)                    | One-knob voice quality                                   |
| Linear-filter LF                | Perrotin et al. 2021 `10.1121/10.0005879`; Gobl 2021 `10.21437/interspeech.2021-1625`          | Two low-order filters per sample                                                                                     | Perceptually equivalent to LF; easy band-limiting        |
| Two-mass                        | Ishizaka and Flanagan 1972 `10.1002/j.1538-7305.1972.tb02651.x`                                | Two coupled oscillators plus flow equation; tens of operations; needs oversampling for stability (unverified factor) | Self-oscillation, source-tract interaction               |
| Two-mass, triangular glottis    | Birkholz, Kröger, Neuschaefer-Rube 2011 `10.21437/interspeech.2011-685`                        | As above                                                                                                             | Breathy to pressed continuum                             |
| Body-cover (three-mass)         | Story and Titze 1995 `10.1121/1.412234`; rules: Titze and Story 2002 `10.1121/1.1496080`       | Three oscillators                                                                                                    | Muscle-based control of register and pitch               |
| Geometric / kinematic           | Titze 1984 `10.1121/1.390530`; Birkholz, Drechsel, Stone 2019 `10.21437/Interspeech.2019-2410` | Prescribed glottal area; a few operations plus flow equation                                                         | Robust, no oscillation-onset failures, still interactive |

- Reviews: Erath et al. 2013 (`10.1016/j.specom.2013.02.002`) for lumped models; Zhang 2016 (`10.1121/1.4964509`) for mechanics; Alku 2011 (`10.1007/s12046-011-0041-5`) for inverse filtering used to fit source parameters.
- All of these cost far less than any 2D or 3D tract solver. Source model choice is a quality decision, not a performance one.
- Source-tract interaction: Titze 2008 (`10.1121/1.2832337`) shows that nonlinear coupling changes harmonic amplitudes and can cause pitch jumps and subharmonics when harmonics cross formants. To capture it, compute glottal flow each sample from the transglottal pressure (Bernoulli plus viscous terms, flow separation after Pelorson et al. 1994, `10.1121/1.411449`) with the tract and trachea input pressures as boundary values, instead of injecting a precomputed flow. Cost: one square root per sample. A prescribed-area geometric model plus this flow equation is the best cost-to-benefit step.
- Subglottal system: resonances near 600, 1 550 and 2 200 Hz in adults (values from memory, unverified) add pole-zero pairs and interact with vowels (Lulich 2010 `10.1016/j.wocn.2008.10.006`; Lulich et al. 2012 `10.1121/1.4748582`). Time-domain models: Ho, Zañartu, Wodicka 2011 (`10.1121/1.3543971`); loading effects on phonation: Zañartu, Mongeau, Wodicka 2007 (`10.1121/1.2409491`). Implementation: a short lossy waveguide for trachea and bronchi with a resistive lung termination, a few tens of junctions.
- Aspiration and breathiness: noise injected at the glottis, amplitude-modulated by glottal area or flow; add a glottal chink (posterior gap) for breathy voice (Klatt and Klatt 1990 `10.1121/1.398894`; Elie and Laprie 2016 `10.1016/j.specom.2016.06.002`).
- Frication: noise sources placed downstream of the constriction with strength depending on pressure drop and constriction area (Stevens 1971 `10.1121/1.1912751`; Stevens, Acoustic Phonetics, `10.7551/mitpress/1072.001.0001`), source spectra and placement per place of articulation (Narayanan and Alwan 2000 `10.1109/89.841215`), enhanced area functions for noise source modelling (Birkholz 2014 ISSP, [PDF](https://tu-dresden.de/ing/elektrotechnik/ias/stks/ressourcen/dateien/forschung/publikationen/birkholz-2014-issp.pdf?lang=en)), turbulence losses in a time-varying tract (Birkholz, Jackèl, Kröger 2007 `10.1109/TASL.2006.889731`). Voiced fricatives need the noise modulated at the fundamental (Jackson and Shadle 2000 `10.1121/1.1289207`). Aeroacoustic theory: Howe and McGowan 2005 (`10.1098/rspa.2004.1405`), Krane 2005 (`10.1121/1.1862251`).
- Plosives: model the low-frequency aerodynamics (pressure build-up behind the closure, wall compliance), then the release sequence of transient, frication burst, aspiration and voicing onset (Stevens 1993 `10.1016/0167-6393(93)90035-J`; McGowan 1994 `10.1016/0167-6393(94)90055-8`). The transient falls out of the model if intraoral pressure is a state variable and the constriction area opens over a few milliseconds.
- 2D coupling example: Zappi et al. 2016 (`10.1121/2.0000395`) ran a 2D FDTD tract with a vocal-fold model in real time on a GPU.
- Band-limiting: the LF flow derivative has a slope discontinuity at closure, which aliases audibly at 8 kHz. Generate the source at a fixed high internal rate (for example 44.1 or 48 kHz) and decimate, or use the filter-based formulation.

### 10. Tract acoustics

Losses and boundaries:

- Yielding walls: mass-spring-damper wall impedance raises the lowest resonance and widens low-formant bandwidths; without it the first formant of close vowels and voiced closures is wrong (Sondhi 1974 `10.1121/1.1914649`; Fleischer et al. `10.1007/s10237-014-0632-2`; measurements: Hanna, Smith, Wolfe 2016 `10.1121/1.4948754`).
- Viscous and thermal boundary losses grow with the square root of frequency; in time-domain 1D models they are implemented as small per-section filters (Maeda 1982 `10.1016/0167-6393(82)90017-6`; Bilbao 2009 `10.1002/9780470749012`).
- Lip radiation: piston in a baffle or sphere, approximated by a low-order filter in 1D (Flanagan 1972 `10.1007/978-3-662-01562-9`); in 2D and 3D solvers the radiation volume is meshed and terminated with an absorbing layer (PML: Berenger 1994 `10.1006/jcph.1994.1159`). Radiation dominates high-formant bandwidths, so a crude reflection constant is audible.
- Locally reacting impedance walls in FDTD: Kowalczyk and van Walstijn 2008 (`10.3813/AAA.918107`); finite-volume formulation for irregular boundaries: Bilbao et al. 2016 (`10.1109/TASLP.2015.2500018`). These remove much of the staircase error at coarse cells.
- Geometry resolution matters more than dispersion at coarse grids: one face of a 4 mm cell is 0.16 cm2 and of a 1 cm cell is 1 cm2, while fricative constrictions are around 0.1 to 0.3 cm2 (my arithmetic; constriction range from Stevens, unverified exact values). Sub-cell (partial-volume or impedance-weighted) boundaries or a 1D insert for narrow constrictions are required for consonants.

Side branches:

- Nasal tract and paranasal sinuses add pole-zero pairs that characterise nasals and nasalised vowels (Dang, Honda, Suzuki 1994 `10.1121/1.410150`). In 1D this is a three-port junction at the velum plus Helmholtz resonators.
- Piriform fossae create spectral dips around 4 to 5 kHz and shift lower formants slightly (Dang and Honda 1997 `10.1121/1.417990`; frequency region from memory, unverified). Cheap to add as two short side branches, but see the perceptual caveat above.

Solver families:

| Method                                              | Reference                                                                                                                                                                                                                                                                         | Typical role                                                                                                                                                             | Relative cost                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Frequency-domain transmission line (chain matrices) | Sondhi and Schroeter 1987 `10.1109/TASSP.1987.1165240`                                                                                                                                                                                                                            | Exact 1D reference with frequency-dependent losses; inner loop of fitting                                                                                                | Very low: one 2x2 complex product per section per frequency |
| 1D waveguide (Kelly-Lochbaum)                       | Kelly and Lochbaum 1962 (no DOI); Strube 2000 `10.1121/1.1308046`                                                                                                                                                                                                                 | Real-time tier everywhere                                                                                                                                                | Very low                                                    |
| 2D DWM / FDTD                                       | Mullen, Howard, Murphy 2006 `10.1109/TSA.2005.858052` and 2007 `10.1109/TASL.2006.876751`; Arnela and Guasch 2014 `10.1121/1.4837221` and 2017 `10.1109/TASLP.2017.2735179`                                                                                                       | Middle tier; can be tuned to match 3D plane-wave behaviour                                                                                                               | Low to medium                                               |
| 2.5D FDTD                                           | Mohapatra, Zappi, Fels 2019 `10.21437/Interspeech.2019-1764` ([ISCA page](https://www.isca-archive.org/interspeech_2019/mohapatra19_interspeech.html)); comparative study [arXiv 2102.04588](https://arxiv.org/abs/2102.04588v1); 2024 follow-up `10.21437/interspeech.2024-1749` | Middle tier with a depth term per cell; follow-up claims agreement with 3D up to about 12 kHz at roughly an order of magnitude less cost (secondary sources, unverified) | Medium                                                      |
| 3D FDTD                                             | Takemoto, Mokhtari, Kitamura 2010 `10.1121/1.3502470`                                                                                                                                                                                                                             | High tier; captures transverse modes and side cavities                                                                                                                   | High, grows with `dx^-4`                                    |
| 3D DWM                                              | Speed, Murphy, Howard 2014 `10.1109/TASLP.2013.2294579`; dynamic: Gully, Daffern, Murphy 2018 `10.1109/TASLP.2017.2774921`                                                                                                                                                        | Equivalent to FDTD on the same grid; dynamic variant changes impedance instead of moving boundaries (from memory, unverified)                                            | High                                                        |
| 3D FEM                                              | Arnela et al. 2016 `10.1121/1.4962488`; moving geometry: Dabbaghchian, Arnela, Engwall 2020 `10.1002/cnm.3407`                                                                                                                                                                    | Offline reference on body-fitted meshes                                                                                                                                  | Very high                                                   |
| Multimodal                                          | Blandin et al. 2015 `10.1121/1.4906166` and 2022 `10.1109/ACCESS.2022.3187424`                                                                                                                                                                                                    | Efficient 3D reference for waveguide-like geometry                                                                                                                       | Medium, frequency domain                                    |
| BEM                                                 | Kagawa, Shimoyama, Yamabuchi 1992 `10.1016/0022-460x(92)90523-z`; Motoki 2002 `10.1250/ast.23.207`                                                                                                                                                                                | Frequency-domain reference incl. radiation                                                                                                                               | High, dense matrices                                        |
| Lattice Boltzmann                                   | No vocal-tract reference verified in this research                                                                                                                                                                                                                                | Flow plus acoustics; needs very fine grids                                                                                                                               | Very high (unverified)                                      |

- What 3D adds: transverse modes and geometric detail change spectra above roughly 4 to 5 kHz, and affect directivity (Blandin et al. 2015; Arnela et al. 2016; Takemoto et al. 2010). Below that, a well-built 1D model with correct losses and side branches matches 3D closely. Printable reference geometries with measured transfer functions exist for validation (Birkholz et al. 2020, `10.1038/s41597-020-00597-w`), along with MRI area functions (Story, Titze, Hoffman 1996 `10.1121/1.415960`).
- Dispersion: the standard 7-point scheme has direction-dependent phase error that grows with frequency; a common rule is about ten cells per wavelength (unverified as a threshold), which for 4 mm cells is about 8.75 kHz (my arithmetic). Audibility thresholds were studied by Saarelma et al. 2016 (`10.1121/1.4945746`). Better schemes: compact explicit 27-point family (Kowalczyk and van Walstijn 2011 `10.1109/TASL.2010.2045179`), optimised wide stencils (Hamilton and Bilbao 2016 `10.1121/2.0000455`, 2017 `10.1109/TASLP.2017.2744799`), modified-equation schemes (Bilbao and Hamilton 2018 `10.1016/j.jcp.2018.04.012`). For a tract that is only tens of cells long, accumulated dispersion is small; boundary representation is the larger error (estimate).
- Moving geometry: in 1D, interpolate areas smoothly and handle length change with fractional delay (section 12). In grid solvers, avoid switching cells between air and wall abruptly, which injects clicks; use time-varying wall admittance or immersed boundaries (Bilbao 2022 `10.1121/10.0009768`; Gully et al. 2018; a 2D immersed-boundary diphthong model appeared at Interspeech 2025, `10.21437/interspeech.2025-1486`).
- Bandwidth and naturalness: energy above 5 kHz is perceptually relevant for quality, talker and consonant cues (Monson et al. 2014 `10.3389/fpsyg.2014.00587`; Monson, Lotto, Story 2014 `10.1121/1.4829525`; Vitela, Monson, Lotto 2015 `10.1121/1.4903917`). Moore and Tan 2003 (`10.1121/1.1577552`) found naturalness falls when the upper cut-off is lowered from about 11 kHz to 7 kHz (figures from a secondary source, unverified). Stelmachowicz et al. 2001 (`10.1121/1.1400757`) found /s/ recognition for female and child talkers kept improving up to a 9 kHz bandwidth. Target at least 16 kHz bandwidth (32 kHz sampling or more) for the top tiers; frication noise shaping matters more than tract dimensionality in that band.

### 11. Articulation control

- Task dynamics and gestural scores: gestures are critically damped second-order systems acting on tract variables (constriction location and degree), overlapping in time (Saltzman and Munhall 1989 `10.1207/s15326969eco0104_2`; Browman and Goldstein 1992 `10.1159/000261913`).
- Target approximation: articulators and pitch approach successive targets through a higher-order critically damped linear system, which gives smooth velocity profiles and natural undershoot (Xu and Wang 2001 `10.1016/S0167-6393(00)00063-7`; Prom-on, Xu, Thipakorn 2009 `10.1121/1.3037222`; Birkholz, Kröger, Neuschaefer-Rube 2011 `10.1109/TASL.2010.2091632`).
- Coarticulation: vowel-to-vowel gestures with superimposed consonants (Öhman 1966 `10.1121/1.1909864`, 1967 `10.1121/1.1910340`); coarticulatory resistance by degree of articulatory constraint (Recasens, Pallarès, Fontdevila 1997 `10.1121/1.419727`); context-dependent consonant targets for synthesis (Birkholz 2013 `10.1371/journal.pone.0060603`).
- Articulatory and area-function parameterisations to drive the tract: Maeda 1990 (`10.1007/978-94-009-2037-8_6`), Dang and Honda 2004 (`10.1121/1.1639325`), Story 2005 (`10.1121/1.1869752`), with phrase- and sentence-level simulation in Story 2013 (`10.1016/j.csl.2012.10.005`) and Story and Bunton 2024 (`10.1121/10.0027734`).
- Durations without neural networks: Klatt's rule system stretches each segment between a minimum and an inherent duration according to context rules (Klatt 1976 `10.1121/1.380986`; Klatt 1987 `10.1121/1.395275`; the 1979 chapter has no DOI); sums-of-products models fit a small number of interpretable factors to data (van Santen 1992 `10.1016/0167-6393(92)90027-5`, 1994 `10.1006/csla.1994.1005`).
- Calibration from data by optimisation:
  - Fit targets and time constants to formant tracks, EMA or real-time MRI contours by analysis-by-synthesis (Prom-on, Birkholz, Xu 2014 `10.1186/1687-4722-2014-23`; Gao, Stone, Birkholz 2019 `10.21437/interspeech.2019-1334`); inversion methods are reviewed by Schroeter and Sondhi 1994 (`10.1109/89.260356`).
  - Use the frequency-domain transmission-line model as the inner forward model (formants from an area function in well under a millisecond, estimate), then refine with the time-domain solver. This makes fitting feasible on one core in a browser.
  - Use derivative-free optimisers (CMA-ES, Nelder-Mead) with candidates evaluated in parallel workers; keep parameters physically bounded so results stay interpretable.
  - Monophthong shapes may suffice for diphthongs with good dynamics (Stone and Birkholz 2024, `10.1016/j.specom.2024.103041`, title only verified).

### 12. Robustness at the lowest settings

- Narrowband speech is intelligible: telephony standardised 8 000 samples per second with 8-bit logarithmic (mu-law or A-law) coding at 64 kbit/s in ITU-T G.711 (as summarised in search results; background at [Cisco waveform coding](https://www.cisco.com/c/en/us/support/docs/voice/h323/8123-waveform-coding.html)). Classic intelligibility work: French and Steinberg 1947 (`10.1121/1.1916407`); consonant confusions under low-pass filtering affect place of articulation most (Miller and Nicely 1955 `10.1121/1.1907526`). Fricatives such as /s/ and /f/ lose their main cues below 4 kHz, so the 8 kHz tier must be tested on those contrasts specifically.
- Recognition at 8 kHz is standard practice: telephone corpora such as SWITCHBOARD are 8 kHz (Godfrey et al. 1992 `10.1109/ICASSP.1992.225858`). A non-neural recogniser (MFCC or filter-bank features with DTW or HMMs) can therefore run on the lowest tier; expect weaker fricative discrimination.
- Section count: a Kelly-Lochbaum section has length `c / (2 * fs)`. With `c = 350 m/s`: 2.19 cm at 8 kHz, 1.09 cm at 16 kHz, 3.6 mm at 48 kHz, so a 17.5 cm tract has `fs / 1000` sections: 8, 16 and 48 (my arithmetic). Eight sections cannot represent constriction place or tract length (one section is 12.5% of the length, a formant error of the same order).
- Therefore decouple the solver rate from the output rate: run the 1D solver at a fixed internal rate (32 to 48 kHz, cost still negligible) and decimate to 8 kHz with a proper anti-alias filter. "Lowest setting" then means low output rate and cheap model, not a coarse tract.
- If a truly low-rate solver is required (very weak devices), use fractional-delay techniques for length and section boundaries (Laakso et al. 1996 `10.1109/79.482137`; Välimäki and Karjalainen 1994 `10.21437/icslp.1994-156`; Mathur, Story, Rodriguez 2006 `10.1109/TSA.2005.858550`) or switch to a formant-level rendering derived from the frequency-domain model.
- Bit depth: Web Audio uses 32-bit float throughout, so there is nothing to gain from lower bit depth inside the app. For export or transport, 16-bit PCM is transparent; 8-bit mu-law is the practical minimum (roughly 13 to 14 bits of linear dynamic range, unverified).
- Test matrix for the lowest tier: every phoneme class rendered at 8 kHz output, single core, scalar wasm, MessagePort transport, no SAB, with underrun count zero and an intelligibility proxy (formant and spectral-moment checks against the high tier band-limited to 4 kHz).

## Decision tables

### Engine decisions

| Option                                                         | Expected gain                                                                     | Cost / risk                                                                                  | Recommendation                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Rust `no_std` core with raw `extern "C"` exports, scalar build | Parity with hand-written WAT, one source for wasm and native                      | Port effort; unsafe FFI boundary                                                             | Do first; scalar build defines golden output               |
| wasm-bindgen convenience layer                                 | Ergonomic JS API                                                                  | Glue code, version pinning, worklet compatibility                                            | Optional feature, not in the kernel path                   |
| simd128 second binary                                          | 1.5x (f64) to about 3x (f32) on stencils (estimate)                               | Two artefacts, feature probe                                                                 | Do; 96.78% support                                         |
| f32 fields in 3D solver                                        | Up to 2x on top of SIMD, half the memory                                          | Loses bit-identity with f64 reference; needs error bound                                     | Do for 3D; keep f64 for 1D, source, filters                |
| Relaxed SIMD                                                   | Small (FMA)                                                                       | Nondeterministic, no Safari                                                                  | Do not use                                                 |
| Wasm threads (nightly, wasm-bindgen-rayon) for FDTD            | Under 3x on 4 cores for fine grids; negative for small grids (estimate)           | Nightly toolchain, cross-origin isolation, service worker on GitHub Pages, iOS memory issues | Later, optional, only for fine 3D grids                    |
| Plain worker pool for candidate evaluation                     | Near-linear with cores for fitting and copying                                    | Memory per instance                                                                          | Do; works without SAB                                      |
| coi-serviceworker on GitHub Pages                              | Enables SAB ring buffer and threads                                               | First-load reload, COEP side effects                                                         | Offer as progressive enhancement; app must work without it |
| SAB ring buffer to AudioWorklet                                | Lowest latency, no allocation on the audio thread                                 | Needs isolation                                                                              | Use when available, MessagePort fallback always present    |
| AudioContext at device rate plus worker resampler              | Stable across devices and tiers                                                   | Resampler code                                                                               | Do; do not rely on 8 kHz contexts                          |
| Background worker benchmark plus buffer-aware governor         | Correct tier within about a second, no blocking                                   | Tuning hysteresis                                                                            | Do; cache result, re-measure from live timings             |
| 2D or 2.5D middle tier                                         | Fills the gap between 1D and 3D at 10x to 100x less than 3D (estimate)            | New solver to validate                                                                       | Do after the 1D upgrades                                   |
| WebGPU path                                                    | Large for fine 3D grids                                                           | f32 only, uneven support, async readback latency                                             | Keep optional; not on the critical path                    |
| napi-rs native addon                                           | Up to about 1.5x to 2x over wasm in Node (from Jangda et al., may be lower today) | Per-platform binaries                                                                        | Skip; ship a native CLI instead                            |
| Manual `workflow_dispatch` heavy suites with shards            | 16 free cores per run, no cost on pushes                                          | Cache limits, 6 h job cap                                                                    | Do                                                         |

### Physics upgrades

| Physics upgrade                                                                                                                 | Audible benefit (evidence)                                                                                               | Cost                                | Priority |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | -------- |
| Interactive glottal flow (prescribed-area geometric model plus Bernoulli flow coupled to tract and trachea)                     | High: voice source dominates naturalness (Birkholz and Drechsel 2021); interaction effects (Titze 2008)                  | Negligible per sample               | 1        |
| Voice-quality control with `Rd`-style parameter and aspiration noise modulated by glottal area                                  | High for expressiveness and breathiness (Fant 1995; Klatt and Klatt 1990)                                                | Negligible                          | 1        |
| Aerodynamic noise sources with pressure- and area-dependent strength, voicing modulation, plosive pressure build-up and release | High for consonant intelligibility at every rate (Stevens 1971, 1993; Narayanan and Alwan 2000; Jackson and Shadle 2000) | Low                                 | 1        |
| Target-approximation articulation with coarticulation model and rule-based durations, calibrated by optimisation                | High: dynamics drive intelligibility and naturalness (Birkholz et al. 2011; Prom-on et al. 2014)                         | Low at run time; fitting is offline | 1        |
| Wall vibration, viscous-thermal losses and proper lip radiation in 1D                                                           | Medium to high: correct bandwidths and low first formant (Sondhi 1974; Maeda 1982)                                       | Low                                 | 2        |
| Fixed high internal rate for source and 1D solver with decimation, fractional length handling                                   | High at 8 to 16 kHz output (aliasing and length quantisation, section 12)                                                | Low                                 | 2        |
| Nasal tract with sinuses                                                                                                        | Medium: nasal identity (Dang, Honda, Suzuki 1994)                                                                        | Low                                 | 2        |
| Subglottal tract                                                                                                                | Low to medium (Lulich 2010; Ho et al. 2011)                                                                              | Low                                 | 3        |
| Frequency-domain transmission-line reference                                                                                    | Indirect: test oracle and fast fitting (Sondhi and Schroeter 1987)                                                       | Low                                 | 2        |
| 2D or 2.5D tier with impedance boundaries                                                                                       | Medium above 4 kHz (Arnela and Guasch 2014; Mohapatra et al. 2019)                                                       | Medium                              | 3        |
| Sub-cell or immersed boundaries and impedance walls in 3D                                                                       | Medium: removes staircase errors at coarse cells (Bilbao et al. 2016; Bilbao 2022)                                       | Medium to high                      | 3        |
| Piriform fossae, transvelar coupling, wall radiation                                                                            | Low measured benefit (Birkholz and Drechsel 2021)                                                                        | Low                                 | 4        |
| Higher-order or optimised 3D stencils                                                                                           | Low for short tracts; matters for large radiation domains (Hamilton and Bilbao 2017; Saarelma et al. 2016)               | Medium                              | 4        |
| Finer 3D grids as the main quality lever                                                                                        | Low measured benefit for naturalness (Blandin et al. 2024); useful as validation reference                               | Very high (`dx^-4`)                 | 4        |

## Items that could not be verified

- Years of the wasm-pack 0.14 to 0.15.1 releases; current major versions of `actions/checkout`, `actions/cache`, `actions/upload-artifact`.
- Bun's wasm import behaviour beyond the loader list; Node's handling of `fetch` for local files; whether wasm-bindgen glue runs unmodified in `AudioWorkletGlobalScope`.
- Electron and Capacitor cross-origin isolation behaviour (no official page opened); Android WebView and WKWebView SAB support today.
- iOS Safari memory and thread limits beyond bug reports; Safari behaviour for 8 kHz `AudioContext` and for `renderSizeHint`; background throttling outside Chrome.
- `ringbuf.js` licence and maintenance; Wasmtime-based test setup; RustSec action details; `wgpu` binary size on the web.
- Quantitative multi-core FDTD speed-ups (only search summaries seen); all "(estimate)" figures for vocal-tract grids, thread overhead and benchmark durations.
- Numerical details quoted from memory: `Rd` range, subglottal resonance frequencies, piriform dip frequencies, Moore and Tan cut-offs, ten-cells-per-wavelength rule, mu-law dynamic range, Gully et al. method details, the 2.5D follow-up's accuracy and speed claims.
- Sources without DOI and not opened online: Fant, Liljencrants and Lin 1985; Fant 1995; Kelly and Lochbaum 1962; Klatt 1979; ITU-T G.711 text. No verified lattice-Boltzmann vocal-tract reference was found.
- Abstracts of Birkholz and Drechsel 2021 and Blandin et al. 2024 were read only through search-result summaries, not the full papers.
