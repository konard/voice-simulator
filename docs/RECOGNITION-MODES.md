# Recognizing manner of speech

`recognizeModes(samples, sampleRate, result, options)` is the synchronous,
standalone postprocessor for timed IPA words. It preserves unrelated result
fields and returns new `modes` and `ipa` values. The future text recognizer
(#73) can call it after producing words; `modes: false` bypasses analysis.
Samples must be finite, the sample rate at least 8000 Hz, and word times
ordered and contained in the audio. The default duration bound is 30 seconds;
`maxSeconds` changes it. No recording level is used to infer effort.

Word spans have `start` and `end` in seconds and `from` and `to` in word
indexes (`to` exclusive), followed by only the decided mode fields:

```js
{
  start: 0.4, end: 1.9, from: 1, to: 5,
  effort: 0.75, notation: 'f', confidence: 0.8
}
```

Emotion spans have `emotion: { arousal, name?, intensity? }` and
`notation: null`. Sound spans have `start`, `end`, `sound`, `notation` and
`confidence`, without word indexes. Confidence is bounded by 0 and 1.

```js
const heard = recognizeModes(
  samples,
  sampleRate,
  {
    language: 'en',
    ipa,
    words: [{ start: 0.1, end: 0.7, ipa: 'həˈloʊ' }],
  },
  { voice: 'male' }
);
const plan = planUtterance(heard.ipa, { modes: toPlanModes(heard.modes) });
```

For audio replay, pass the same spans to
`synthesize(heard.ipa, { ipa: true, modes: toPlanModes(heard.modes) })`.
Explicit spans replace modes parsed from IPA, preserving emotions and
partial phonation settings that have no label in the output string.
When unnamed activation overlaps effort, rate or phonation, the adapter
retains it with `emotion.realized: true` across its entire phrase, including
gaps in physical labels: those fields already account for its aggregate
acoustic evidence. The planner preserves this observation without
applying another emotional pitch, rate or effort change. A standalone
activation span and named emotions retain their synthesis effects.

Use the same head configuration as synthesis for a known voice. Voice files
and loaded voices are accepted too. The neutral sentence for each language
is mirrored in `tests/fixtures/recognition/baseline.txt`; references are
rendered with seed 1 at the tier matching the sample rate. The voice cache
holds at most eight entries. A separate cache holds sixteen neutral phone
contexts, without retaining samples. These contexts cancel vowel identity,
lexical stress and lexical tone before applying the rules. Timed phones,
when supplied as `phonemes`, select vowel frames directly; otherwise the
neutral phone durations are fitted to each observed word interval. Syllabic
consonants count as nuclei too. Weak pitch fallback requires harmonic
support across the nucleus, so isolated noise peaks do not imply falsetto.

The feature extractor uses alpha ratio, pitch, matched-vowel F1,
formant-corrected source H1-H2, HNR, CPP, jitter, voicing and neighbouring
syllable rate. The analytical effort inverse and confidence follow issue 71. The positive effort decision additionally checks the independent
5 Hz/dB cue because rising LF pitch itself changes the measured tilt.
Word effort decisions require confidence of at least 0.5 and a pitch
displacement of at least 12.5 Hz; the analytical estimate is retained.
For known voices, creak degree uses the source model's 12-semitone shift
at full degree rather than noisy short-word jitter alone.
Ordered phonation thresholds are calibrated against the minimal-tier
synthesizer; they are initial rules, not a general speaker classifier.
Short phrases with fewer than three vowels abstain from effort, phonation
and emotion names. One-word holes are filled, spans are joined, and spans
under 0.3 seconds are omitted except whisper. Four-word effort runs support
linear crescendo/diminuendo detection.

Without a voice, utterance medians provide the baseline. Constant effort
is left undecided; absolute whisper, creak and falsetto cues remain usable.
Phrase pitch span uses the 95th minus 5th percentile across all its vowel
frames, including intonation between words. Emotion activation uses the
first four scaled prosodic components; names
require both Euclidean margins against twelve synthesized emotion references.
Fifteen cached physical-mode references compete as unnamed alternatives:
creak, pressed voice or tempo alone must not command an emotion preset
whose extra effects would change the replay. These references use the
same acoustic vectors and never emit emotion names.
A named emotion removes redundant effects of its own preset before replay.
Nonverbal pause sounds are conservative acoustic hypotheses.

An optional `trace(event)` callback exposes baselines, word features,
phrase vectors and decisions for diagnosis. It is off by default. All
analysis is signal processing and physical synthesis, without downloaded
models. The numerical word rules and phrase vector also have a Rust port;
WebAssembly parity checks use a tolerance of 1e-10.

Acceptance measurements and real-recording limitations are recorded in
[the report](reports/recognition-modes.md). RESD is downloaded only at test
time under its MIT metadata licence; no RESD audio is redistributed.
