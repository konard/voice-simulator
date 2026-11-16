# Silent device benchmark

The web app chooses its audio tier with `benchmarkDevice`
(`src/perf/device-benchmark.js`, issue 28). It measures how fast this device
renders each audio tier and picks the most precise tier that keeps 20 % of
the time free. It makes no sound, shows no message and never delays speech.

## The procedure

`benchmarkDevice(options)` (version `BENCHMARK_VERSION`, 1):

- **Warm-up.** It renders 0.03 s of `BENCHMARK_IPA` at tier 0 and drops the
  result, so cold code does not make the first load too high.
- **Walk.** It walks the tiers from the cheapest with the skip and stop
  rules of `chooseTier`. For each tier it renders blocks of 512 samples
  until `probe` (0.06 s) of audio is done, or until 1.6 × `probe` of time
  is spent. The load is render time divided by audio time. Creating the
  renderer counts for the budget, not for the load.
- **Slices.** After each block it calls `await pause()` once `slice`
  (0.02 s) has passed since the last pause. Creating a renderer is a slice
  of its own. `cpuSeconds` is the sum of the slices, and `longestSlice` is
  the longest one.
- **Budget.** Before each tier it estimates the tier's cost as the
  predicted load × `probe`, plus 0.2 s of voxel setup for `fdtd3d`. It
  stops measuring when that cost would take `cpuSeconds` over `budget`
  (1 s).
- **Unmeasured tiers.** These get the load of the previous tier scaled by
  the cost ratio, and `measured[i] = false`.
- **Choice.** The level is the highest one whose load is at most `target`
  (0.8) if measured, or 0.7 × `target` if predicted, with every lower level
  passing too.
- **Interruption.** It checks `paused()` after each pause. If it is true,
  the call returns `partial: true`, and a later call with
  `resume: thatResult` continues after the finished tiers.

`startLevel({hardwareConcurrency, deviceMemory})` is the level Auto starts
at before an answer: `narrowband` with at most 2 cores or 2 GB, else
`minimal`. `batteryLevelCap(battery)` limits Auto to `medium` on a battery
below 20 % that is not charging. Neither hint changes a measured load.

## In the web app

- **Worker.** The `benchmark` message runs `benchmarkDevice`. It pauses
  while a `speak` message waits or renders, and continues 500 ms after the
  utterance ends. The CPU result is posted first. The 3D tiers above the
  CPU's choice are then tried on WebGPU, within 2 s of wall time, and
  posted in a second message. This stage waits in the same way while
  utterances are rendered, and the wait does not count toward the 2 s.
- **Scheduling.** The app sends the message only after the worker has said
  which engine it runs. It waits for an idle moment
  (`requestIdleCallback`, 2 s timeout) on a visible page. An utterance in
  progress moves the message to after it.
- **Cache.** The result is stored in `localStorage`
  (`voice-simulator:benchmark`) for 30 days, keyed by benchmark version,
  device and engine. A later visit sends no `benchmark` message. Three
  overloads in a row at the cached tier, or "Measure again" next to
  "Measured <n> days ago · <engine>", measure again. An utterance is
  overloaded when the worker steps it down for load in its first 0.5 s (a
  `tier` message with reason `load` and `at` below 0.5, issue 29) or
  restarts it on the CPU after WebGPU failed (`overload`).
- **Fixed tier.** A quality chosen in the menu is kept as a tier name
  (`voice-simulator:tier`). With a fixed tier the benchmark still runs, for
  the meter, but never changes the level.
- **Debug.** With `?debug` in the address, the audio meter shows the main
  thread's tasks over 50 ms between the request and the answer. It leaves
  out the app's own tasks (`ownTask`): those during utterances, when the
  benchmark is paused, and those that handled a pointer or key event, such
  as pressing "Speak".

## Command line

`voice-simulator benchmark --quick` runs `benchmarkDevice`. It prints the
usual lines plus `cpu: <seconds> s`. With `--json` it prints the result
object: `version`, `engine`, `level`, `tier`, `loads`, `measured`,
`cpuSeconds`, `longestSlice` and `partial`.
