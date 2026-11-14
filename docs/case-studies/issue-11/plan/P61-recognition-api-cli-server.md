---
id: P61
title: Recognition API, command and server route with streaming results
type: Feature
milestone: M4
blocked_by: [P54, P56, P57]
requirements: [R3, R4, R6, R7, R10, R13]
---

## Goal

One public entry point turns audio into IPA, languages and text:
`recognize(samples, sampleRate, options)` for a whole recording and
`createRecognizer(options)` for audio that arrives in chunks. The same feature
is reachable as `voice-simulator recognize` and as `POST /api/recognize`.

## Why

The stages of the reverse simulation ({{P54}}, {{P56}}, {{P57}}) are separate
functions. Users, the app ({{P62}}), the round-trip tests ({{P63}}) and the
benchmark ({{P64}}) need one call with one result shape, and live use needs
results while the person is still speaking, with each syllable reported as it
is recognised.

## Current state

- `src/index.js` exports 243 names; none recognises speech. The only analysis
  exports are `analyzeVoice`, `matchVoice` and `matchVoiceSteps`.
- `bin/voice-simulator.js` has the commands `ipa`, `say`, `convert`,
  `timeline`, `visemes`, `head`, `mesh`, `match`, `benchmark` and `serve` in
  the object `COMMANDS`. Flags are declared in the object `OPTIONS` and parsed
  by `parseArgs`. `match` reads audio with `decodeAudio(readFileSync(file))`,
  which returns `{ samples, sampleRate }` (mono) for WAV, FLAC, AIFF and AU.
  `runCli(argv, io)` has no `stdin` in `io`.
- `src/server/server.js`: `createRoutes(version)` returns a table with keys
  such as `'GET /api/ipa'`. `createVoiceServer` maps every `POST` to the `GET`
  key, and `readBody()` accepts only JSON of at most `MAX_BODY = 64 * 1024`
  bytes. No route can receive audio.
- The synthesiser (`utteranceTimeline` in `src/articulation/timeline.js`)
  reports words with the keys `text`, `lang`, `ipa`, `start`, `end`,
  `sourceStart`, `sourceEnd` and `syllables`; a syllable has `ipa`,
  `stress`, `start`, `end`, `text`, `sourceStart` and `sourceEnd`.

## What to do

1. Create `src/recognition/recognizer.js`. Export `recognize`,
   `createRecognizer`, `RECOGNITION_LEVELS`, `levelForTier` and the class
   `RecognitionError` (an `Error` with a string field `code`).
2. Options of both functions (all optional):
   - `languages`: array of keys of `LANGUAGES`; default all of them. With
     one code, skip `identifyLanguage`.
   - `voice`: a voice configuration or `null` (default). Pass it on to
     `audioToIpa`.
   - `nbest`: integer 1 to 10, default 1. With more than 1 the result gets an
     extra key `alternatives`: an array of up to `nbest - 1` objects
     `{ text, ipa, confidence }`, best first.
   - `rescoring`: boolean, default `false`. When `true`, ask `audioToIpa`
     for `nbest: 10` and pass its result through `rescoreHypotheses` of
     {{P55}} before step 5 of `recognize`. If `src/recognition/rescoring.js`
     is not in the code base, throw `RecognitionError` with code
     `rescoring-unavailable`.
   - `modes`: boolean, default `true`. When `true`, call the mode recognisers
     of {{P58}} and {{P59}} if their modules exist; otherwise `modes` is `[]`.
   - `level`: `'auto'`, `'low'`, `'medium'` or `'high'`; default `'auto'`.
   - `stages`: object that replaces `audioToIpa`, `identifyLanguage` or
     `ipaToText` by another function. It exists for tests.
3. `RECOGNITION_LEVELS` is a frozen object. These values are the contract; map
   them to the option names the stage functions really have:
   - `low`: analysis rate 8000 Hz, frame hop 10 ms, search beam 8;
   - `medium`: analysis rate 16000 Hz, frame hop 5 ms, search beam 32;
   - `high`: analysis rate 16000 Hz, frame hop 5 ms, search beam 128.
     `levelForTier(name)` returns `'low'` for `telephone` and `narrowband`,
     `'medium'` for `wideband`, `minimal` and `low`, `'high'` for every other
     tier. In `recognize`, `'auto'` means `'medium'`.
