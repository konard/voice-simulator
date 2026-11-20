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
before the recognizer commits sounds from the quiet interval.

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
