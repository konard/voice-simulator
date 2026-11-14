---
id: P68
title: App: copy a voice while the person keeps speaking
type: Feature
milestone: M5
blocked_by: [P66, P62]
requirements: [R9, R10, R3]
---

## Goal

Add a "Copy a voice" panel to the example app. The person talks into the
microphone (or opens a file) and watches the voice session of {{P66}} work:
which pass it is in, the text it recognises with syllables lighting up, the
head and voice numbers settling, and a stability meter. When the voice is
stable they can speak any text with it, repeat what they just said, or save
the voice. Everything runs on the device.

## Why

The multi-pass copy is the part of the vision that people can see and judge
for themselves. The app is where the project is tried out; a library function
alone would leave "the person keeps speaking" untested with a real
microphone, a real slow phone and a real user who needs to know why nothing
has happened in the first two seconds.

## Current state

- `examples/universal-app/src/components/VoiceMatch.js` is the only voice
  copy in the app. `startRecording()` uses `MediaRecorder`: the clip is
  recorded to the end, decoded, and only then analysed. Nothing is shown
  while the person speaks.
- The transcript must be typed into `#match-transcript`; the app recognises
  nothing.
- `examples/universal-app/src/engine/match-worker.js` is a one-shot worker:
  it receives `{ samples, sampleRate, transcript, lang, preset }`, posts
  `{ type: 'step', step, total, distance }` a few times and then
  `{ type: 'done', head, preset, features, distance }`. It runs `matchVoice`
  (six parameters, one pass).
- Progress is the text "step / total". The result is applied with the button
  `t.applyVoice`. There is no consent question and no way to save a voice
  from this panel.
- Strings exist in two locales, `en` and `ru`, in
  `examples/universal-app/src/i18n.js`; `tests/universal-app-i18n.test.js`
  fails when the two locales have different keys.

{{P62}} adds `createMicrophone` (`engine/microphone.js`), the class
`RecognitionSession`, `recognitionTimeline`, `mergeResults` and
`engine/decode-file.js`. This issue reuses them; it must not add a second
microphone path, a second file decoder or a second highlighter.

## What to do

All paths are under `examples/universal-app/src/`.

1. Worker `engine/session-worker.js`. Put the logic in an exported function
   `createSessionHost({ post })` that returns `{ handle(message) }`; the
   worker file itself only connects it to `self.onmessage` and
   `postMessage`. This makes it testable without a browser.
   - Messages in: `{ type: 'start', sampleRate, languages, level }`,
     `{ type: 'chunk', samples }` (a transferred `Float32Array`),
     `{ type: 'stop' }`, `{ type: 'reset' }`, `{ type: 'share', value }`,
     `{ type: 'speak', id, text, lang, tier }` and
     `{ type: 'repeat', id, tier }`.
   - Messages out: every session event with its payload and the same `type`
     (`state`, `voice`, `partial`, `final`, `syllable`). A `voice` message
     also carries `changes` of the newest entry of `session.history`.
     Once per second of audio `{ type: 'load', load }` with `session.load`.
     The answer to `speak` and `repeat` is
     `{ type: 'audio', id, samples, sampleRate }` (buffer transferred).
     Failures are `{ type: 'error', message }`.
   - `start` calls `createVoiceSession` of {{P66}} with `sampleRate`,
     `languages`, `level` and `realtime: true`. `stop` calls `flush()`.
     `share` assigns `session.backgroundShare`.
   - `speak` calls `session.speak(text, { lang, tier })`.
   - `repeat` copies the last finished utterance (the audio between the
     start of the first and the end of the last word of the newest `final`):
     `copyRecording` of {{P67}} with `voice: session.voice` when the
     library exports it, otherwise
     `synthesize(final.ipa, { ipa: true, head: session.voice, tier })`.
2. Controller `engine/copy-session.js`: class
   `CopySession({ createWorker, onChange })` in the style of
   `RecognitionSession`. Methods `start(source)`, `stop()`, `reset()`,
   `speak(text, lang)`, `repeat()`. `source` is a microphone of
   `createMicrophone` or `{ samples, sampleRate }` from a file, sent in
   chunks of 20 ms as fast as the worker answers. `status` holds `state`,
   `reason`, `load`, `overloaded`, `voice`, `uncertainty`, `changes`,
   `stability`, `converged`, `result` and `lastSyllable` (the last two as in
   `RecognitionSession`).
   - `stability` = `1 - min(1, max(changes) / 0.1)`; 0 before the first
     `voice` message. It is 0.8 or more when no parameter moved by more than
     2 % of its range in the last pass.
   - One worker per session, created in `start` and terminated in `reset`.
     Nothing of the session runs on the main thread. The synthesis worker of
     the app keeps its own thread.
3. Precision (requirement R3). The recogniser of {{P61}} and the scheduler
   of {{P66}} already make themselves cheaper under load. The app adds:
   - the start level: `levelForTier(tier)` of {{P61}} with the tier the
     device benchmark of the app chose, or `'auto'` when the app has no
     benchmark result;
   - a last resort: when `load` is above 0.8 in two `load` messages in a
     row, post `{ type: 'share', value: 0 }` (the fits pause, recognition
     goes on), set `status.overloaded` and show `t.copyOverloaded`. When
     `load` is below 0.5 in two messages in a row, post
     `{ type: 'share', value: 0.25 }` and clear the flag. Audio is never
     dropped.
