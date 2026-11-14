---
id: P67
title: Copy synthesis: reproduce a real recording
type: Feature
milestone: M5
blocked_by: [P66, P58, P59, P08]
requirements: [R8, R9]
---

## Goal

Add `copyRecording(samples, sampleRate, options)` and the command
`voice-simulator copy in.wav -o out.wav`. Given a recording of a person, they
produce a simulated utterance that says the same phonemes at the same times
with the same melody, loudness and voice quality, in the copied voice, and a
"score" (IPA with times and prosody) that can be edited and rendered again.

## Why

The vision says the system "reproduces a real recording ... close enough to
be measured against the original". Copy synthesis is also the cleanest test
of the simulator itself: when timing, pitch and loudness are taken from the
recording, every remaining difference is the fault of the voice source, the
tract or the articulation, not of the text front end. Gao, Stone and Birkholz
(2019) do this for VocalTractLab with a genetic algorithm; no permissively
licensed tool does it without a neural network (research notes 1, "Gaps").

## Current state

- There is no `src/session/copy.js` and no `copy` command
  (`node bin/voice-simulator.js --help` lists `ipa`, `say`, `convert`,
  `timeline`, `visemes`, `head`, `mesh`, `match`, `benchmark`, `serve`).
- The nearest thing is `voice-simulator match in.wav --transcript "..."`
  followed by `say` with the head it prints. The words must be typed by the
  user. The copy then has the timing and the melody of the rules, not of the
  recording.
- `planUtterance(ipa, { head, language, frameRate })` in
  `src/articulation/plan.js` decides durations in `buildSegments()` and pitch
  in `fillPitch()`. It has no argument to impose measured durations or a
  measured pitch contour. It returns
  `{ tokens, segments, head, frameRate, frameCount, duration, channels }`;
  `channels` holds one `Float32Array` per name of `CHANNELS` (among them
  `f0` in Hz and `loudness`) at `CONTROL_RATE` = 200 frames per second, and
  `renderPlan(plan, options)` in `src/acoustics/voice.js` renders it. So a
  plan can be edited before rendering, but no code does it.

## What to do

Create `src/session/copy.js` (helpers in `src/session/score.js` and
`src/session/warp.js`), export from `src/index.js` and `src/index.d.ts`.

1. `copyRecording(samples, sampleRate, options)`. Options and defaults:
   `tier` (as `synthesize`), `seed` (1), `languages` (all), `voice` (skip the
   fit and use this voice), `impose`
   (`{ durations: true, pitch: true, loudness: true, modes: true }`),
   `refine` (`false`), `refineBudget` (200 renders). Returns
   `{ samples, sampleRate, duration, score, voice, recognition, metrics }`.
2. Analysis. Call `copyVoice` of {{P66}} (with `options.voice`: only its
   recogniser). Keep the voice, the `recognize` result and its `modes`
   ({{P58}}, {{P59}}). Phoneme times are needed, and the result of
   `recognize` ({{P61}}) has only words and syllables. Add the option
   `segments` (boolean, default `false`) to `recognize` and
   `createRecognizer`. With `true` the result gets one extra key,
   `segments: [{ ipa, start, end, confidence }]` (one entry per phoneme,
   from `audioToIpa` of {{P54}}), in the same way as `nbest` adds
   `alternatives`. Without the option the result keeps exactly its six
   keys, so the tests of {{P61}} stay as they are. Document the option in
   `src/index.d.ts` and in the README section on recognition. `copyVoice`
   passes `segments: true`.
3. Plan. `planUtterance(recognition.ipa, { head, language })` with the copied
   voice, `vibrato: 0` (the measured contour already holds it) and the
   language with the largest share.
