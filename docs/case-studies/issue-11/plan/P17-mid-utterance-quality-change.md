---
id: P17
title: Change quality in the middle of an utterance while streaming
type: Feature
milestone: M1
blocked_by: [P13, P15]
requirements: [R3, R1]
---

## Goal

While an utterance is streamed in automatic mode, the worker may change the
audio tier at any moment: down within 0.1 s when the device is too slow, up
after 3 s of spare time, with no gap, repeat, click or change of loudness.
Renders with a fixed tier and all offline functions stay bit-identical.

## Why

R3: "Streaming with variable quality should be supported". Today a slow
tier is noticed only in the first 0.3 s; then the audio is thrown away and
started again. A faster device never goes up inside an utterance.

## Current state

- Worker (`examples/universal-app/src/engine/synth-worker.js`; after
  {{P13}} `src/engine/worker-protocol.js`): `stream` (line 228) feeds an
  `OverloadDetector` (`src/perf/lod.js`: `threshold` 1.2, `minAudio` 0.04,
  `maxAudio` 0.3 s). When it fires and `message.auto && message.tier > 0`,
  `stream` posts `overload` and returns `fallbackLevel(...)`; `speak`
  (line 171) then calls itself with the new tier: the utterance restarts.
- App (`voice-engine.js`): `#overload` (line 291) empties `job.chunks`.
  Line 343: "Governor changes apply to the next utterance."
- `VoiceRenderer` (`src/acoustics/voice.js`) always starts at plan time 0
  (`time = 0`, `position = 0`, lines 178 and 179). The pitch phase and the
  jitter random numbers are in `Glottis` (`phase`, `period`, `jitter`,
  `shimmer`, `smoothed`, `intensity`, `noiseModulation`, `random`);
  `createRandom` (`src/random.js`) hides its state in a closure. Every
  renderer has its own listener (microphone, room) that starts silent.
- Measured (`experiments/issue-11-audit-m1.txt`, lines `level` and
  `crossfade`), same seed, 25 ms of `aː` at 48 kHz: `medium` correlates
  0.999 with `minimal` and `low`, 0.844 with `high` (lag 7 samples); `sː`
  about 0. An equal-power crossfade would be 2.7 to 3.0 dB too loud in
  vowels. `həˈloʊ`: -18.0, -18.1, -18.2 dB (waveguide), -19.4 dB (`high`).

## What to do

1. `src/random.js`: the function returned by `createRandom` gets
   `random.save()` (returns the 32-bit state) and `random.restore(state)`.
   The numbers it produces do not change.
2. `Glottis`: remember the tenseness of the running period in
   `pulseTenseness` (set in the constructor and in `#startPeriod`). Add
   `saveState()`, which returns a `Float64Array` of 9 numbers in the order
   `phase, period, jitter, shimmer, smoothed, intensity, noiseModulation,
pulseTenseness, random state`, and `restoreState(array)`, which sets them
   and `pulse = lfParameters(pulseTenseness)`. Put the 9 names into
   `src/engine/layout.js` of {{P10}} as `SOURCE_STATE`.
3. Renderers (`VoiceRenderer` and `RustVoiceRenderer`): option `startTime`
   (seconds, default 0): `position = Math.round(startTime * sampleRate)`,
   `time = position / sampleRate`, `solverTime = time`; solver and listener
   start silent. Methods `saveSources()` (the glottis state) and
   `restoreSources(array)`. Rust exports: `vs_renderer_seek(handle,
seconds: f64)`, `vs_renderer_sources_save(handle, out: u32) -> i32`,
   `vs_renderer_sources_restore(handle, pointer: u32) -> i32`. The noise
   generators are not handed over.
