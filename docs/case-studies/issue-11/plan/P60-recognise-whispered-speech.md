---
id: P60
title: Recognise whispered speech
type: Feature
milestone: M4
blocked_by: [P54, P41]
requirements: [R6, R13, R17, R18, R19]
---

## Goal

`recognize` returns the words of whispered speech. It finds by itself which
stretches of a recording are whispered, decodes their sounds without pitch
and without voicing, and tells voiced from voiceless consonants and the
Mandarin tones as well as the remaining cues allow. Error limits for whisper
are looser than for normal voice, and they are written down honestly.

## Why

The issue names whisper as a mode of speech for input as well as output. A
whisper has no vibration of the vocal folds, so everything in recognition
that leans on pitch or voicing fails: `b` against `p`, tones, the pitch part
of stress and of questions. {{P41}} makes the synthesiser whisper; this
issue is the reverse direction.

## Current state

- There is no whisper today, in either direction. After {{P41}} the
  synthesiser whispers `[whisper] ...` and `{W … W}`: noise from the open
  glottis instead of pulses, F1 about 255 Hz higher, durations 1.3 times
  longer, level about 25 dB lower. Voiced and voiceless consonants keep
  their differences in duration, burst and noise level, and the noise level
  follows the intended pitch by 0.7 dB per semitone (limited to ± 6 dB).
- After {{P47}}, `trackPitch` reports `f0` 0 for every frame of a whisper.
  {{P58}} then returns `tones: null` for those syllables.
- After {{P54}}, `audioToIpa` decodes sounds by comparing the recording with
  what the synthesiser would produce ({{P52}}, {{P53}}), with a voiced
  source.
- Numbers from the research notes (file 4): two measures (energy above
  2.5 kHz against energy below 1 kHz, and no periodicity) found whispered
  stretches 97.5 % right in speech sampled at 8 kHz (Carlin et al. 2006).
  People name the tone of whispered Mandarin syllables 49.9 % right against
  96.4 % in normal voice, chance being 25 %; tone 3 is heard 84.5 % and
  tone 4 60.2 % right, tones 1 and 2 near chance. Tone 3 is the longest and
  its loudness has two humps; tone 4 is short and its loudness drops early
  (Jiao and Xu 2019).
- No whispered recordings exist with a licence that the gate of {{P04}}
  accepts (research notes, file 3: the known sets are non-commercial).

## What to do

1. Find the whisper. Create `src/recognition/whisper.js` exporting
   `findWhisper(samples, sampleRate, frames, pitch)` (`frames` from
   `analyzeFrames`, `pitch` from `trackPitch`). It returns
   `[{ start, end, confidence }]` in seconds.
   1. Cut the recording into stretches of speech: runs of frames with
      `frames.speech` 1, joined over gaps shorter than 0.2 s.
   2. For each stretch of 0.3 s or more compute: `voiced` = share of its
      frames with `pitch.f0 > 0`; `ratio` = level above 2500 Hz minus level
      below 1000 Hz in dB (`energyRatio` of `src/analysis/mode-features.js`
      on the samples of the stretch); `vowelLike` = longest run, in
      seconds, of frames with `frames.gravity < 2500`.
   3. The stretch is whispered when `voiced < 0.05`, `ratio >= -12` and
      `vowelLike >= 0.05`. (Normal voice has `ratio` far below; a stretch of
      only `s` or `ʃ` has no vowel-like run.) `-12` is a start value: set it
      halfway between the medians measured on synthetic voiced and
      whispered speech and write both medians in the code comment.
   4. `confidence = a * b` with `a = clamp(1 - voiced / 0.05, 0, 1)` and
      `b = clamp((ratio + 18) / 12, 0, 1)`.
   5. Stretches shorter than 0.3 s take the answer of the nearer neighbour
      within 0.5 s, else they are not whispered.
2. Decode whispered stretches. Add the option `whisper` to `audioToIpa`:
   `'auto'` (default: call `findWhisper`), `false`, or a list of spans.
   Inside a whispered span:
   1. Compare with whispered references. Wherever {{P52}} and {{P53}}
      render a sound to compare it with the recording, render it with the
      plan channel `whisper` = 1 of {{P41}}. Keep these references in a
      second table that is built on the first whispered span, not at start.
   2. Smooth the spectrum: noise makes single frames random. Before any
      spectral comparison and before `trackFormants`, average the power
      spectrum (or the autocorrelation) over 5 frames: the frame, two
      before, two after.
   3. Ignore the pitch and voicing terms of every cost. Do not treat
      "unvoiced" as evidence for a voiceless sound.