4. Durations (`warp.js`, `warpPlan(plan, measuredSegments)`). Group the plan
   segments by IPA token. Build a piecewise linear map from recording time to
   plan time with one anchor at the start and end of every token; silence
   between recognised words maps to the pause of the plan, or to a new
   silent stretch when the plan has none. Make new channels of
   `ceil(duration * frameRate) + 1` frames and fill each frame by linear
   interpolation of the plan at the mapped time. Inside a stop keep the
   release (`kind: 'release'`) at its planned length and stretch the closure.
   Clamp the stretch of one token to 0.33-3 times and list clamped tokens in
   `metrics.warnings`. Update `segments[].start` and `.end`.
5. Pitch. Take f0 from `trackPitch` ({{P47}}), resample to the frame rate.
   Octave check: a frame more than 9 semitones from the median of the voiced
   frames within ±100 ms is moved by one octave when that brings it within
   3 semitones, else it is marked as a gap. Median filter over 5 frames, fill
   gaps with `interpolateGaps`, smooth with `smoothChannel` (10 ms), write to
   `channels.f0`. Skip spans that the modes mark as whisper.
6. Loudness. Level `L(t)` = RMS in dB over 25 ms windows every 5 ms. Render a
   draft with the `waveguide` solver at 16 kHz. Multiply `channels.loudness`
   by `10 ** (0.8 * (L_recording - L_draft) / 20)`, factor clamped to 0.25-4,
   only where both levels are above −40 dB of their maximum. Do this twice.
   First add a test that doubling `loudness` raises a vowel by 6 ± 1 dB; if
   it does not, use the measured exponent instead of 20.
7. Modes. Copy the recognised spans to `plan.modes` ({{P38}}) unchanged.
8. Refinement, only with `refine: true`. Cost = `logSpectralDistance`
   ({{P06}}, dB) between the recording and a waveguide draft at 16 kHz,
   plus `4 * sum(offset ** 2)` so that gestures stay plausible. For each
   syllable: (a) blend the channels `height`, `backness`, `rounding` towards
   the trajectory of `invertArticulation` ({{P53}}) with weight 0, 0.5 or
   1, keep the best; (b) try offsets of ±0.05 on each of the three channels
   at the nucleus, keep a change that lowers the cost by 0.05 dB or more;
   two rounds. Stop after `refineBudget` renders. Cut utterances longer than
   5 s at pauses and refine each piece.
9. Render with `renderPlan` at the requested tier and seed. Pad or trim to
   the length of the input at the output sample rate.
10. Score (`score.js`). `toScore(plan, recognition, voice)` returns

    ```json
    {
      "format": "voice-simulator/score",
      "version": 1,
      "duration": 3.42,
      "voice": {},
      "words": [],
      "segments": [{ "ipa": "h", "start": 0.12, "end": 0.18 }],
      "f0": { "rate": 200, "values": [0, 118.2] },
      "loudness": { "rate": 200, "values": [0, 0.7] },
      "modes": []
    }
    ```

    `f0` is in Hz with 0 for unvoiced frames; `words` has the shape of
    `recognize`. `renderScore(score, options)` rebuilds the plan from a score
    (steps 3 to 7 with the score as the measurement) and renders it, so an
    edited IPA symbol, time or pitch value gives new audio.

11. Metrics. `metrics` = `compareRecordings(original, copy)` of {{P06}}
    plus `timingError` (mean absolute difference in ms between the syllable
    starts of the score and those found by recognising the copy).
12. CLI in `bin/voice-simulator.js`: command `copy <in> -o <out>` with the
    flags `--score <file>` (write the score), `--from-score <file>` (render
    a score, no input audio), `--voice <file>`, `--refine` and `--tier`.
    It prints the recognised text and the metrics (`--json` for JSON). Add
    the line "Copy only your own voice, a voice you have permission to copy,
    or a public-domain recording." to `--help` and to a README section
    "Copying a voice" that links to "Not goals" in `docs/VISION.md`.
13. Listening tests. Add two test definitions in the format of {{P08}}
    under `examples/listening-test/`: `copy-abx` (A = original, B = copy, X =
    one of them, 10 golden recordings) and `copy-similarity` (MUSHRA scale
    "same speaker?": hidden reference = another utterance of the speaker;
    the copy; the copy rendered with the default voice; another real
    speaker as low anchor). `scripts/make-copy-stimuli.mjs` writes the
    stimuli to `reports/copy-stimuli/`. Running them with people is {{P71}}.
