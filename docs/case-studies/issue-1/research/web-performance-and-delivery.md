# Web Performance, Hardware Adaptation, Delivery and Data

Research notes for issue #1. This file covers the browser runtime (audio
thread, GPU, cross-origin isolation), level-of-detail and headroom control,
delivery targets (GitHub Pages, npm library, CLI, streaming server API,
Docker), and open anatomical data, including a published vowel area-function
table. Every factual claim links to its source. Numbers marked "derived" are
our own arithmetic.

## Audio thread

- `AudioWorkletProcessor.process()` currently receives blocks that are "always
  128 frames long". MDN says code "must always check the size of the sample
  array" because the size may change. Returning `false` (or omitting
  `return`) lets the browser stop the node
  ([MDN: process()](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process)).
- The Web Audio API editor's draft adds `renderSizeHint` to the
  `AudioContext` options, with a default render quantum of 128 frames, and a
  `"hardware"` option that lets the user agent choose
  ([Web Audio API draft](https://webaudio.github.io/web-audio-api/)).
- `latencyHint` accepts `"interactive"` (the default, lowest glitch-free
  latency), `"balanced"` or `"playback"`. `sampleRate` is typically
  8,000-96,000 Hz, and 44,100 Hz is the most common default
  ([MDN: AudioContext()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)).
- Chrome's Audio Worklet design-pattern article covers heavy DSP:
  - Run DSP in a dedicated Worker, and connect it to the worklet through a
    SharedArrayBuffer ring buffer synchronized with Atomics.
  - The worklet "must not be synchronously blocked".
  - The per-quantum budget is "only 3ms at the sample rate of 44.1Khz".
  - WASM avoids "JIT compilation and garbage collection" overhead.
  - Source:
    [Chrome for Developers](https://developer.chrome.com/blog/audio-worklet-design-pattern).
- Derived budget: 128 frames at 48 kHz is 2.667 ms per quantum. A 1D
  Kelly-Lochbaum tract with 44 sections run twice per sample, as Pink Trombone
  does, costs about 128 x 2 x 44 = 11,264 junction updates per quantum, which
  is trivial. 3D FDTD costs are tabulated in `articulatory-synthesis.md`.
- Pink Trombone itself uses the deprecated `ScriptProcessorNode` with
  512-sample blocks ([source](https://dood.al/pinktrombone/)). A new
  implementation should use AudioWorklet.

## Cross-origin isolation (needed for SharedArrayBuffer and threads)

- SharedArrayBuffer requires a secure context and cross-origin isolation.
  Check it with `crossOriginIsolated`
  ([MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)).
- The required headers are `Cross-Origin-Opener-Policy: same-origin` plus
  `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`)
  ([MDN: COEP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)).
- `performance.now()` resolution is 5 microseconds when cross-origin isolated
  and 100 microseconds otherwise
  ([MDN: performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)).
  This matters for measuring per-quantum DSP time.
- GitHub Pages documents no way to set custom headers. Its published limits
  are a 1 GB maximum site size, a soft limit of 100 GB per month of
  bandwidth, and a soft limit of 10 builds per hour; the build limit does not
  apply to custom Actions workflows
  ([GitHub Docs: Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)).
- `coi-serviceworker` (MIT) adds COOP and COEP from a service worker so that
  GitHub Pages can be cross-origin isolated. Its rules:
  - It must be a separate file.
  - It cannot be loaded from a CDN.
  - The page must be served over HTTPS or from localhost.
  - Source:
    [gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker).
- Design consequence (ours): keep a non-SAB fallback path that uses
  `postMessage` with ordinary ArrayBuffers, as the MDN example shows, for
  cases where isolation fails.

## GPU

- WebGPU support status
  ([web.dev, 2025-11-25](https://web.dev/blog/webgpu-supported-major-browsers?hl=en)):
  - Chrome and Edge support it from version 113 on Windows (D3D12), macOS
    and ChromeOS, and from Chrome 121 on Android 12+ with Qualcomm or ARM
    GPUs. Linux support is still in progress.
  - Safari supports it on macOS, iOS, iPadOS and visionOS 26.
  - Firefox supports it on Windows from 141 and on Apple Silicon macOS Tahoe
    from 145. Linux and Android support is still in progress.
- caniuse reports 87.82% global support (85.8% full plus 2.02% partial), and
  lists desktop Safari as partial support
  ([caniuse: WebGPU](https://caniuse.com/webgpu)).
- The WebGPU API needs a secure context and is available in workers via
  `WorkerNavigator.gpu`. Compute pipelines dispatch workgroups for GPGPU work
  ([MDN: WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)).
  This allows an FDTD solver in a worker that feeds the audio ring buffer.
- GPU timing: `GPUQuerySet` with the optional `timestamp-query` feature
  records timestamps in render and compute passes
  ([MDN: GPUQuerySet](https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet)).
  It is optional, so the adaptation logic must also work from wall-clock
  frame times.
- Our caution: GPU-to-CPU readback adds latency of at least one frame, so a
  GPU acoustic solver should produce audio in chunks of several render
  quanta, buffered in the ring buffer.

## Level of detail and hardware adaptation

- three.js (MIT, npm `three` 0.186.1) provides `LOD`. It switches between
  objects "at the distances specified", via
  `addLevel(object, distance = 0, hysteresis = 0)`, where hysteresis is a
  "Threshold used to avoid flickering at LOD boundaries"
  ([three.js LOD.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/src/objects/LOD.js),
  [npm registry](https://registry.npmjs.org/three/latest)).
- Offline mesh decimation: Blender's Decimate modifier offers Collapse mode,
  whose Ratio is the "ratio of faces to keep", with optional Symmetry and
  Triangulate. It also offers Un-Subdivide and Planar modes
  ([Blender manual](https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/decimate.html)).
- Runtime or build-time decimation in JS: `meshoptimizer` (MIT) and
  `@gltf-transform/core` (MIT, "glTF 2.0 SDK for JavaScript and TypeScript,
  on Web and Node.js")
  ([npm meshoptimizer](https://registry.npmjs.org/meshoptimizer/latest),
  [npm @gltf-transform/core](https://registry.npmjs.org/@gltf-transform/core/latest)).
- glTF 2.0 is a royalty-free format for efficient 3D transmission and an ISO
  standard, ISO/IEC 12113:2022 ([Khronos](https://www.khronos.org/gltf/)).
- `navigator.hardwareConcurrency` returns logical processors. The browser
  "may ... report a lower number", so treat it as a hint
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency)).
- `wasm-feature-detect` (Apache-2.0) detects WASM features such as SIMD and
  threads at runtime
  ([npm registry](https://registry.npmjs.org/wasm-feature-detect/latest)).

### Proposed 20% headroom controller (design, derived)

- Audio budget: `B_a = 128 / sampleRate`, which is 2.667 ms at 48 kHz. Measure
  the DSP time per quantum, `t_a`, as an exponential moving average of
  `performance.now()` deltas inside the worker. Step the acoustic LOD down
  when `t_a > 0.8 B_a`. Step it up only when the next LOD's measured or
  predicted cost stays below `0.8 B_a` for several seconds, with hysteresis.
- Visual budget: `B_v = 1 / refreshRate`, which is 16.7 ms at 60 Hz. Use
  GPU timestamps when they are available, and frame-to-frame deltas
  otherwise. Apply the same 0.8 target to mesh LOD and render resolution.
- Audio should take priority over visuals: when both are over budget,
  degrade visuals first. Audio-only mode skips rendering entirely.
- Acoustic LOD ladder: 3D FDTD on GPU, then 2D or 2.5D FDTD, then 1D KL with
  N sections and losses, then 1D KL with 44 sections. The 3D head mesh drives
  the area function at every level.
- Startup calibration: run each candidate LOD for about 200 ms in an
  `OfflineAudioContext`-style benchmark inside the worker, and pick the
  highest one that fits within 80% of budget.

## Delivery targets

- npm library and CLI:
  - The `bin` field maps command names to files, which must start with
    `#!/usr/bin/env node`.
  - The `exports` field defines multiple entry points with "conditional
    entry resolution support between environments".
  - Source:
    [npm docs: package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json).
- Streaming server API options:
  - HTTP/1.1 `Transfer-Encoding: chunked` sends "streams of unknown size".
    HTTP/2 "disallows all uses of the `Transfer-Encoding` header" because it
    has its own streaming mechanisms
    ([MDN: Transfer-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Transfer-Encoding)).
  - Server-sent events use `text/event-stream`, which is UTF-8 text only. A
    browser allows 6 connections per domain over HTTP/1 and negotiates 100
    streams by default over HTTP/2
    ([MDN: Using SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).
  - Our suggestion: stream raw PCM or WAV (with a streaming header) over
    chunked HTTP for audio, and use SSE or NDJSON for articulatory frames and
    IPA timing.
- Docker: the official `node` image has a default (Debian) variant, `-slim`,
  and `-alpine` (musl libc; the Alpine base is about 5 MB). Pin a Debian
  suite tag such as `bookworm` or `trixie` if extra packages are installed
  ([Docker Hub: node](https://hub.docker.com/_/node)). Check the current LTS
  tag at build time.
- ONNX models (for example a neural G2P) can run in browsers with
  `onnxruntime-web` (MIT)
  ([npm registry](https://registry.npmjs.org/onnxruntime-web/latest)).

## Open anatomical and acoustic data

| Dataset                                                      | Content                                                                                                                                                                      | License / access                                                              | Source                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| USC 75-speaker speech MRI (Lim et al. 2021, Scientific Data) | 75 speakers. 2D mid-sagittal real-time MRI at 83 fps with audio (2.4 x 2.4 mm pixels), 3D volumetric vocal tract MRI of sustained sounds, and T2-weighted MRI. About 966 GB. | Article CC BY 4.0. figshare dataset CC BY 4.0.                                | [PMC8292336](https://pmc.ncbi.nlm.nih.gov/articles/PMC8292336/), [figshare 13725546](https://figshare.com/articles/dataset/A_multispeaker_dataset_of_raw_and_reconstructed_speech_production_real-time_MRI_video_and_3D_volumetric_images/13725546) |
| Story, Titze, Hoffman 1996                                   | MRI area functions for 12 vowels, 3 nasals and 3 plosives, from one male speaker                                                                                             | Published in JASA 100(1):537-554                                              | [Iowa Research Online](https://iro.uiowa.edu/esploro/outputs/journalArticle/Vocal-Tract-Area-Functions-from-Magnetic/9984318712502771)                                                                                                              |
| Story 2008                                                   | The same speaker re-imaged in 2002: 11 vowel area functions with 44 sections each (table below)                                                                              | NIH author manuscript on PMC                                                  | [PMC2377017](https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/)                                                                                                                                                                                     |
| York 3D vocal tract MRI (Speed, Murphy, Howard)              | 3D vocal tract VTK models                                                                                                                                                    | No license stated (© 2012 Matt Speed). Ask the authors before redistributing. | [York 3DVTTF](https://www-users.york.ac.uk/~dtm3/3DVTTF/mri_data.html)                                                                                                                                                                              |
| ATR MRI database of Japanese vowel production                | Volumetric MRI and speech sounds for the 5 Japanese vowels                                                                                                                   | Not open. Distributed by ATR (licence terms not verified).                    | [Kitamura et al. 2009, AST 30(4)](https://www.jstage.jst.go.jp/article/ast/30/4/30_4_288/_article)                                                                                                                                                  |

Note (ours): the numeric area values below are published measurements. We
attribute them to Story (2008), and they should be cited in code comments. If
the project wants a fully clean-room default, it can use them only as
validation targets and generate its own defaults from the low-poly mesh.

## Published vowel area functions (Story 2008, Table I)

Area in cm², from section 1 (glottis) to section 44 (lips), for one adult
male speaker imaged in 2002, from
[Story 2008, JASA 123(1):327-335, PMC2377017](https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/).
Each vowel has its own section length Δ.

| Section |  [i] |  [ɪ] |  [e] |  [ε] |  [æ] |  [ʌ] |  [ɑ] |  [ɔ] |  [o] |  [ʊ] |  [u] |
| ------: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
|       1 | 0.51 | 0.28 | 0.29 | 0.37 | 0.31 | 0.23 | 0.56 | 0.27 | 0.38 | 0.37 | 0.54 |
|       2 | 0.59 | 0.21 | 0.26 | 0.30 | 0.21 | 0.34 | 0.62 | 0.43 | 0.45 | 0.38 | 0.61 |
|       3 | 0.62 | 0.21 | 0.30 | 0.24 | 0.18 | 0.47 | 0.66 | 0.54 | 0.57 | 0.49 | 0.66 |
|       4 | 0.72 | 0.30 | 0.40 | 0.23 | 0.23 | 0.60 | 0.78 | 0.67 | 0.77 | 0.62 | 0.75 |
|       5 | 1.24 | 0.47 | 0.55 | 0.29 | 0.33 | 0.77 | 0.97 | 0.83 | 1.31 | 0.85 | 1.13 |
|       6 | 2.30 | 0.71 | 0.74 | 0.41 | 0.50 | 1.06 | 1.16 | 0.92 | 1.92 | 1.28 | 1.99 |
|       7 | 3.30 | 1.12 | 0.99 | 0.58 | 0.78 | 1.26 | 1.12 | 0.89 | 1.74 | 1.62 | 2.83 |
|       8 | 3.59 | 1.48 | 1.09 | 0.82 | 0.96 | 1.09 | 0.82 | 0.73 | 1.11 | 1.47 | 2.90 |
|       9 | 3.22 | 1.35 | 0.90 | 0.97 | 0.85 | 0.80 | 0.55 | 0.55 | 0.75 | 1.04 | 2.52 |
|      10 | 2.86 | 1.05 | 0.69 | 0.82 | 0.63 | 0.65 | 0.45 | 0.44 | 0.59 | 0.81 | 2.40 |
|      11 | 3.00 | 0.92 | 0.77 | 0.62 | 0.46 | 0.56 | 0.37 | 0.37 | 0.57 | 1.03 | 2.83 |
|      12 | 3.61 | 0.92 | 1.31 | 0.54 | 0.36 | 0.47 | 0.29 | 0.28 | 0.68 | 1.44 | 3.56 |
|      13 | 4.39 | 1.19 | 2.13 | 0.54 | 0.33 | 0.37 | 0.21 | 0.18 | 0.73 | 1.49 | 3.99 |
|      14 | 4.95 | 1.94 | 2.74 | 0.68 | 0.46 | 0.24 | 0.15 | 0.14 | 0.67 | 1.28 | 3.89 |
|      15 | 5.17 | 2.83 | 3.03 | 1.09 | 0.73 | 0.17 | 0.16 | 0.15 | 0.58 | 1.06 | 3.50 |
|      16 | 5.16 | 3.31 | 3.23 | 1.62 | 1.00 | 0.18 | 0.25 | 0.14 | 0.49 | 0.85 | 3.04 |
|      17 | 5.18 | 3.48 | 3.33 | 2.03 | 1.30 | 0.23 | 0.34 | 0.13 | 0.44 | 0.69 | 2.64 |
|      18 | 5.26 | 3.60 | 3.27 | 2.35 | 1.66 | 0.27 | 0.43 | 0.14 | 0.42 | 0.56 | 2.44 |
|      19 | 5.20 | 3.64 | 3.09 | 2.51 | 1.97 | 0.28 | 0.54 | 0.18 | 0.49 | 0.42 | 2.31 |
|      20 | 5.02 | 3.49 | 2.84 | 2.39 | 2.06 | 0.29 | 0.61 | 0.20 | 0.53 | 0.27 | 2.07 |
|      21 | 4.71 | 3.20 | 2.66 | 2.22 | 2.03 | 0.33 | 0.67 | 0.23 | 0.38 | 0.27 | 1.80 |
|      22 | 4.13 | 2.90 | 2.46 | 2.13 | 2.01 | 0.52 | 0.98 | 0.49 | 0.30 | 0.41 | 1.52 |
|      23 | 3.43 | 2.59 | 2.14 | 2.00 | 1.89 | 0.97 | 1.76 | 1.03 | 0.45 | 0.51 | 1.14 |
|      24 | 2.83 | 2.21 | 1.79 | 1.78 | 1.66 | 1.50 | 2.75 | 1.58 | 0.61 | 0.49 | 0.74 |
|      25 | 2.32 | 1.87 | 1.44 | 1.58 | 1.49 | 1.91 | 3.52 | 2.06 | 0.71 | 0.47 | 0.42 |
|      26 | 1.83 | 1.54 | 1.17 | 1.43 | 1.42 | 2.23 | 4.08 | 2.61 | 0.79 | 0.50 | 0.22 |
|      27 | 1.46 | 1.20 | 1.00 | 1.31 | 1.37 | 2.65 | 4.74 | 3.35 | 0.86 | 0.58 | 0.14 |
|      28 | 1.23 | 0.92 | 0.88 | 1.23 | 1.34 | 3.29 | 5.61 | 4.34 | 1.01 | 0.80 | 0.20 |
|      29 | 1.08 | 0.74 | 0.80 | 1.24 | 1.41 | 4.13 | 6.60 | 5.51 | 1.41 | 1.19 | 0.47 |
|      30 | 0.94 | 0.59 | 0.81 | 1.38 | 1.58 | 5.00 | 7.61 | 6.70 | 2.09 | 1.62 | 0.89 |
|      31 | 0.80 | 0.52 | 0.85 | 1.61 | 1.82 | 5.77 | 8.48 | 7.75 | 3.00 | 2.27 | 1.15 |
|      32 | 0.67 | 0.54 | 0.84 | 1.82 | 2.19 | 6.33 | 9.06 | 8.63 | 4.10 | 3.24 | 1.42 |
|      33 | 0.55 | 0.59 | 0.86 | 1.96 | 2.63 | 6.61 | 9.29 | 9.29 | 5.16 | 4.16 | 2.17 |
|      34 | 0.46 | 0.65 | 0.96 | 2.01 | 2.97 | 6.63 | 9.26 | 9.59 | 6.22 | 5.00 | 3.04 |
|      35 | 0.40 | 0.71 | 1.18 | 2.00 | 3.17 | 6.45 | 9.06 | 9.42 | 7.34 | 5.70 | 3.69 |
|      36 | 0.36 | 0.67 | 1.35 | 1.95 | 3.40 | 6.04 | 8.64 | 8.78 | 8.15 | 6.11 | 4.70 |
|      37 | 0.35 | 0.61 | 1.48 | 1.77 | 3.56 | 5.39 | 7.91 | 7.82 | 8.61 | 6.21 | 5.74 |
|      38 | 0.35 | 0.57 | 1.62 | 1.48 | 3.57 | 4.42 | 6.98 | 6.50 | 8.37 | 6.29 | 5.41 |
|      39 | 0.38 | 0.50 | 1.49 | 1.30 | 3.58 | 3.29 | 6.02 | 4.95 | 6.76 | 6.24 | 3.82 |
|      40 | 0.51 | 0.48 | 1.29 | 1.21 | 3.44 | 2.37 | 5.13 | 3.47 | 4.37 | 4.91 | 2.34 |
|      41 | 0.74 | 0.54 | 1.24 | 1.10 | 3.15 | 1.74 | 4.55 | 2.15 | 2.30 | 2.61 | 1.35 |
|      42 | 0.92 | 0.73 | 1.17 | 0.99 | 3.38 | 1.36 | 4.52 | 1.38 | 1.06 | 1.09 | 0.65 |
|      43 | 0.96 | 0.93 | 1.04 | 0.91 | 3.99 | 1.17 | 4.71 | 1.11 | 0.58 | 0.63 | 0.29 |
|      44 | 0.91 | 0.82 | 0.95 | 0.78 | 4.17 | 0.99 | 4.72 | 0.90 | 0.47 | 0.59 | 0.16 |

Section length and tract length per vowel
([PMC2377017](https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/)):

| Vowel    | [i]   | [ɪ]   | [e]   | [ε]   | [æ]   | [ʌ]   | [ɑ]   | [ɔ]   | [o]   | [ʊ]   | [u]   |
| -------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| Δ (cm)   | 0.384 | 0.376 | 0.386 | 0.393 | 0.366 | 0.390 | 0.388 | 0.395 | 0.417 | 0.440 | 0.445 |
| VTL (cm) | 16.90 | 16.55 | 16.98 | 17.30 | 16.11 | 17.14 | 17.09 | 17.40 | 18.33 | 19.34 | 19.59 |

Measured formants from recordings and formants calculated from the area
functions, in Hz (Story 2008, Table II,
[PMC2377017](https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/)). These are
useful as regression tests for the simulator:

| Vowel   | [i]  | [ɪ]  | [e]  | [ε]  | [æ]  | [ʌ]  | [ɑ]  | [ɔ]  | [o]  | [ʊ]  | [u]  |
| ------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| F0      | 159  | 154  | 149  | 154  | 153  | 155  | 154  | 154  | 155  | 156  | 155  |
| F1 meas | 295  | 478  | 509  | 659  | 765  | 752  | 715  | 665  | 563  | 518  | 430  |
| F2 meas | 1923 | 1965 | 1917 | 1740 | 1724 | 1300 | 1180 | 932  | 835  | 947  | 917  |
| F3 meas | 2797 | 2688 | 2617 | 2485 | 2501 | 2698 | 2691 | 2814 | 2637 | 2355 | 2087 |
| F1 calc | 325  | 413  | 484  | 565  | 810  | 593  | 694  | 557  | 499  | 477  | 314  |
| F2 calc | 2139 | 2103 | 1887 | 1595 | 1655 | 836  | 942  | 709  | 768  | 789  | 702  |
| F3 calc | 2976 | 2626 | 2404 | 2200 | 2310 | 3099 | 2948 | 3176 | 2421 | 2499 | 2298 |

Derived from the table (ours):

- Air volume, the sum of area times Δ, is about 37.7 cm³ for [i], 57.3 cm³
  for [ɑ] and 40.1 cm³ for [u].
- The smallest cross-sections are 0.13-0.14 cm², in [ɔ] and [u]. That is an
  equivalent diameter of about 4 mm.
- To use the table in a fixed-Δ Kelly-Lochbaum tract (for example
  Pink Trombone's 44 sections at a uniform length), resample each vowel to
  the target number of sections. Alternatively, keep 44 sections and change
  the sample rate per vowel. Interpolating between vowels is simplest
  after resampling to a common length.
