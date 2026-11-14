---
id: P66
title: Multi-pass voice session: fit, invert, stabilise, keep recognising
type: Feature
milestone: M5
blocked_by: [P51, P61]
requirements: [R9, R8, R12]
---

## Goal

Add `createVoiceSession(options)`. While a person keeps speaking, the session
fits their voice (pass 1), recognises their phonemes with that voice (pass 2),
uses the phonemes to fit the voice better (pass 3) and repeats until nothing
changes. From then on it holds two products, a voice to speak with and a
recogniser tuned to the speaker, and keeps recognising with a short delay.

## Why

The vision ("Copying a voice") asks for passes that feed each other. A voice
fitted without knowing what was said is rough: the same average formants can
come from a short tract saying back vowels or a long tract saying front
vowels. Knowing the phonemes removes that ambiguity, and a better voice in
turn gives better phonemes. Speaker-adaptive recognisers alternate in the same
way between speaker and speech (Anastasakos et al. 1996).

## Current state

- `matchVoice(samples, sampleRate, options)` in `src/analysis/voice-match.js`
  is the only voice fit. It needs the whole recording at once, makes one pass
  and fits six parameters (`pitch`, `pitchRange`, `vocalTractLength`,
  `tenseness`, `breathiness`, `speechRate`) from whole-recording averages
  measured by `analyzeVoice`. It never finds out what was said: it renders
  `options.transcript`, or the fixed sentence `MATCH_TEXT` when none is typed.
- Accuracy, from `tests/voice-match.test.js` (synthetic input only): with a
  typed transcript pitch, tract length and rate are within 10 %; without one
  the test only checks that a male voice is told from a female one. The
  issue 5 case study reports 10-15 % without a transcript.
- There is no streaming input, no recogniser and no folder `src/session/`.
  Check: `ls src/session` fails and `grep -rn createVoiceSession src` prints
  nothing.

{{P51}} replaces the fit by `fitVoice` (more parameters, real speakers) and
{{P61}} adds `createRecognizer`. Both still run once; nothing joins them.

## What to do

Create `src/session/voice-session.js` (split into more files under
`src/session/` to stay below the 1500-line limit) and export from
`src/index.js` and `src/index.d.ts`.

1. `createVoiceSession(options)` returns a session. Options and defaults:
   `sampleRate` (Hz, required), `languages` (`['en', 'ru', 'hi', 'zh']`),
   `preset` (`'auto'`), `voice` (none; a voice to start from, which skips
   `fitting`), `minVoiced` (2 s), `window` (20 s of audio kept),
   `tolerance` (0.02), `stablePasses` (2), `maxIterations` (8),
   `halfLife` (30 s), `driftFactor` (1.5), `realtime` (`false`),
   `backgroundShare` (0.25), `level` (`'auto'`; passed to `createRecognizer`
   unchanged).
2. Methods: `push(chunk)` (a `Float32Array` of mono samples at `sampleRate`),
   `flush()` (end of input: finish all queued work), `reset()`,
   `speak(text, synthesisOptions)` (calls `synthesize` with `session.voice`;
   throws `'No voice yet'` before the first `voice` event) and the same
   subscribe method as `createRecognizer` of {{P61}} (written
   `session.on(type, listener)` below).
3. Properties: `state`, `voice`, `uncertainty`, `recognizer`, `converged`,
   `history` (one entry per pass: `{pass, state, distance, changes, ipa}`),
   `load` (CPU seconds used per second of audio over the last 2 s) and
   `backgroundShare` (may be assigned at any time; 0 pauses the fits).
   `voice` is a voice file object of {{P29}} when `saveVoice` exists in the
   code base, otherwise a head configuration as `matchVoice` returns.
4. Events: `state` `{state, previous, reason, time}`; `voice`
   `{voice, uncertainty, pass, distance, converged}`; `partial`, `final` and
   `syllable` are the events of the session's recogniser passed on unchanged.
   A `final` result has the `recognize` shape with `voice` filled in.