4. `src/engine/adaptive-stream.js` exports `switchGrid(a, b, c)` (greatest
   common divisor of three rates) and `class AdaptiveStream`.
   Constructor: `{createRenderer, level, streamRate, tiers = AUDIO_TIERS,
preroll = 0.03, overlap = 0.025, room = false}`;
   `createRenderer(level, extra)` returns a renderer of that tier with
   `extra` merged into its options. Members: `level`, `position` and
   `totalSamples` (stream samples), `done`, `renderer` (of the lane that is
   heard), `switches` (list of `{at, from, level, gainDb, r}`),
   `setLevel(level)`, `async render(target)`, `close()`.
   - A lane is `{renderer, resampler, start}`: the renderer is driven with
     `renderAsync` in pieces of at most 256 samples; `resampler` is
     `createStreamResampler(renderer.sampleRate, streamRate)` of {{P15}};
     `start` is the stream index of its first sample. After the renderer is
     done the lane flushes the resampler and then gives zeros.
   - `totalSamples = Math.round(first.totalSamples * streamRate /
first.sampleRate)` and never changes.
   - `setLevel(level)` returns false and does nothing when a switch is
     running, when `level === this.level`, when
     `switchGrid(streamRate, oldRate, newRate) < 20`, or when `room` is
     true and `level > this.level`. Else it stores the request.
   - Start of a switch. With `g = switchGrid(...)`, the old lane cuts its
     next pieces so that the renderer stops at the next position that is a
     multiple of `oldRate / g`. There `T = position / oldRate` is a sample
     time of all three rates (at most 40 ms away for the tier rates and a
     stream of 44100 or 48000 Hz). If `T + preroll + overlap` is beyond
     `plan.duration`, drop the request. Else create
     `createRenderer(level, {startTime: T})`, call
     `restoreSources(old.saveSources())`, and make the new lane with
     `start = T * streamRate`. Let `fadeStart = start + Math.round(preroll *
streamRate)` and `N = Math.round(overlap * streamRate)`. With `room`
     true use `preroll + Math.min(0.25, renderer.listener.tail)`.
   - Output. Before `fadeStart`: the old lane times `gain` (starts at 1).
     The samples of the new lane before `fadeStart` are rendered and
     dropped (the tract fills). For the `N` samples of the overlap read
     both lanes: `a = gain * old`, `b = gain * new`. Then
     `match = sqrt(sum(a²) / sum(b²))`, limited to 0.5 to 2 and set to 1
     when either sum is below 1e-12; `b = match * b`;
     `r = sum(a * b) / sqrt(sum(a²) * sum(b²))`, limited to 0 to 1 (0 when
     a sum is below 1e-12). For `i = 0 .. N - 1`:
     `θ = (i + 0.5) / N * π / 2` and
     `out = (a * cos θ + b * sin θ) / sqrt(1 + r * sin 2θ)`: an
     equal-power fade for unlike signals (`r = 0`), a linear fade for equal
     ones (`r = 1`). Afterwards `gain *= match`, limited to 0.5 to 2; close
     the old lane (`solver.gpu?.destroy()`); push the entry to `switches`
     (`gainDb = 20 * log10(match)`).
5. `src/perf/lod.js`: `class StreamGovernor`, options `tiers`, `level`,
   `maxLevel`, `target = 0.8`, `smoothing = 0.3`, `downAfter = 0.1`,
   `upAfter = 3`, `margin = 0.7`. `record(busy, audio)` returns a level or
   `null`:
   - `load` is the smoothed `busy / audio`; `since` sums `audio`.
   - Down: `since >= downAfter` and `load > target` gives
     `fallbackLevel(tiers, level, load, target)`; `ceiling = level - 1`.
   - Up: `since >= upAfter`, `level < Math.min(maxLevel, ceiling)` and
     `load * cost[level + 1] / cost[level] < target * margin` gives
     `level + 1`.
   - `underrun()` returns `level - 1` at once (or `null` at level 0) and
     sets `ceiling`.
   - `switched(level)`: `load *= cost[level] / cost[old]`, `since = 0`.
6. Worker (`worker-protocol.js`), `speak` with `auto: true`: build an
   `AdaptiveStream` with `streamRate = message.streamRate ?? 48000` and
   `room = Boolean(message.room || message.enclosure)`; `start.sampleRate`
   is the stream rate. Per chunk of 1024 stream samples: render, compute
   `busy` (option `busy(level, audio, measured)` of `createWorkerHandler`,
   default: `measured`), and, unless a switch is running, call
   `governor.record`. A returned level goes to `setLevel`; if accepted,
   `governor.switched`. When a switch has finished post
   `{type: 'tier', id, at, from, level, reason, gainDb, solver, model}`
   (`reason`: `'load'`, `'headroom'` or `'underrun'`). A new incoming
   message `{type: 'underrun', id}` calls `governor.underrun()`. `stream`
   no longer returns a level and the worker no longer uses
   `OverloadDetector`; the restart after a WebGPU failure stays. The `end`
   message gets `level`. With `auto: false` nothing changes.
7. App: `voice-engine.js` sends `streamRate: player.context.sampleRate`,
   handles `tier` (`governor.level = message.level`, status `audioLevel`
   and `switches`, the 3D view takes `message.model` from time `at`), sends
   `underrun` when `player.underruns` rises, and sets the governor level
   from `end.level`. Remove the call `governor.record(load, 1)` and the
   comment above it. `App.js` shows the tier name while speaking. If
   `benchmarkDevice` of {{P16}} is merged, its rule "three `overload`
   messages drop the cache" now counts utterances with a `tier` message of
   reason `'load'` at `at < 0.5`; if it is not merged, do nothing for it
   here.

