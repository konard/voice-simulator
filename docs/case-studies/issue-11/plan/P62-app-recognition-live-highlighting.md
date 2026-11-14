---
id: P62
title: 'App: recognition from the microphone and files with live syllable highlighting'
type: Feature
milestone: M4
blocked_by: [P61]
requirements: [R6, R7, R10]
---

## Goal

The example app gets a panel "Recognise speech". It takes sound from the
microphone or from an audio file, shows the recognised text and IPA while the
sound arrives, and marks the syllable that was recognised last with the same
highlight that marks the spoken syllable during synthesis.

## Why

The issue asks that syllables are highlighted "also in recognition, when we
recognize the syllable". The app is the place where people try the library;
without a panel the reverse direction ({{P61}}) can only be used from code.

## Current state

All paths are below `examples/universal-app/src/`.

- `components/VoiceMatch.js` is the only code that uses a microphone. It
  calls `navigator.mediaDevices.getUserMedia({ audio: true })`, records with
  `MediaRecorder`, and decodes the whole recording after the user stops
  (library `decodeAudio` first, then `AudioContext.decodeAudioData`). No code
  reads microphone samples while they arrive; this prints nothing:
  `grep -rnE "AudioWorklet|createScriptProcessor" examples/universal-app/src`.
  There is no drag and drop.
- `components/SpokenText.js` renders
  `SpokenText({ rootRef, text, lang, timeline, t })`: a `section.spoken`
  with `aria-live="polite"` and two lines,
  the text and the IPA, built by `textPieces(text, timeline)` and
  `ipaPieces(timeline)` from `components/highlight.js`. Spans carry
  `data-word` and `data-syllable`. `paintHighlight(root, frame)` with
  `frame = { speaking, time, timeline }` changes only CSS classes and
  `aria-current`, so screen readers do not read the text again.
- `textPieces` needs `sourceStart` and `sourceEnd` (offsets into `text`) on
  every word and syllable, and words carry `lang`. The result of `recognize`
  has neither: its words carry `language` and no offsets.
- `engine/listening.js` already exists and means something else: the
  microphone and room of the simulated listener. So the new feature is called
  "recognition" in file names, identifiers and labels, never "listening".
- `i18n.js` has exactly two locales, `en` and `ru`.
  `tests/universal-app-i18n.test.js` fails when their keys differ.
- Workers are created as
  `new Worker(new URL('./x.js', import.meta.url), { type: 'module' })`;
  `VoiceEngine` in `engine/voice-engine.js` takes a
  `createWorker` option so that tests can pass a fake worker.

## What to do

1. `components/recognition-timeline.js` (pure functions, no React):
   - `recognitionTimeline(result)` returns `{ text, timeline }` in the shape
     `SpokenText` reads. Algorithm: `text` is `result.text`. Keep a cursor
     at 0. For each word: find `word.text` in `text` at or after the cursor
     (compare in lower case); that index is `sourceStart`, and `sourceEnd` is
     `sourceStart + word.text.length`; move the cursor to `sourceEnd`. Inside
     the word do the same for each syllable with `syllable.text`. Copy `ipa`,
     `start`, `end`, `stress`; set `lang` to `word.language`. `duration` is
     the `end` of the last word, or 0.
   - `mergeResults(finals, partial)` joins the committed `final` results and
     the current `partial` into one result (texts joined by one space, word
     lists concatenated).
2. `engine/microphone.js`: `createMicrophone({ onChunk, onError })` returns
   `{ start(), stop(), sampleRate }`.
   - `start()` calls `getUserMedia({ audio })`, where `audio` has
     `channelCount: 1` and `echoCancellation`, `noiseSuppression` and
     `autoGainControl` all `false`, creates an `AudioContext`, and
     connects the stream to an
     `AudioWorkletNode` whose processor (`engine/capture-processor.js`) posts
     every block of channel 0 as a `Float32Array`.
   - When `audioWorklet` is missing, use `createScriptProcessor(2048, 1, 1)`.
   - `onChunk(samples, sampleRate)` is called for every block. `stop()` stops
     the tracks and closes the context.
   - Accept `{ context, getUserMedia }` as a second argument for tests.
3. `engine/recognition-worker.js`: a module worker around `createRecognizer`.
   Messages in: `{ type: 'start', sampleRate, languages, level }`,
   `{ type: 'chunk', samples }` (transfer the buffer), `{ type: 'stop' }`.
   Messages out: `{ type: 'syllable' | 'partial' | 'final', ... }` with the
   event payload, `{ type: 'result', result }` after `flush()`, and
   `{ type: 'error', message, code }`.
4. `engine/recognition-session.js`: class
   `RecognitionSession({ createWorker, onChange })` in the style of
   `VoiceEngine`. Methods `start(source)`, `stop()`, `reset()`. `source` is a
   microphone from step 2 or `{ samples, sampleRate }` from a file; a file is
   sent in chunks of 20 ms as fast as the worker answers. `status` holds
   `{ state, result, lastSyllable, error }` with `state` one of `idle`,
   `asking`, `running`, `done`, `error`; `result` is `mergeResults(...)`;
   `lastSyllable` is the `end` time of the newest `syllable` event.