5. State machine. `time` is audio time in seconds; "voiced" is counted from
   the voiced flags of `trackPitch` ({{P47}}).

   | State        | Work in this state                                         | Leaves to                                                                                                                                       |
   | ------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
   | `collecting` | Buffer audio. Recognise with the default voice             | `fitting` (`inverting` when `options.voice` is set) once voiced time since the last reset reaches `minVoiced`                                   |
   | `fitting`    | Pass 1: `fitVoice` on the buffered voiced frames           | `inverting` on success; `collecting` with `minVoiced` raised by 1 s (at most 10 s) when it throws                                               |
   | `inverting`  | Pass 2: recognise the buffer with the fitted voice         | `refining` when the result has at least 10 phonemes with confidence 0.5 or more, 3 different vowels among them; otherwise repeat after 1 s more |
   | `refining`   | Pass 3 and later: step 6, then recognise the buffer again  | `stable` when step 7 holds; pause after `maxIterations` passes until 5 s more voiced speech arrived, then count from 0 again                    |
   | `stable`     | Recognise live with the adapted recogniser; track (step 8) | `refining` on drift; `collecting` on a change of speaker (step 8)                                                                               |

   Every transition emits `state`. `fitting`, `inverting` and each `refining`
   pass emit `voice`.

6. One `refining` pass re-fits the voice from the recognised phonemes. Use
   only segments with confidence 0.6 or more and a length of 60 ms or more;
   measure in the middle half of each segment.
   - Vocal tract length: for each vowel token take F1 to F3 from
     `trackFormants`; divide the formants the simulator gives for that vowel
     at the current length (render each vowel of the inventory once per pass
     with the `waveguide` solver, or read the codebook of {{P52}}) by the
     measured ones; average the three ratios. New length = current length
     times the median ratio over all tokens.
   - Source: run the source part of `fitVoice` on the frames of stressed
     vowels only (`syllables[].stress >= 1`).
   - Pitch: `pitch` from the median f0 of vowel frames, `pitchRange` from
     their 5th to 95th percentile in semitones. Drop frames that are more
     than 9 semitones from the running median (octave errors).
   - Rate: plan the recognised IPA with the current voice (`planUtterance`);
     new `speechRate` = current times the median of planned over measured
     segment duration.
   - Articulation habits: for every vowel phoneme with 3 or more tokens, the
     mean of (inverted position at the token middle from `invertArticulation`
     of {{P53}}, minus the planned target) for the channels `height`,
     `backness` and `rounding`, clamped to ±0.15. Store as
     `voice.articulationOffsets[ipa] = {height, backness, rounding}` and
     make `planUtterance` add the offsets to the targets of that phoneme
     (default: no offsets, output unchanged).
   - Step control: compute `distance` (the fit error `fitVoice` reports) for
     the new voice. If it is larger than before, move every parameter half
     way back and try again, at most 3 times; if it is still larger, keep the
     old voice. `distance` therefore never rises between passes.
7. Convergence. `changes[name]` = |new − old| divided by (`max` − `min`) of
   the parameter in `HEAD_PARAMETERS` (several parameters can be 0, so the
   change is taken against the range). The session is `stable` when, for
   `stablePasses` passes in a row, every `changes[name]` is below `tolerance`
   and the recognised phoneme string of the buffer has edit distance 0 to the
   one of the pass before. Set `converged = true`.
