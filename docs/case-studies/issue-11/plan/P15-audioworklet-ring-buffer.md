---
id: P15
title: AudioWorklet playback with a ring buffer
type: Feature
milestone: M1
blocked_by: []
requirements: [R3, R13]
---

## Goal

Play streamed speech in the browser through one `AudioWorkletProcessor`
that reads from a ring buffer, instead of one buffer source per chunk. The
ring is a `SharedArrayBuffer` when the page is cross-origin isolated and a
queue fed through the message port otherwise. Underruns fade out and in
instead of clicking. Where `AudioWorklet` is missing, the present player
keeps working.

## Why

R3: "streaming ... to the level that user device can support". Today each
chunk is a separate `AudioBufferSourceNode` scheduled 150 ms ahead; a late
chunk shifts the whole timeline and leaves a gap, and the quality cannot
change inside an utterance without a seam. {{P17}} needs one continuous
output stream. A ring buffer also lets the app start sooner.

## Current state

- `examples/universal-app/src/engine/audio-player.js` (231 lines), class
  `AudioPlayer`: `unlock()`, `revive()`, `watch()`, `begin(sampleRate)`,
  `push(start, samples)`, `time()`, `stalled()`, `recover(chunks)`,
  `stop()`; counters `underruns`, `recoveries`. Constants `LEAD = 0.15`,
  `MIN_AHEAD = 0.03` (seconds).
- `push` creates `context.createBuffer(1, samples.length, this.sampleRate)`
  and a buffer source that starts at `origin + start / sampleRate`. The
  browser resamples from the utterance rate (8000 to 48000 Hz after
  {{P14}}) to the device rate. A late chunk does
  `origin += late + LEAD / 2; underruns++`.
- The context is `new AudioContext({latencyHint: 'interactive'})` at the
  device rate. The private method `#replace()` makes a new context when the
  old one cannot be resumed (issue 9); `recover` re-schedules the chunks
  that were not heard.
- `voice-engine.js` creates the player (line 72), calls `begin` on the
  `start` message (line 283), `push` per chunk (lines 313, 362), `time()`
  for the animation clock (line 372) and `stalled()` / `recover` (lines
  404 to 407). `render-ahead.js` decides when playback may begin.
- `tests/universal-app-audio.test.js` tests the player with a `FakeContext`
  that has no `audioWorklet`.
- `src/audio/resample.js` has `resample(samples, fromRate, toRate,
{zeroCrossings})`, a Blackman-windowed sinc for whole buffers. There is no
  streaming resampler, no `AudioWorklet` and no `SharedArrayBuffer` in the
  repository. The published app is not cross-origin isolated (see
  {{P12}}), so the message-port mode is the one most users get.

## What to do

1. `src/audio/resample.js`: add `createStreamResampler(fromRate, toRate,
{zeroCrossings = 8})`. It returns `{push(chunk), flush()}`; both return a
   `Float32Array`. It uses the same kernel as `resample` and keeps the last
   input samples it still needs. `push` returns every output sample whose
   whole window has arrived; `flush` returns the rest (missing input counts
   as 0). The total output length is `Math.round(totalInput * toRate /
fromRate)`. With equal rates it returns copies.
2. `src/playback/ring-buffer.js` (no imports, no DOM):
   - Layout of one buffer: an `Int32Array` of 8 words at byte 0, then a
     `Float32Array` of `capacity` samples at byte 32. Words: 0 `WRITE`,
     1 `READ` (both in samples, modulo `capacity`), 2 `PLAYED` (samples
     played since the last reset), 3 `UNDERRUNS`, 4 `ENDED` (1: the writer
     has no more audio), 5 `EPOCH` (the writer adds 1 to drop everything),
     6 and 7 unused. Export the indices as `RING`.
   - `createRing(capacity, {shared})` returns `{buffer, header, samples,
capacity}` on a `SharedArrayBuffer` (`shared: true`) or an
     `ArrayBuffer`; `ringFromBuffer(buffer)` builds the same views.
   - `ringAvailable(ring)`, `ringFree(ring)` (one slot stays empty),
     `ringWrite(ring, chunk, offset)` (returns the number written),
     `ringRead(ring, out, count)` (returns the number read),
     `ringEnd(ring)`, `ringReset(ring)`. All header access uses `Atomics`.
     One thread writes, one reads.
3. `src/playback/worklet-processor.js`: registers
   `'voice-simulator-player'`. The file must not contain `import`: a
   worklet module is loaded by URL. It repeats `ringRead` (a test compares
   it with the module). Behaviour of `process(inputs, outputs)`, with
   `n = outputs[0][0].length` (do not assume 128):
   - Sources. Shared mode: the main thread sends `{type: 'ring', buffer}`.
     Port mode: `{type: 'chunk', samples}` (transferred) is appended to a
     queue, `{type: 'end'}` and `{type: 'reset'}` act as `ENDED` and
     `EPOCH`.
   - States: `buffering` (output zeros) until at least `START` samples are
     buffered or the stream has ended; `START` is 0.05 s on the first start
     and 0.1 s after an underrun. Then `playing`.
   - Underrun: in `playing`, when fewer than `2 * n` samples are buffered
     and the stream has not ended, play `n` samples multiplied by a linear
     ramp from 1 to 0, add 1 to `UNDERRUNS`, go to `buffering`. The first
     block after `buffering` uses a ramp from 0 to 1.
   - Only played samples add to `PLAYED`. At the end of the stream play
     what is left, then zeros.
   - Port mode: post `{type: 'position', played, underruns, time:
currentTime}` every 8 blocks. Shared mode posts nothing.
   - Always return `true`.
