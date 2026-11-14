---
id: P16
title: Silent load-time device benchmark that sets the precision
type: Feature
milestone: M1
blocked_by: [P13, P14]
requirements: [R4, R3, R13]
---

## Goal

When the app loads, measure in the background how fast this device renders
each audio tier, and choose the most precise tier that keeps 20 % of the
time free. The measurement makes no sound, shows no message, never delays
speech, uses at most 1 s of CPU time in the worker and causes no task
longer than 50 ms on the main thread. The result is cached per device and
engine. The same measurement is available in Node.js.

## Why

R4: "automatic silent non-blocking benchmark on load ... to determine the
precision of simulation that can be handled by user device". A benchmark
exists today, but it is neither silent (it shows a note), nor
non-blocking (speech waits for it), nor bounded, and it is cold: its first
number is wrong.

## Current state

- `src/perf/benchmark.js`: `measureAudioTier(tier, {head, ipa, seconds,
limit})` renders the first `seconds` (default 0.3) of `BENCHMARK_IPA`
  (`'ˈhæloʊ ˈwɜːld'`) in blocks of 512 samples and returns the load (work
  seconds per audio second). `benchmarkAudioTiers` walks the tiers from the
  cheapest with `chooseTier` of `src/perf/lod.js`: a tier is not measured
  when the load predicted from the cheaper tier (`load * cost ratio`)
  exceeds `target * 2`; the walk stops at the first load above `target`
  (0.8). `benchmarkAudioTiersAsync` adds the 3D tiers on WebGPU.
- App: `use-simulator.js` (line 88) calls `engine.benchmark(head, {gpu})`
  in an effect right after the first render, not at idle time.
  `voice-engine.js` applies a cached result at once
  (`localStorage` key `voice-simulator:benchmark`; the cache key is
  `userAgent | hardwareConcurrency | tier names and costs | gpu or cpu`)
  and then measures again anyway, on every page load. Without a cache it
  sets `phase: 'benchmark'` and `App.js` (line 170) shows
  "Measuring this device…".
- Worker: `synth-worker.js` runs `benchmarkAudioTiersAsync` with
  `BENCHMARK_SECONDS = 0.08`. On the CPU path nothing in it waits for a
  timer, so the worker reads no message until the benchmark is finished: a
  `speak` message sent meanwhile waits.
- Measured in a fresh Node.js process on this machine
  (`experiments/issue-11-audit-m1.txt`, lines `benchmark run` and `probe`):
  the first run takes 497 ms and reports a load of 0.51 for `minimal`; the
  third run takes 286 ms and reports 0.07. Cold code makes the first probe
  seven times too slow. One probe of `high` takes 260 ms although its
  audio costs about 110 ms: the rest is building the voxel model.
- The chosen tier is not stored: the setting `tier` starts at `'auto'` on
  every load (`App.js` line 460).
- Command line: `voice-simulator benchmark [--seconds] [--tier] [--json]`
  calls `benchmarkAudioTiers`.
- Nothing reads `navigator.deviceMemory` or the battery state.

## What to do

1. `src/perf/device-benchmark.js` exports `BENCHMARK_VERSION = 1` (add 1
   whenever this procedure changes) and
   `async benchmarkDevice(options)`. Options and defaults: `engine`
   (`'auto'`), `head`, `target` (0.8), `budget` (1, seconds of CPU),
   `slice` (0.02, seconds), `probe` (0.06, seconds of audio per tier),
   `maxLevel` (last tier), `resume` (an earlier partial result), `paused`
   (function, default `() => false`), `now` (`performance.now` in ms),
   `pause` (function that returns a promise; default
   `() => new Promise((r) => setTimeout(r, 0))`), `measure` (for tests).
   The procedure:
   - Warm-up: render 0.03 s of `BENCHMARK_IPA` at tier 0 and drop the
     result.
   - Walk the tiers from index 0 as `chooseTier` does (same skip rule, same
     stop rule). For each tier: create the renderer with
     `engine.createRenderer` of {{P13}}, render blocks of 512 samples until
     `probe` seconds of audio are done or the time spent exceeds
     `1.6 * probe`. The load is the render time divided by the audio time;
     the time to create the renderer counts for the budget, not for the
     load.
   - Slices: after every block, if `slice` seconds have passed since the
     last pause, `await pause()`. Creating a renderer is one slice of its
     own. Add the length of every slice to `cpuSeconds`; keep the longest
     in `longestSlice`.
   - Budget: before a tier, estimate its cost as
     `predictedLoad * probe + setup`, where `setup` is 0 for the waveguide
     and 0.2 s for `fdtd3d`. If `cpuSeconds + estimate > budget`, stop
     measuring.
   - Tiers that were not measured get `loads[i] = loads[i - 1] * cost[i] /
cost[i - 1]` and `measured[i] = false`.
   - Choice: the highest level whose load is at most `target` when
     measured, or at most `0.7 * target` when predicted, with every lower
     level also passing. If no level passes: 0.
   - Interruption: after each pause call `paused()`. If it is true, return
     at once with `partial: true` and the tiers finished so far. A later
     call with `resume: thatResult` continues after them.
   - Result: `{version, engine: {name, simd, threads}, level, tier, loads,
measured, cpuSeconds, longestSlice, partial}`.
     Export `benchmarkDevice` and `BENCHMARK_VERSION` from `src/index.js`
     and declare them in `src/index.d.ts`.
2. Worker (`src/engine/worker-protocol.js` of {{P13}}): the `benchmark`
   message runs `benchmarkDevice` with `paused` = "a `speak` message is
   waiting or being rendered". A partial result is kept and continued
   500 ms after the utterance has ended. The outgoing `benchmark` message
   carries the whole result. The WebGPU tiers are measured after the CPU
   result has been posted, as today (`chooseTierWithGpu`), with a limit of
   2 s of wall time, and posted as a second `benchmark` message.
