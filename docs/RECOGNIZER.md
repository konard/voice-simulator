# Speech recognition

`recognize(samples, sampleRate, options)` accepts mono finite samples at
8,000–192,000 Hz. The result contains `ipa`, `text`, `languages`, `words`,
`modes` and `voice`. Timings are in seconds from the beginning of the input.
`voice` is null. `nbest` accepts 1–10 and adds a ranked `alternatives`
array when greater than one.

`languages` defaults to English, Russian, Hindi and Mandarin. Pass a single
code to skip language identification. `voice` accepts a head configuration.
Set `modes: false` to skip tone, stress, punctuation and mode analysis, or
`rescoring: true` to compare alternative IPA readings. The `low`, `medium` and `high` levels use
8/16/16 kHz rate ceilings, 10/5/5 ms frame hops, and beams of 8/32/128.
Batch `auto` uses the medium level.

Whisper detection runs by default. Detected words appear inside `{W … W}`
in `ipa`, with timed whisper entries in `modes`. Pass `whisper: false`
to disable detection or `whisper: [{ start, end }]` to supply known spans.
Explicit span times are measured from the beginning of the input, including
across phrase commits in a stream.
Optional IPA resynthesis uses the same phonation and averages five acoustic
power frames within those spans.

For short, intact default-voice English renders at 22.05 or 48 kHz, batch
recognition can compare one- and two-word dictionary pronunciations with
the recording. The synthesis planner supplies the candidate times and the
waveguide verifies each candidate acoustically. A recording detected as
whispered throughout uses whispered references and averages five power
spectra for each comparison. Uncertain matches use the general decoder.
With a supplied voice configuration and 22.05 kHz English audio, it can
also check pronunciations with a short first word and two following words.
An unvoiced run outside the automatic detector's spectral threshold needs
a close match from the same solver to be marked as whispered.
For subsecond whispered clips with a supplied voice, the IPA decoder can
also refine an isolated vowel–consonant–vowel reading. It tests the decoded
vowels with the language's consonants and accepts a reading only when the
entire rendered clip agrees with the input. The same measured duration
and level cues then determine its consonant voicing probability.

`createRecognizer({ sampleRate, ...options })` accepts `Float32Array` chunks.
Subscribe with `on(event, listener)` and remove the same listener with
`off(event, listener)`. The four events are:

- `syllable` announces each confirmed nucleus once with its index, time span
  and any already fixed IPA. The final pronunciation can differ.
- `partial` offers the current uncommitted words, IPA and text every quarter
  second of new audio, and as soon as the first words are available after an
  empty reading.
- `final` commits each phrase's words, IPA, text, languages and modes. A pause
  of at least 300 ms closes a phrase. Longer phrases can commit at an earlier
  word boundary. Times remain relative to the beginning of the stream.
- `error` reports failures during `push`. Call `reset()` to start a new
  stream after an error or after `flush()`. Reset retains subscriptions.

`flush()` finishes the stream and returns the complete result. With level
`auto`, live recognition starts at medium and adjusts at commits based on
the processing cost of recent audio.
Mode decisions are made at a pause or after half a second of speech. A
quiet transition from periodic speech can also start a new decision inside
a phrase. The spectrum is checked against the preceding voiced interval
before the recognizer commits sounds from the quiet interval. The detector
can also bound a quieter whisper between two voiced intervals in one speech
run.

`voice-simulator recognize` accepts WAV, AIFF, AU and FLAC from a file or
standard input. For raw standard input, use `--format raw` and optionally
`--sample-rate` and `--bit-depth` (defaults 16000 and 16). `--ipa` prints IPA
and `--json` prints structured output. Use `--no-whisper` to disable
automatic whisper detection. Raw input prints a line for each
committed phrase.

`POST /api/recognize` accepts an audio file as its body, with optional
`lang`, `nbest` and `level` query parameters. The maximum body is 10 MiB and
the maximum audio duration is 120 seconds. An invalid file returns 400, a
limit violation returns 413, and a recognition error returns 422 with an
`error` message and `code`. With `stream=1&rate=16000`, send raw 16-bit
little-endian mono PCM. The NDJSON response delivers rows with type `final`
as phrases commit and ends with a row of type `result`. If a chunked upload
exceeds a limit after the response has already begun, its last row has
type `error` and status 413.