5. `components/Recognition.js`: a `section.panel` with
   `aria-labelledby="recognition-title"`, placed after `VoiceMatch` in
   `App.js`. Content, top to bottom:
   - the note `t.recognitionPrivacy`;
   - buttons `t.recognitionStart` / `t.recognitionStop`, a file input
     `#recognition-file` with the same `accept` list as `VoiceMatch`, and a
     drop zone (`dragover` and `drop` on the section; first file only);
   - a language choice: `t.recognitionAuto` or one language;
   - `SpokenText` with `recognitionTimeline(status.result)`. Call
     `paintHighlight(root, { speaking, time, timeline })` with
     `speaking = state === 'running'` and `time = lastSyllable - 0.001`
     after every `syllable` event, so the
     newest syllable is marked. When the state is `done`, clear the mark;
   - words of the unstable tail (from `partial`) get the class `tentative`
     (grey, italic). Committed words never move or change;
   - when the result has more than one language, each run of words in one
     language starts with a badge `<span class="language-badge">` holding the
     code, and every word span has the HTML attribute `lang`;
   - spans of `result.modes` are shown as a line under the IPA: the notation
     of the mode and its time range. With no modes the line is absent;
   - button `t.recognitionSpeakBack`: enabled in state `done` with a
     non-empty text. It puts `result.text` and the first language into the
     text field of the app and starts synthesis;
   - a status line with `role="status"`: `t.recognitionStates[state]`, and
     for errors `t.recognitionDenied` (permission refused),
     `t.recognitionTooNoisy`, `t.recognitionEmpty` or the message.
6. Move the file decoding function `decodeAudio` out of
   `components/VoiceMatch.js` into `engine/decode-file.js` and import it in
   both panels (the duplication check of `npm run check` fails otherwise).
7. Add every new string to both locales in `i18n.js`. The privacy note in
   English: "Recognition runs on this device. No audio is sent anywhere."
8. Styles in `styles.css`: `.tentative`, `.language-badge`, the drop zone
   outline while a file is dragged over it. Respect
   `prefers-reduced-motion` as the existing highlight does.
9. Add the panel to the app's `README.md` and add one screenshot of the panel
   after recognising a file to `docs/screenshots/`.

## Tests

`tests/universal-app-recognition.test.js` (no browser; fakes as in
`tests/universal-app-highlight.test.js`):

- `maps a result to a timeline`: for a result with the words `hello`
  (`hel`, `lo`) and `world`, `recognitionTimeline` gives `sourceStart`/
  `sourceEnd` of 0/5 and 6/11 and syllables 0/3 and 3/5.
- `marks the newest syllable`: build spans with `fakeRoot`; after
  `paintHighlight` with `time` inside the second syllable, only that span has
  the class and `aria-current`.
- `keeps committed words`: feed `final` (2 words), `partial` (1 word),
  `partial` (2 other words) into a `RecognitionSession` with a fake worker;
  the first 2 words of `status.result` are the same objects all the time.
- `sends a file in 20 ms chunks`: a 1 s file at 16000 Hz makes 50 `chunk`
  messages of 320 samples and one `stop`.
- `falls back without AudioWorklet`: a fake context without `audioWorklet`
  makes `createMicrophone` call `createScriptProcessor`.
- `reports a refused permission`: a `getUserMedia` that rejects with
  `NotAllowedError` gives state `error` and no worker.
- `has all strings in both locales`: the existing i18n test passes.

## Acceptance criteria

- [ ] `npm test` runs `tests/universal-app-recognition.test.js` and it passes.
- [ ] `cd examples/universal-app && npm run build` succeeds.
- [ ] In the built app, dropping a WAV file made with
      `voice-simulator say "Hello world." -o hello.wav` shows `hello world`,
      its IPA, and the highlight moves over 3 syllables (checked with
      Playwright; the screenshot is in the pull request).
- [ ] With the browser network panel open, recognising a file makes 0
      requests.
- [ ] `grep -rn listening examples/universal-app/src/components/Recognition.js`
      prints nothing.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Copying the speaker's voice while recognising: {{P68}} (it reuses
  `createMicrophone`, `RecognitionSession` and the highlight of this issue).
- Recognition quality. This issue shows what {{P61}} returns.
- Rust or several cores in the worker: {{P65}}.
- More UI languages than `en` and `ru`.

## References

- W3C, Web Audio API, `AudioWorkletNode` and `AudioWorkletProcessor`.
- W3C, Media Capture and Streams, `getUserMedia` constraints.
- WAI-ARIA 1.2, `aria-live` and `role="status"`.
- Research notes, section 6 (what may change and what may not while speech
  arrives):
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