## Tests

`tests/adaptive-stream.test.js` (waveguide tiers and a 48000 Hz stream
unless said; seed 1; 1 s plans `aː` and `sː`; switches asked for at 0.3 s):

- `no switch is the plain render`: stream rate 22050, tier `minimal`:
  bit-identical to `synthesize`; at 48000 equal within 1e-6 to
  `resample(plain, 22050, 48000, {zeroCrossings: 8})`.
- `length never changes`: down at 0.3 s and up at 0.7 s; `position` ends at
  `totalSamples`; all samples are finite.
- `vowel switch keeps the level`: `aː`, `low` to `minimal`: the RMS of
  every 5 ms window from 0.25 to 0.45 s is within 1 dB of the same window
  without a switch (`medium` to `high`: 1.5 dB); `switches[0].r > 0.9`;
  the largest step between two samples is at most 1.5 times the largest
  step without a switch.
- `noise switch keeps the level`: `sː`: the RMS of the overlap is within
  1 dB of the 25 ms before it; `switches[0].r < 0.3`.
- `pitch continues in phase`: after `low` to `minimal`, 0.5 to 0.6 s
  correlates at least 0.95 with plain `minimal`, lag at most 12 samples.
- `level is matched`: `medium` to `high`: the RMS of 0.4 to 0.6 s is within
  0.5 dB of plain `medium`; `gainDb` is between -6 and 6.
- `switch time is on the common grid`: `switchGrid(48000, 22050, 11025)` is
  75 and `switches[0].at * 75` is an integer within 1e-9.
- `late request is dropped` (asked 40 ms before the end: no switch);
  `same requests, same samples` (two runs are bit-identical);
  `rooms only go down` (`room: true`: `setLevel(level + 1)` is false).
- `offline output is unchanged`: the SHA-256 of the samples of
  `synthesize('Hello world.', {seed: 1, tier})` for `minimal` and `high`
  equals the hex strings recorded on `main` before this change.

`tests/stream-governor.test.js`: `goes down within 0.1 s` (load 1.3 in
21 ms chunks: a level at the fifth record); `goes up after 3 s, one level`;
`never returns to a level it left`; `underrun steps down at once`.

`tests/engine-worker.test.js` (option `busy`, no real clock):

- `a slow tier is left without a restart`: `busy = audio * (level >=
audioTierIndex('medium') ? 1.5 : 0.2)`, start at `medium`: one `start`, a
  `tier` message with `reason: 'load'` and `at < 0.4`, no `overload`; every
  chunk starts where the last ended; the lengths sum to `totalSamples`.
- `a fast device climbs`: `busy = audio * 0.05`, an 8 s text from
  `minimal`: all `tier` messages go up, the first has `at >= 3`.
- `a fixed tier never switches`: `auto: false`: no `tier` message and the
  samples are bit-identical to `synthesize`.

## Acceptance criteria

- [ ] The three test files pass under `npm test`, `bun test` and
      `deno test -A`; with `REQUIRE_WASM=1` also on the Rust engine.
- [ ] The worst level differences of `vowel switch keeps the level` (both
      pairs) and of `noise switch keeps the level` are in the pull request.
- [ ] Built app, Chrome, automatic quality, CPU throttled 6x, a text of
      20 s: the tier shown changes while it speaks, with at least one
      switch, no restart and at most 1 underrun after the first switch. A
      recording and a spectrogram of one switch are attached.
- [ ] `grep -c OverloadDetector src/engine/worker-protocol.js` prints 0.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Exact transfer of the pressure field between solvers, and one shared
  room stage after the crossfade (it would allow upward switches in rooms).
- Choosing the first tier: {{P16}}. The player: {{P15}}.
- Switching in `synthesizeStream`, the server and the command line.

## References

- Spiteri, Urgaonkar, Sitaraman, "BOLA", 2016,
  doi:10.1109/INFOCOM.2016.7524428; Yin et al., 2015,
  doi:10.1145/2785956.2787486 (quality rules from buffer and throughput).
- Babylon.js, "Scene optimizer" (step down at once, up slowly),
  https://doc.babylonjs.com/features/featuresDeepDive/scene/sceneOptimizer
- `experiments/issue-11-audit-m1.mjs`, sections 9 and 10, and its output.
- Research note `docs/case-studies/issue-11/research/5-performance-and-physics.md`,
  section 6.