4. `recognize(samples, sampleRate, options)`:
   1. Throw `RangeError` when `sampleRate` is not a number from 8000 to
      192000 or a sample is not finite. Throw `RecognitionError('empty')` when
      there are fewer than `0.05 * sampleRate` samples.
   2. If `sampleRate` is above the analysis rate of the level, convert with
      `resample()` from `src/audio/resample.js`. Never up-sample.
   3. Call `audioToIpa`. If it finds no speech, return the empty result
      `{ ipa: '', text: '', languages: [], words: [], modes: [], voice: null }`.
   4. Noise check: take the frame energies in dB from the front end. Let `s`
      be the mean of the loudest 20 % of frames and `n` the mean of the
      quietest 20 %. If the audio is longer than 1 s and `s - n < 5`, throw
      `RecognitionError('too-noisy')`.
   5. Call `identifyLanguage` (unless one language was given), then
      `ipaToText` with the language spans.
   6. Run the mode recognisers (option `modes`).
   7. Return the result in the shape fixed in the plan (`ipa`, `text`,
      `languages`, `words`, `modes`, `voice`). `voice` is `null` here; the
      voice session of {{P66}} fills it. Times are seconds of the input.
5. `createRecognizer(options)` needs `options.sampleRate`. It returns an object
   with `push(chunk)`, `flush()`, `reset()`, `on(event, listener)` and
   `off(event, listener)`. `chunk` is a `Float32Array` of any length.
   1. Keep the audio that is not committed yet in a buffer.
   2. Feed every chunk to one `createIpaDecoder(sampleRate, options)` of
      {{P54}}. Its `push(chunk)` runs all stages on the new frames and
      returns `{ segments, nuclei }`: the phonemes fixed by this call and
      the syllable nuclei confirmed by {{P50}} (at most 0.15 s after they
      were spoken). Do not call the batch functions (`analyzeFrames`,
      `findLandmarks`) again and again on a growing buffer. For every new
      nucleus emit `syllable` with `{ index, start, end, ipa }`; `ipa` is
      the text of the fixed segments between `start` and `end`, or `''`
      when none is fixed yet. `index` counts from 0 since the last
      `reset()`. A `syllable` event is never taken back; its `ipa` is a first
      guess and may differ from the final word.
   3. Every 0.25 s of new audio, take `result()` of the decoder (the
      phonemes of the uncommitted audio, fixed ones and the best guess for
      the rest), run steps 5 and 6 of `recognize` on it and emit `partial`
      with `{ words, ipa, text }`. A new `partial` replaces the previous one.
   4. Commit when the buffer holds a pause of at least 0.3 s, or when it is
      longer than 5 s (then cut at the last word boundary that is older than
      1 s). Emit `final` with `{ words, ipa, text, languages, modes }` for the
      words before the cut and drop their audio. Committed words never change.
      With `rescoring: true`, pass the phrase through `rescoreHypotheses`
      before `final` is made; times of syllables that were already emitted
      are not moved.
   5. `flush()` commits everything that is left, emits the last `final` and
      returns the complete result since `reset()` in the shape of `recognize`.
   6. Errors inside `push` are emitted as `error` and are not thrown.
   7. Level `'auto'` starts at `'medium'`. Measure the time spent per second
      of audio. If it is above 0.8 s over the last 2 s of audio, go one level
      down at the next commit. If it is below 0.3 s for 10 s, go one level up.
6. Command `recognize <file>` in `bin/voice-simulator.js`:
   - `<file>` is decoded with `decodeAudio`. Output: the text on one line;
     with `--ipa` the IPA instead; with `--json` the whole result as JSON.
   - `--lang en,ru` restricts the languages (a list separated by commas;
     `auto` or no flag means all). New flags: `--nbest <n>`, `--level <name>`,
     `--rescore`.
   - `<file>` equal to `-` reads standard input. With `--format raw` (and
     `--sample-rate`, `--bit-depth`, default 16000 and 16) the bytes are
     pushed into `createRecognizer` as they arrive and every `final` event is
     printed at once: one line of text, or one JSON object per line with
     `--json`. With any other format, standard input is read to the end first.
   - Add `stdin` to the `io` argument of `runCli` (default `process.stdin`).
   - Add the command and the flags to `usage()`.