3. `voice-engine.js`:
   - Cache value: `{version, device, engine, level, loads, measured, gpu,
time}` with `time = Date.now()`. `device` is the present key. The cache
     is valid when `version === BENCHMARK_VERSION`, `device` matches, the
     three `engine` fields equal the answer to the `engine` message of
     {{P13}}, and it is younger than 30 days.
   - Valid cache: use it and send no `benchmark` message.
   - No valid cache: start at `startLevel(hints)` and call
     `requestIdleCallback(run, {timeout: 2000})` (where missing:
     `setTimeout(run, 200)`). `run` waits for
     `document.visibilityState === 'visible'`, then posts the message.
   - Never set `phase: 'benchmark'`. Remove the note from `App.js` and the
     string `benchmarking` from `i18n.js`.
   - Three `overload` messages in a row at the cached level (if {{P17}} is
     merged: three utterances in a row with a `tier` message of reason `'load'`
     at `at < 0.5`) delete the cache; the next idle moment measures again. Add
     the method `measureAgain()` and a button "Measure again" in the quality
     panel, next to a line "Measured <n> days ago · <engine name>".
4. Hints, `startLevel({hardwareConcurrency, deviceMemory})` in
   `src/perf/device-benchmark.js`: `audioTierIndex('narrowband')` when
   `hardwareConcurrency <= 2` or `deviceMemory <= 2`, else
   `BASE_AUDIO_LEVEL` ({{P14}}). Missing values count as large. Battery:
   where `navigator.getBattery` exists and reports `charging === false`
   with `level < 0.2`, the automatic level is at most
   `audioTierIndex('medium')`. Hints never change a measured load.
5. User choice wins. Store the setting `tier` in `localStorage` under
   `voice-simulator:tier` as `'auto'` or a tier name (not an index). With a
   fixed tier the benchmark still runs (the meter needs loads) but never
   changes the level.
6. Command line: `voice-simulator benchmark --quick` runs `benchmarkDevice`
   and prints the same lines as today plus `cpu: <seconds> s`; with
   `--json` it prints the result object. Without `--quick` nothing
   changes.
7. Main thread check: in `use-simulator.js`, when
   `PerformanceObserver.supportedEntryTypes` includes `'longtask'`, count
   long tasks between the start and the `benchmark` answer into
   `status.longTasks`. Show the number only with `?debug` in the address.

## Tests

`tests/device-benchmark.test.js` (fake `now`, fake `measure` unless said):

- `stays inside the budget`: seven tiers, each fake probe costs 0.4 s;
  two are measured, the rest have `measured === false`, and
  `cpuSeconds <= 1.02`.
- `pauses every slice`: fake blocks of 5 ms; `pause` is called at least
  once per 20 ms of fake work and `longestSlice <= 0.025`.
- `keeps 20 % headroom`: loads 0.3, 0.5, 0.79, 0.81 give level 2.
- `predicted tiers need more margin`: measured 0.2, then predicted 0.5 and
  0.6 give level 1 (0.6 is above 0.56).
- `warm-up is not counted`: the first call of `measure` has
  `warmup === true` and its load is in no entry of `loads`.
- `speech interrupts and resume continues`: `paused` returns true after
  the second tier; the result is partial with two loads; the resumed call
  measures only the others.
- `real run` (no fakes): `benchmarkDevice({engine: 'js'})` resolves in
  less than 3 s of wall time with `cpuSeconds <= 1.3` and `loads[0] > 0`.
- `start level follows the hints`: `{hardwareConcurrency: 2}` and
  `{deviceMemory: 1}` give `narrowband`; `{}` gives `minimal`.

`tests/universal-app-engine.test.js` (fake worker and storage of that
file): `a valid cache sends no benchmark`; `a new BENCHMARK_VERSION
measures again`; `another engine measures again`; `a cache older than 30
days measures again`; `three overloads drop the cache`; `speech before the
answer starts at the start level`; `a fixed tier survives a reload`.

`tests/cli-audio.test.js`: `benchmark --quick --json` prints an object
with `level`, `cpuSeconds` and `engine`.

## Acceptance criteria

- [ ] `node --test tests/device-benchmark.test.js` passes.
- [ ] `node bin/voice-simulator.js benchmark --quick --json` exits with 0
      and prints `cpuSeconds` of at most 1.3.
- [ ] Built app, Chrome, CPU throttled 4x, empty `localStorage`, address
      with `?debug`: `longTasks` is 0, no note appears, and "Speak" pressed
      in the first second starts sound in less than 0.5 s more than with a
      valid cache. The three numbers are in the pull request.
- [ ] After a reload the developer tools show no `benchmark` message to
      the worker; after `localStorage.clear()` they show one.
- [ ] `grep -rn "benchmarking" examples/universal-app/src` finds nothing.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Changing the tier inside an utterance when the load changes: {{P17}}.
- Tracking speed over releases in CI: {{P19}}.
- Benchmarks of recognition or voice copy: {{P65}}, {{P68}}.
- The visual tiers (`VISUAL_TIERS`); their governor is unchanged.

## References

- MDN, "Scheduler: yield() method",
  https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield
- MDN, "Performance: now() method" (timer resolution),
  https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
- Can I use, "requestIdleCallback",
  https://caniuse.com/requestidlecallback
- MDN, "Navigator: deviceMemory property",
  https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
- `experiments/issue-11-audit-m1.mjs`, section 8, and its output.
- Research note `docs/case-studies/issue-11/research/5-performance-and-physics.md`,
  section 6.