8. Tracking in `stable`. Keep running statistics with exponential forgetting
   (weight halves every `halfLife` seconds of voiced speech). Apply updated
   parameters only at a pause of 200 ms or more, never inside an utterance
   (the rule of Kaldi's online decoder). Drift: the mean `distance` of the
   last 5 s exceeds `driftFactor` times the value at the moment of becoming
   stable → `refining`, reason `'drift'`. Speaker change: over the last 3 s
   of voiced speech the median f0 is more than 4 semitones from `voice.pitch`
   or the tract length estimate differs by more than 8 % → clear all
   statistics, `collecting`, reason `'speaker-change'`; the recogniser uses
   the default voice until the next `fitting`.
9. Uncertainty. `uncertainty[name]` is one standard error in the unit of the
   parameter, by a jackknife over 4 folds (token index modulo 4): refit with
   one fold left out, `sqrt(3 / 4 * sum((x_i - mean) ** 2))`. Compute it on
   entering `stable` and after every later change of the voice.
10. Scheduling. Write fits as generators (as `matchVoiceSteps` already is)
    so they can be cut into slices of at most 10 ms. Recognition always runs
    first. With `realtime: false` (default) `push` runs all due work before
    it returns: same chunks and options give the same events in the same
    order on every runtime. With `realtime: true` background slices are
    scheduled with `options.schedule` (default `setTimeout(fn, 0)`) and use
    at most `backgroundShare` of one core over the last 2 s, 0.05 when
    recognition itself needs more than 0.8 of real time; a pass that is
    overtaken by a newer one is dropped. No threads are required.
11. `copyVoice(samples, sampleRate, options)` in the same folder: one session
    with `realtime: false`, `window` = the whole recording, `maxIterations`
    12; push everything, `flush()`, return
    `{voice, uncertainty, recognition, passes, converged, history}`.
12. Document the session in `README.md` and `docs/ARCHITECTURE.md` if it
    exists, with the state diagram.

## Tests

`tests/voice-session.test.js` (fast; tier `minimal`, 16 kHz, `seed: 1`,
English text of about 6 s):

- `walks through the states in order`: the `state` events are `collecting`,
  `fitting`, `inverting`, `refining` (one or more), `stable`.
- `is deterministic`: two sessions fed the same chunks give deeply equal
  event lists; chunk sizes 160 and 4096 samples give the same final voice.
- `never raises the distance`: for every pass `i` after the first,
  `history[i].distance <= history[i - 1].distance`.
- `speaks with the copied voice`: `speak('Hello.')` returns samples; before
  any speech it throws `'No voice yet'`.

`tests/heavy/copy-voice-session.test.js` (suite `copy` of {{P02}}; four
synthetic speakers: presets `male`, `female`, `child`, and `male` with
`vocalTractLength` 17.8, `pitch` 100, `speechRate` 0.85; 20 s of text each,
no transcript given):

- `recovers known parameters`: `vocalTractLength` within 3 %, `pitch` within
  2 %, `speechRate` within 5 %, and the true value inside ±3 `uncertainty`.
- `notices another speaker`: 12 s of `male` then 12 s of `female`; a `state`
  event with reason `'speaker-change'` comes within 4 s of the change and the
  second `stable` voice has `pitch` within 3 % and length within 5 %.
- `improves on the golden set`: for every recording of the golden set
  ({{P05}}) the last `distance` of `copyVoice` is at most 0.9 times the
  first and the list never rises.
- `fits one core`: the 20 s session with `realtime: true` at tier `telephone`
  finishes with total CPU time below 20 s when that tier exists ({{P14}}).

## Acceptance criteria

- [ ] `createVoiceSession` and `copyVoice` are exported and typed in
      `src/index.d.ts`.
- [ ] `node --test tests/voice-session.test.js` passes on Node.js, Bun and
      Deno in under 30 s.
- [ ] `npm run test:heavy -- --suite copy` passes the four heavy tests with
      the thresholds above. A threshold may be changed only when the pull
      request shows the measured numbers, and never above 5 % (half of
      today's 10 % with a typed transcript).
- [ ] The pull request reports, per synthetic speaker, the error of each
      parameter after pass 1 and after the last pass, and the number of
      passes.
- [ ] `planUtterance` output is byte-identical to before when no
      `articulationOffsets` are given.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Reproducing a recording with its timing and melody: {{P67}}.
- The app panel: {{P68}}. Certification at 8 kHz on one core: {{P69}}.
- Several speakers talking at the same time, and noise or music in the
  background. Clean close speech of one person at a time is the supported
  input.
- New voice parameters: {{P29}}. New trackers: {{P47}} to {{P50}}.

## References

- Anastasakos, T., McDonough, J., Schwartz, R., Makhoul, J. (1996). A compact
  model for speaker-adaptive training. ICSLP.
  https://doi.org/10.21437/icslp.1996-253
- Lee, L., Rose, R. (1998). A frequency warping approach to speaker
  normalization. IEEE Trans. Speech and Audio Processing 6(1), 49-60.
  https://doi.org/10.1109/89.650310
- Kaldi online decoding (speaker transform estimated after 2 s and
  re-estimated at growing intervals):
  https://kaldi-asr.org/doc/online_decoding.html
- Fitch, W. T. (1997). Vocal tract length and formant frequency dispersion.
  JASA 102(2). https://doi.org/10.1121/1.421048
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`
  (sections 4.2, 6 and 9).