7. Route `POST /api/recognize` in `src/server/server.js`:
   - In `createVoiceServer`, look up ``routes[`POST ${path}`]`` first. Such a
     route receives `(params, response, request)` with `params` taken from the
     query string only, and reads the body itself.
   - Add `readBytes(request, limit)` and the constants
     `MAX_AUDIO_BODY = 10 * 1024 * 1024` (bytes) and `MAX_AUDIO_SECONDS = 120`.
     Answer 413 when one of them is exceeded.
   - The body is an audio file. Query parameters: `lang`, `nbest`, `level`.
     Answer 200 with the result as JSON; 400 when `decodeAudio` fails; 422
     with `{ error, code }` for a `RecognitionError`.
   - With `stream=1` the body is raw 16-bit little-endian mono PCM at the rate
     given by `rate`. Push every received chunk into `createRecognizer` and
     answer with `content-type: application/x-ndjson`: one line
     `{"type":"final",…}` per commit and a last line `{"type":"result",…}`.
   - Add the route to the comment at the top of the file.
8. Export the new names from `src/index.js`. In `src/index.d.ts` add
   `RecognitionOptions`, `RecognitionResult`, `RecognizedWord`,
   `RecognizedSyllable`, `LanguageShare`, `ModeSpan`, `Recognizer` and
   `RecognitionError`.
9. Add a section "Recognition (speech to text)" to `README.md` with one
   example each for the function, the stream, the command and `curl`.

## Tests

`tests/recognizer.test.js` (stub stages through `options.stages` unless noted):

- `returns the fixed result shape`: the keys of the result are exactly `ipa`,
  `text`, `languages`, `words`, `modes`, `voice`; every word has `text`,
  `ipa`, `language`, `start`, `end`, `confidence`, `syllables`.
- `rejects empty and invalid input`: 0 samples gives code `empty`; rate 4000
  gives `RangeError`; white noise of 2 s gives code `too-noisy` (real stages).
- `returns the empty result for silence`: 1 s of zeros gives `text === ''`.
- `streams the same words as one call`: push a 4 s signal in chunks of 1024
  samples; the `final` words joined are equal to the words of `recognize`.
- `never changes committed words` and `never takes a syllable back`: record
  all events; later events do not contradict earlier `final` or `syllable`.
- `reports a syllable within 200 ms`: for every `syllable` event, the amount
  of audio pushed when it fires is at most `end + 0.2` s.
- `gives the first partial within 500 ms`: at level `low`, the first `partial`
  fires before 0.5 s of audio after the end of the first syllable is pushed.
- `recognises its own speech` (real stages): the audio of
  `synthesize('Hello world.', { lang: 'en', tier: 'minimal', seed: 1 })`
  gives the text `hello world` (compare after making both lower case and
  removing punctuation).

`tests/cli-recognize.test.js`: file input, `--json`, `--ipa`, raw standard
input in two chunks. `tests/server.test.js` (with `withVoiceServer`): 200 with
a WAV body, 413 above the limit, 400 for text bytes, NDJSON with `stream=1`.

## Acceptance criteria

- [ ] `node bin/voice-simulator.js say "Hello world." -o /tmp/h.wav` followed
      by `node bin/voice-simulator.js recognize /tmp/h.wav` prints the
      words `hello world` (capitals and punctuation do not count).
- [ ] `recognize /tmp/h.wav --json` prints an object with exactly the six
      fixed keys.
- [ ] The tests above exist and pass on Node.js, Bun and Deno.
- [ ] At level `low`, one core recognises 10 s of 8000 Hz audio in less than
      5 s on the CI runner (printed by the test `runs faster than real time`).
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- The contents of `modes` and the tone, stress and punctuation marks:
  {{P58}}, {{P59}}, {{P60}}.
- The app panel: {{P62}}. Rust and several cores: {{P65}}.
- Fitting the voice while recognising (`voice` in the result): {{P66}}.
- Accuracy thresholds: {{P63}} for own speech, {{P64}} for real recordings.

## References

- Ney, H., Ortmanns, S. (2000). Progress in dynamic programming search for
  LVCSR. Proceedings of the IEEE 88(8), 1224-1240.
- Kaldi online decoding (partial results that may change until the utterance
  ends): https://kaldi-asr.org/doc/online_decoding.html
- NDJSON, one JSON value per line.
- Research notes, section 6 (timing design):
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