3. Voiced or voiceless. Every plosive, affricate and fricative decoded in a
   whispered span gets two new fields: `whispered: true` and `voicing`, a
   number from 0 (voiceless) to 1 (voiced).
   1. Create `scripts/build-whisper-cues.mjs`. For every pair of the
      inventory that differs only in voicing (`p b`, `t d`, `k ɡ`, `f v`,
      `s z`, `ʃ ʒ`, `t͡ʃ d͡ʒ` and the others that
      `listSymbols()` gives), for the vowels `a i u` and the presets `male`
      and `female`, synthesise `{W aCa W}` at tier `minimal`, seed 1, and
      measure for `C`: `duration` divided by the duration of the first
      vowel, and `level` of the consonant minus the level of that vowel
      (dB). Write per pair the mean and the standard deviation of both
      measures for each member to `src/recognition/data/whisper-cues.js`
      (constant `WHISPER_CUES`, under 10 kB). Commit the file.
   2. At run time measure the same two numbers for the decoded sound.
      `zv` and `zu` are the distances to the voiced and the voiceless
      means in standard deviations (root of the sum of two squares).
      `voicing = 1 / (1 + exp(zv - zu))`.
   3. Write the sound of the pair that `voicing` favours into `ipa`.
   4. In `ipaToText` ({{P56}}), for a sound with `whispered: true`, the
      voicing part of the sound distance is `0.25 * |v - voicing|`, where
      `v` is 1 for a voiced candidate and 0 for a voiceless one. So the
      word list and the neighbouring words decide when the cues do not. If
      `ipa-to-text.js` is not in the code base, say so on the issue of
      {{P56}}.
4. Mandarin tones. Export `whisperTones(frames, syllable)`. It returns the
   same `tones` object as `measureProsody` of {{P58}} (cost 0 to 1 per
   tone letter):
   1. Take `frames.energy` from the start of the vowel to the end of the
      syllable, resample to 10 points, subtract the mean.
   2. For each tone take the pitch curve of the tone model ({{P37}}) in
      semitones, multiply by 0.7 (dB per semitone), subtract its mean.
      `shape` = root mean square difference in dB, divided by 4, cut at 1.
   3. `length` = syllable duration divided by the mean syllable duration
      of the utterance. Expected: tone 3 `1.15`, tones 1 and 2 `1.0`,
      tone 4 `0.9`, neutral `0.6` (start values; replace them by the
      values measured on the synthesiser).
      `dur = min(1, 2 * |length - expected|)`.
   4. `raw = 0.6 * shape + 0.4 * dur`; `cost = 0.25 + 0.5 * raw`. The
      squeeze toward 0.5 tells `ipaToText` that these costs are weak.
   5. If `src/recognition/prosody.js` exists, `measureProsody` calls
      `whisperTones` for syllables inside whispered spans instead of
      returning `null`, drops the pitch term of `prominence` and divides
      the rest by 0.8; `markProsody` uses only the word rules there
      (question word, `吗`, `क्या`). If the file does not exist, {{P58}}
      adds the calls.
5. Result. The words of a whispered span are inside `{W … W}` in `ipa`,
   and `modes` holds one span with `phonation: { whisper: 1 }`,
   `notation: 'W'` and the keys `start`, `end`, `from`, `to` and
   `confidence` of {{P58}}. If `src/recognition/modes.js`
   ({{P59}}) exists, let it write the span from `findWhisper`; otherwise
   write it here.
6. Streams (`createRecognizer`): decide whisper at every pause, or after
   0.5 s of speech; sounds are not committed before that decision.
7. In `tests/heavy/roundtrip-*.test.js` of {{P63}}, if merged, add the set
   `whisper`: sentences 1 to 10 of each language with `[whisper]`, at the
   tiers of the set `main`, with the gates of the acceptance criteria.
8. Add a section "Whispered speech" to `README.md` with the measured error
   rates and the sentence that tones and voicing are partly guessed from
   the words.