4. `examples/universal-app/src/engine/worklet-player.js`:
   `export class WorkletPlayer extends AudioPlayer` with the same public
   methods and the field `mode`: `'worklet-shared'`, `'worklet-port'` or
   `'buffer'`. In `AudioPlayer`, rename `#replace()` to
   `replaceContext()` so the subclass can call it.
   - `unlock()`: after the base `unlock`, call
     `context.audioWorklet.addModule(processorUrl)` with `processorUrl =
new URL('../../../../src/playback/worklet-processor.js',
import.meta.url)` (option `processorUrl` overrides it), create
     `new AudioWorkletNode(context, 'voice-simulator-player',
{numberOfInputs: 0, outputChannelCount: [1]})` and connect it. If
     `audioWorklet` is missing or any of these calls fails, set `mode =
'buffer'`; then every method calls the base class. The option
     `{worklet: false}` forces this mode.
   - Shared mode needs `globalThis.crossOriginIsolated === true` and
     `SharedArrayBuffer`; the ring holds 3 s at `context.sampleRate`
     (browsers slow timers of hidden tabs to one per second).
   - `begin(rate)`: reset the ring, make a new
     `createStreamResampler(rate, context.sampleRate)`, clear the pending
     queue.
   - `push(start, samples)`: resample, append to the pending queue, pump.
     The pump writes into the ring while there is room (shared) or posts
     the chunk (port); a 20 ms interval repeats it while the queue is not
     empty. A new method `end()` flushes the resampler and marks the end;
     `voice-engine.js` calls it on the `end` message.
   - `time()`: `PLAYED / context.sampleRate` (shared) or the last
     `position` plus `context.currentTime - time`, not beyond what was
     pushed (port); `null` before the first sample plays.
   - `underruns` comes from the processor. `stalled()` uses "something is
     buffered" in place of `sources.size`. `recover(chunks)` calls
     `replaceContext()`, loads the module into the new context and pushes
     the chunks again from the playback position.
   - `stop()` resets the ring and the queue.
5. `voice-engine.js`: use `new WorkletPlayer()`; add `audioMode:
player.mode` to the status. `App.js` shows it next to the underrun count.
6. Package: add `"./playback": "./src/playback/index.js"` to `exports`;
   `index.js` re-exports the ring functions and
   `PLAYER_PROCESSOR_URL = new URL('./worklet-processor.js',
import.meta.url)`.
7. Check the built app (`npm run example:web:build`): the processor file
   must be in `dist` and load without a 404. If the build does not emit it,
   copy the file into `examples/universal-app/public/` in the build script
   and pass that URL as `processorUrl`.
8. Measure in Chrome and Firefox on one machine and record in the pull
   request: `context.baseLatency`, `context.outputLatency`, and the time
   from "Speak" to the first played sample for both players. Target for the
   part the player adds: at most 60 ms (150 ms today).

## Tests

`tests/stream-resampler.test.js`:

- `chunks equal the whole`: 1 s of a 440 Hz sine plus seeded noise at
  8000 Hz, pushed in chunks of 1, 127 and 1024 samples to 48000 Hz and to
  44100 Hz; the joined output has the length and, within 1e-6, the samples
  of `resample(all, from, to, {zeroCrossings: 8})`. Also 48000 to 44100.

`tests/playback-ring.test.js`:

- `write then read returns the samples`, also across the wrap-around;
  `a full ring refuses more` (`ringWrite` returns 0); `reset empties`.

`tests/playback-worklet.test.js`. A mock defines
`globalThis.AudioWorkletProcessor` (a class with a fake `port`),
`registerProcessor`, `sampleRate = 48000`, `currentTime`, then imports the
processor and calls `process([], [[new Float32Array(128)]])`:

- `waits for the start threshold`: with 1000 samples buffered the output is
  zeros; with 2400 it plays.
- `plays every sample once` (both modes): 48 000 ramp samples come out in
  order with no gap; `PLAYED` is 48 000.
- `underrun fades`: the supply stops without `end`; the last played block
  falls to 0 without a jump above the size of one ramp step; `UNDERRUNS`
  is 1; after 4800 more samples it fades in.
- `end drains`: with `end`, the last 100 samples are played.
- `processor matches the module`: both `ringRead` copies give equal output.

`tests/universal-app-audio.test.js`: with the present `FakeContext`
`new WorkletPlayer().mode` is `'buffer'` after `unlock()` and every
existing test passes with `WorkletPlayer` in place of `AudioPlayer`.

## Acceptance criteria

- [ ] The four test files above pass under `npm test`, `bun test` and
      `deno test -A`.
- [ ] `grep -c "^import" src/playback/worklet-processor.js` prints 0.
- [ ] In the built app in Chrome and Firefox the status shows
      `worklet-port`; with `VITE_CROSS_ORIGIN_ISOLATION=1` of {{P12}} (or a
      local server that sends the two headers) it shows `worklet-shared`.
- [ ] A 30 s text at tier `minimal` plays with 0 underruns; with the CPU
      throttled 6x in the Chrome developer tools the counter rises and no
      click is heard (a recording is attached).
- [ ] The latency numbers of step 8 are in the pull request and the added
      latency is at most 60 ms.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Writing into the ring from the synthesis worker (no main thread on the
  path): {{P17}} may do it once {{P13}} moved the worker into the library.
- Changing quality inside an utterance: {{P17}}.
- Cross-origin isolation of the published app: {{P12}}.
- Recording from the microphone ({{P62}}) and stereo output.

## References

- Chrome for Developers, "Audio worklet design pattern",
  https://developer.chrome.com/blog/audio-worklet-design-pattern
- MDN, "AudioContext() constructor",
  https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext
- Chrome for Developers, "Background tabs" (timer throttling),
  https://developer.chrome.com/blog/background_tabs
- Research note `docs/case-studies/issue-11/research/5-performance-and-physics.md`,
  section 5.