Current audio-to-IPA accuracy is tracked in
[issue #153](https://github.com/konard/voice-simulator/issues/153).

## Examples

```js
import { createRecognizer, recognize } from 'voice-simulator';

const result = recognize(samples, sampleRate, { languages: ['en'] });
const live = createRecognizer({ sampleRate, level: 'auto' });
live.on('syllable', ({ start, end }) => highlight(start, end));
live.on('final', ({ text }) => console.log(text));
for await (const chunk of audioChunks) live.push(chunk); // Float32Array
const complete = live.flush();
```

```sh
voice-simulator recognize speech.wav --lang en --json
curl --data-binary @speech.wav 'http://localhost:8080/api/recognize?lang=en'
```

Use `recognize - --format raw` for live PCM on standard input, or
`POST /api/recognize?stream=1&rate=16000` for 16-bit little-endian PCM and
NDJSON. Partial events replace the preceding partial. Final events commit
words in input time.

## Native CLI

The native Rust command decodes PCM or float RIFF/WAV to IPA and reports
per-stage times. It uses the bundled default head with acoustic analysis,
pitch, inverse filtering, landmarks, codebook search, tract inversion
and an IPA decoder. Its optional `--rescore` reconstructs candidate waveforms
with the scalar waveguide and compares their cepstra to the recording. The
JavaScript recognizer adds
speaker fitting, language identification, words, prosody and speech modes.
Run `node scripts/build-native-recognition.mjs` to regenerate the native
tables from the default acoustic model.

To time five fox sentences per quality level, build WebAssembly and run
`node scripts/profile-recognition.mjs js` and
`node scripts/profile-recognition.mjs rust`. The manually triggered
`recognition-performance` CI suite compares one, two and four threads on
60 seconds of synthetic speech and checks the cold one-core CLI at 8 kHz.

## Speech-mode recognition

`recognizeModes(samples, sampleRate, result, { voice })` adds manner of speech to timed IPA words. A span is `{ start, end, from, to, effort: 0.75, notation: 'f', confidence: 0.8 }`: seconds, end-exclusive word indexes and only the decided mode fields. Phonation and tempo use synthesis brace marks; emotions use `notation: null`; sounds have `sound` instead of word indexes.
`toPlanModes(result.modes)` supplies word spans, including emotions, to `planUtterance(result.ipa, { modes })`. It retains activation already covered by physical modes as an observation (`emotion.realized: true`) to avoid applying it twice. See [the API and acoustic rules](RECOGNITION-MODES.md) for baseline, abstention, diagnostics and limits.

## Articulatory codebook

`buildCodebook(head, { size: 20000, seed: 1, cache })` builds a deterministic simulator-generated table of tract positions, formants and spectral envelopes. `frameEnvelope(frames, t, table, out)` reads an analysis frame; `table.query(envelope, 16, out)` returns candidate rows and envelope costs without allocating. `CODEBOOK_CHANNELS` defines the twelve tract controls; `serializeCodebook` and `parseCodebook` support a caller-owned binary cache. Tables use 0.5 cm length buckets and are generated on demand. See [API, layout, source limits and verification](CODEBOOK.md).

`npm run build:wasm` regenerates the optional oral response data used by the Node-compatible runtime for the default 256-row codebook. Recognition computes the responses directly for custom geometry or when the file is absent. Nasal responses are rendered for the selected voice.

## Acoustic-to-articulatory inversion and IPA decoding

`invertArticulation` and `createArticulationInverter` recover simulator controls from analysis frames. Use `articulationPlan(track)` to render them. The recognizer's batch and streaming articulation tracks include the `whisper` control and use a lazily rendered reference table within whispered spans. See [inversion usage and accuracy](CODEBOOK.md#acoustic-to-articulatory-inversion).
`audioToIpa(samples, sampleRate, { voice, language: 'en', nbest: 5 })` returns experimental timed phonemes and syllables, ranked readings, a lattice, and analysis tracks. It fits the head when `voice` is omitted. `createIpaDecoder(sampleRate, options)` returns fixed phonemes and nuclei as audio arrives. See the [decoder API and measured accuracy](CODEBOOK.md#audio-to-ipa). Experimental syllable nuclei and broad sound classes are available through `findLandmarks`, `createLandmarkDetector` and `BROAD_CLASSES`. See the [landmark API, streaming contract and measured quality limits](RECOGNITION-LANDMARKS.md).
`rescoreHypotheses(decoded)` compares uncertain n-best stretches with waveguide renders in the fitted voice and returns revised timed IPA, scored alternatives and render statistics. See the [rescoring API and evaluation](CODEBOOK.md#analysis-by-synthesis-rescoring). The [prosody stages](RECOGNITION-PROSODY.md) measure timed vowels and restore stress, tone, punctuation and emphasis.