## Tests

`tests/recognition-whisper.test.js`. Audio from `synthesize` at tier
`minimal`, seed 1, preset `male`, markup on. PER is the phone error rate of
`errorRate(reference, heard, 'phone')` ({{P06}}) without stress and tone
marks.

- `finds a whisper`: 8 whispered sentences give one span over the whole
  speech; the same 8 in normal voice give none.
- `finds where the whisper starts`: `one two three [whisper] four five six`:
  the span starts within 0.1 s of the start of `four`.
- `is not fooled by noise or hissing`: 1 s of seeded white noise at -30 dB,
  and the word `sss`: no span.
- `finds a whisper at 8 kHz and in noise`: the 8 sentences resampled to
  8000 Hz, and with white noise 20 dB below the speech: all found.
- `decodes whispered sounds`: 3 sentences per language: PER at most 15 %;
  PER when a voiced and a voiceless member of a pair count as equal: at
  most 8 %.
- `tells b from p`: all `aCa` of step 3.1 with the vowel `a`, preset
  `female`: `voicing` is on the right side of 0.5 in at least 75 %. Print
  the score per pair.
- `lets the words decide`: whispered `a big dog` returns `a big dog` (not
  `a pick tock`).
- `guesses whispered tones`: `妈 麻 马 骂`, preset `male` and `female`: the
  cheapest tone is right in at least 5 of 8. Ten whispered Mandarin
  sentences through `ipaToText`: at least 75 % of the syllables have the
  right tone.
- `marks the result`: `ipa` starts with `{W` and `modes[0].notation` is
  `W`.
- `cue table is current`: running the script of step 3.1 in memory gives
  the committed `WHISPER_CUES` (skipped unless `HEAVY=1`).

## Acceptance criteria

- [ ] `npm test` runs `tests/recognition-whisper.test.js` and every
      threshold above holds on Node.js, Bun and Deno.
- [ ] Round trip, set `whisper`, when {{P63}} is merged (otherwise that
      issue adds the set and this gate): PER at most 15 % and word error
      rate at most 25 % at `wideband` and above; 25 % and 35 % at
      `telephone`; Mandarin tone errors at most 25 % (30 % at `telephone`).
      After the first run, set each gate to the measured value plus 2
      points if that is lower.
- [ ] On the golden set of {{P05}} (real voiced speech; skip with a
      message if it is not merged), `findWhisper` returns no span for at
      least 23 of 24 recordings.
- [ ] `voice-simulator say "[whisper] hello world" -o w.wav` then
      `voice-simulator recognize w.wav` prints `hello world` (compare
      after lower-casing and removing punctuation).
- [ ] The pull request states that whispered real recordings were not
      measured, because no data set with an accepted licence exists, and
      gives the result of at least 3 whispered sentences recorded by hand
      in the app of {{P62}} (if merged).
- [ ] `grep -rn "onnx\|tensorflow\|torch" src/recognition package.json` prints
      nothing.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Making whisper: {{P41}}. Soft and stage whisper as separate labels, and
  whispery voice (`{Ṿ … Ṿ}`): {{P59}}.
- Question or statement from the melody of a whisper: only word rules are
  used.
- Turning a whisper into normal voice: {{P67}} can speak the recognised
  text with any voice.
- A benchmark on real whispered recordings (no usable data set).

## References

- Research notes, section on whisper and the table of recognition cues:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
- Carlin, M. A., Smolenski, B. Y., Wenndt, S. J. (2006). Unsupervised
  detection of whispered speech in the presence of normal phonation.
  Interspeech 2006.
  https://www.isca-archive.org/interspeech_2006/carlin06_interspeech.pdf
- Jiao, L., Xu, Y. (2019). Whispered Mandarin has no production-enhanced
  cues for tone and intonation (accepted manuscript).
  https://discovery.ucl.ac.uk/id/eprint/10042331/7/Whispered%20Tones%20Revisited_accepted.pdf
- Swerdlin, Y., Smith, J., Wolfe, J. (2010). The effect of whisper and
  creak vocal mechanisms on vocal tract resonances. Journal of the
  Acoustical Society of America.
  https://www.phys.unsw.edu.au/jw/reprints/whisper.pdf