4. Component `components/VoiceCopy.js`: a `section.panel` with
   `aria-labelledby="copy-title"`, placed after the recognition panel in
   `App.js`. Content, top to bottom:
   - the note `t.copyPrivacy` ("Your voice is analysed on this device. No
     audio is sent anywhere.");
   - buttons `t.copyStart` / `t.copyStop` and a file input `#copy-file`;
   - a status line with `role="status"`: the sentence
     `t.copyStates[state]`. English texts: `collecting`: "Listening. Keep
     talking: about two seconds of speech are needed for a first guess.";
     `fitting`: "First guess of the voice."; `inverting`: "Working out what
     was said with that voice."; `refining`: "Improving the voice from what
     was said."; `stable`: "The voice is stable. Recognition is now tuned to
     this speaker.". After a `state` message with reason `speaker-change`
     show `t.copySpeakerChanged` first;
   - `<progress id="copy-progress" max="1">`: voiced seconds so far divided
     by 2 in `collecting`, no `value` attribute in `fitting` and
     `inverting`, `stability` in `refining`, 1 in `stable`;
   - `<meter id="copy-stability" min="0" max="1">` with the label
     `t.copyStability` and the largest change of the last pass as text in
     percent;
   - `SpokenText` with `recognitionTimeline(status.result)`, painted as the
     recognition panel does;
   - a table of the fitted parameters: label from `parameterLabel`, value
     with unit, "±" and `uncertainty` (empty before `stable`). Rows change
     on every `voice` message;
   - the 3D head follows `voice` through `onHead`, at most 4 times per
     second (only once, on `stable`, under `prefers-reduced-motion`);
   - a check box `#copy-consent` with the label `t.copyConsent` ("I am the
     speaker, or I have the speaker's permission to copy this voice."). It
     is unchecked at every page load and is not stored;
   - buttons, enabled only when `status.voice` exists: `t.copySpeak` (keeps
     the copied voice as the head of the app and speaks the main text),
     `t.copyRepeat`, `t.copySave` (downloads `voice.json`: `saveVoice` of
     {{P29}} when the library exports it, otherwise the head
     configuration as JSON) and `t.copyReset` (restores the head shown
     before `start`). `t.copySave`, and the audio export of the app while
     the copied voice is the head, stay disabled until `#copy-consent` is
     checked.
5. Add every string to `en` and `ru` in `i18n.js`.
6. Accessibility: every control has a visible label and works with the
   keyboard; the state is text, not only colour; the meter and the progress
   bar have `aria-label`s.
7. Browser check `scripts/check-app-copy.mjs` (uses the `playwright` version
   already pinned in `.github/workflows/example-app.yml`): build the app,
   write a 20 s synthetic recording (`female` preset) as WAV, open the app in
   Chromium started with `--use-fake-ui-for-media-stream`,
   `--use-fake-device-for-media-stream` and
   `--use-file-for-fake-audio-capture=<wav>`, press `t.copyStart`, wait for
   the text of `stable`, save `docs/screenshots/copy-voice.png`. Record the
   longest main-thread task with a `PerformanceObserver` for `longtask`.
   Run it again with `Emulation.setCPUThrottlingRate` 6. Call the script
   from `tests/heavy/copy-app.test.js` (suite `copy` of {{P02}}), which
   skips with a message when Chromium is not installed.
8. Update `examples/universal-app/README.md` and the root `README.md`.

## Tests

`tests/universal-app-copy.test.js` (no browser; a fake worker as in
`tests/universal-app-engine.test.js`, and `createSessionHost` run directly
with `post` collecting the messages in an array):

- `reaches a stable voice from a fake microphone`: synthesise about 8 s of
  English with preset `female` (tier `minimal`, 16 kHz, `seed: 1`), feed it
  to `createSessionHost` as `chunk` messages of 320 samples, then `stop`.
  The posted `state` messages are `collecting`, `fitting`, `inverting`,
  `refining` (one or more), `stable`; the last `voice` message has `pitch`
  within 5 % and `vocalTractLength` within 8 % of the preset.
- `repeats what was said`: after that, `repeat` posts one `audio` message
  whose duration is within 20 % of the utterance.
- `pauses the fits when overloaded`: two `load` messages of 0.9 make
  `CopySession` post `{ type: 'share', value: 0 }`; one does not; two of
  0.4 afterwards post `{ type: 'share', value: 0.25 }`.
- `computes stability`: `changes` with `pitch` 0.01 and `vocalTractLength`
  0.02 give `stability` 0.8.
- `asks for consent before saving`: the exported function
  `canSave(status, consent)` is `false` without consent or without a voice.
- `sends no audio to the network`: the sources of `session-worker.js`,
  `copy-session.js` and `VoiceCopy.js` do not contain `fetch(`,
  `XMLHttpRequest`, `WebSocket` or `sendBeacon`.

The existing i18n test must pass with the new keys.

## Acceptance criteria

- [ ] `node --test tests/universal-app-copy.test.js` passes in under 30 s.
- [ ] `npm run example:web:build` succeeds.
- [ ] `node scripts/check-app-copy.mjs` reaches `stable` within the 20 s
      recording at CPU throttling 1 and at 6, and prints the longest
      main-thread task; it is at most 100 ms in both runs.
- [ ] With the browser network panel open, a session makes 0 requests.
- [ ] `docs/screenshots/copy-voice.png` is committed and shown in the pull
      request.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- The session itself: {{P66}}. Copy synthesis quality: {{P67}}.
- Recognition without voice copy, and the microphone and highlight modules:
  {{P62}}. The device benchmark: {{P16}}.
- Removing the old panel `VoiceMatch`. It stays until this panel has been
  released once.
- Storing voices in the browser or syncing them between devices.

## References

- Web Audio API, `AudioWorklet`: https://www.w3.org/TR/webaudio/
- WAI-ARIA 1.2, live regions and the `status` role:
  https://www.w3.org/TR/wai-aria-1.2/
- `docs/VISION.md`, sections "Copying a voice" and "Not goals".
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`
  (section 6, timing of live results).