14. Heavy suite `copy` and report `docs/reports/copy-synthesis.md` written by
    `scripts/copy-report.mjs`: one row per golden recording and tier
    (`medium` and the default tier) with every metric. Store thresholds in
    `tests/heavy/copy-thresholds.json`; set the cepstral distortion limit to
    the first measured mean times 1.05. Later pull requests may only lower
    the numbers in that file.

## Tests

`tests/copy.test.js` (fast, tier `minimal`, 16 kHz):

- `keeps measured durations`: `warpPlan` on the plan of `ˈmama` with every
  token made 1.5 times longer gives segments 1.5 times longer (±1 frame).
- `imposes the measured pitch`: a rising 100-150 Hz contour is found again
  in the copy by `f0Errors` with RMSE below 0.3 semitones.
- `repairs an octave jump`: 5 frames at double pitch are moved back.
- `round-trips a score`: `renderScore(toScore(...))` gives the same samples
  as the copy; raising every `f0` value by 2 semitones raises the measured
  median pitch by 2 ± 0.2 semitones.
- `copies a synthetic original`: "Hello world." rendered with preset
  `female`; phoneme error rate 0, f0 RMSE ≤ 0.3 semitones, `timingError`
  ≤ 10 ms.
- `cli copy writes audio and a score`: runs the command on a temporary WAV.

`tests/heavy/copy-golden.test.js` (suite `copy` of {{P02}}):

- `copies the golden set`: for every recording, f0 RMSE ≤ 1 semitone on
  frames voiced in both, voicing error ≤ 10 %, `timingError` ≤ 20 ms, mel
  cepstral distortion ≤ the value in `copy-thresholds.json`.
- `refinement helps`: with `refine: true` the mean log-spectral distance is
  lower than without it on at least 80 % of the recordings.

## Acceptance criteria

- [ ] `node bin/voice-simulator.js copy in.wav -o out.wav --score s.json`
      writes both files; `--from-score s.json` renders the same samples.
- [ ] `node --test tests/copy.test.js` passes on Node.js, Bun and Deno.
- [ ] Heavy suite `copy` passes with the thresholds above and
      `docs/reports/copy-synthesis.md` is committed with the measured
      numbers, the commit and the command.
- [ ] `copyRecording`, `renderScore` and `toScore` are exported and typed.
- [ ] The two listening-test definitions load in the harness of {{P08}}.
- [ ] The consent sentence is in `--help` and in the README.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Fitting the voice and recognising: {{P66}}. The app button "Repeat what I
  said": {{P68}}.
- Aligning a typed transcript instead of recognising.
- Running the listening tests with people and publishing results: {{P71}}.
- Mixing in any part of the recording. The output is simulated only.

## References

- Gao, Y., Stone, S., Birkholz, P. (2019). Articulatory copy synthesis based
  on a genetic algorithm. Interspeech.
  https://www.isca-archive.org/interspeech_2019/gao19e_interspeech.html
- Panchapagesan, S., Alwan, A. (2011). A study of acoustic-to-articulatory
  inversion of speech by analysis-by-synthesis using chain matrices and the
  Maeda articulatory model. JASA 129(4).
- Kubichek, R. (1993). Mel-cepstral distance measure for objective speech
  quality assessment. IEEE PacRim. https://doi.org/10.1109/pacrim.1993.407206
- Prom-on, S., Xu, Y., Thipakorn, B. (2009). Modeling tone and intonation in
  Mandarin and English as a process of target approximation. JASA 125(1).
  https://doi.org/10.1121/1.3037222
- Research notes: `docs/case-studies/issue-11/research/1-similar-projects.md`
  (section D) and `2-inversion-and-recognition.md` (sections 3.4, 7 and 8).
