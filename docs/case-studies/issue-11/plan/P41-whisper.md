---
id: P41
title: Whisper
type: Feature
milestone: M3
blocked_by: [P38, P23]
requirements: [R17, R7, R18]
---

## Goal

Make `mode.phonation.whisper` of {{P38}} produce whispered speech: no
vibration of the vocal folds, a noise source at a half-open glottis, raised
formants, longer and quieter sounds, with the difference between voiced and
voiceless consonants still audible. Voiceless vowels in IPA (`ḁ`) use the
same source.

## Why

Whisper is a mode every speaker uses, and it is the hardest test for a
physical model: all cues must come from the tract, because there is no pitch.
Recognition of whispered speech ({{P60}}) needs synthetic whisper with known
labels to be developed and tested.

## Current state

There is no whisper. The source in `src/acoustics/glottis.js` always
multiplies its noise by the voicing-dependent term, and a segment without
voicing and without aspiration is silent:

```js
const breath =
  (control.aspiration + this.breathiness * voicing * 0.35) *
  (1 - control.closure);
return voiced + noise * breath * modulation * loudness * 0.45 * …;
```

Measured with `node experiments/issue-11-audit-m3b.mjs`:

```
voiceless ˈama:   levelDb -16.2
voiceless ˈḁm̥ḁ:  levelDb -120      (voiceless vowels are silent)
markup [whisper]Hello[/whisper] world.: "( ˈwɪspɚ ) həˈloʊ ( ˈwɪspɚ ) ˈwɝld ."
breathiness 1 aspirationLevel 3 chink 10: hnr 13.15 voicedShare 0.88
```

The strongest breathy setting a voice file allows is still 88 % voiced.
The aspiration noise is white noise through one band-pass filter
(`this.aspiration.bandpass(800, 0.5, rate)` in `src/acoustics/voice.js`) and
`head.glottalChink` stops at 10 mm². The glottal end of the tract reflects
with the constant `GLOTTAL_REFLECTION = 0.75`. After {{P38}} the mode is
carried in `plan.modes` but not heard.

## What to do

Numbers from the literature that fix the targets (whisper against normal
voice):

| Quantity                   | Value                             | Source               |
| -------------------------- | --------------------------------- | -------------------- |
| glottal area               | 40 ± 30 mm²                       | Swerdlin et al. 2010 |
| first tract resonance R1   | +255 ± 90 Hz                      | Swerdlin et al. 2010 |
| R2, R3                     | +115 ± 105 Hz, +125 ± 125 Hz      | Swerdlin et al. 2010 |
| F1, F2, F3 (Mandarin)      | 779/1821/3106 vs 511/1525/2760 Hz | Jiao & Xu 2019       |
| duration                   | × 1.32                            | Jiao & Xu 2019       |
| level                      | 41.1 vs 66.0 dB (about -25 dB)    | Jiao & Xu 2019       |
| spectral centre of gravity | 1229 vs 548 Hz                    | Jiao & Xu 2019       |
| tone identification        | 49.9 % vs 96.4 %                  | Jiao & Xu 2019       |

1. Add the plan channel `whisper` (0…1, default 0, time constant 0.03 s) in
   `src/articulation/plan.js`. Fill it from `mode.phonation.whisper` of the
   span, and with 1 for a segment whose token has `whispered: true` (dot
   below, U+0323) or is a vowel or sonorant with `voiced: false` (ring
   below, U+0325). Pass it to the source through `glottis: { … }` in
   `src/articulation/tract-shape.js`.

2. Source, in `Glottis.step()`:
   - voiced part × `(1 - whisper)`; at `whisper` 1 no pulse is produced and
     the pulse phase does not advance;
   - add whisper noise wherever the plan asks for voicing:
     `whisperDrive = whisper * control.voicing * (1 - control.closure)`;
   - the noise comes from the glottal turbulence source of {{P23}} with a
     glottal area `WHISPER_AREA = 40` mm² and the lung pressure of the
     current effort. It is not modulated by the pulse. Do not reuse the
     800 Hz band-pass: the spectrum of the noise must come from the {{P23}}
     model, and the formants from the tract.
   - values between 0 and 1 give whispery voice (`{Ṿ … Ṿ}`): pulses and
     noise together.

3. Open glottis and formants. With an open glottis the tract is no longer
   closed at its lower end, which raises the resonances, the first one
   most. Make the reflection at the glottis depend on the channel:
   `reflection = GLOTTAL_REFLECTION * (1 - WHISPER_OPENING * whisper)` with
   start value `WHISPER_OPENING = 0.6`. Tune it until F1 of `a`, `i` and `u`
   rises by 255 ± 90 Hz on average at tier `high`. If {{P22}} is merged, set
   its glottal area to `WHISPER_AREA` instead and remove this constant.

4. Durations: multiply all segment durations inside a whisper span by
   `1 + 0.3 * whisper` in `buildSegments()`.

5. Level. At `effort` 0.5 the whispered vowel is 25 dB below the same vowel
   voiced. Effort inside whisper keeps its meaning but is weaker (project
   choice): -30 dB at effort 0.25 (soft whisper), -25 dB at 0.5, -20 dB at
   0.75 and above (stage whisper). Stage whisper also narrows the glottis
   to 20 mm² (project choice). Effort does not change pitch in whisper.
   `<vs:effort level="whisper">` equals `[whisper]`.

6. Voiced against voiceless consonants. In whisper nothing vibrates, so keep
   the other cues and do not touch them: voiced stops keep their shorter
   closure and weak burst, voiceless ones the longer closure, stronger
   burst and aspiration; voiced fricatives keep their shorter and weaker
   noise. Multiply `whisperDrive` by 0.5 inside the closure of a voiced
   stop, so that a weak murmur stays where voicing was.

7. Intended pitch. `channels.f0` is still computed. Whispered speech has no
   proven cue for tone (Jiao & Xu 2019), so add only a small level cue
   (project choice): whisper noise gain `+0.7` dB per semitone of
   `channels.f0` above the speaker's `head.pitch`, limited to ± 6 dB.

8. Tiers without a tract (`minimal` and any tier without the waveguide) use
   the same channel: the source is replaced by noise before the formant
   filters and F1 is raised by 255 Hz directly.

9. Add to `src/analysis/mode-features.js` (create it if it does not exist):
   `voicedShare(samples, sampleRate)` (share of 30 ms frames in which
   `yinPitch()` reports aperiodicity below 0.2),
   `energyRatio(samples, sampleRate)` (level above 2.5 kHz minus level below
   1 kHz, in dB) and `centreOfGravity(samples, sampleRate)` (Hz).

How the mode is written and recognised:

| Text / SSML                                  | IPA         | Correlates {{P59}}, {{P60}} can measure  |
| -------------------------------------------- | ----------- | ---------------------------------------- |
| `[whisper]`, `<vs:phonation name="whisper">` | `{W … W}`   | voiced share < 0.05, energy ratio + 6 dB |
| soft whisper: `[whisper][soft]`              | `{1W … 1W}` | the same, level -30 dB                   |
| stage whisper: `[whisper][loud]`             | `{3W … 3W}` | the same, level -20 dB                   |
| `<vs:phonation name="whispery">`             | `{Ṿ … Ṿ}`   | voiced, HNR below 10 dB                  |
| one segment                                  | `ạ`, `ḁ`    | no periodicity inside the segment        |

## Tests

Create `tests/whisper.test.js`. Render `Please call Stella.` with tier
`medium`, `seed: 1`, `headroom: 20`, plain and inside `[whisper]`
(`markup: true`).

- `has no voicing`: `voicedShare` below 0.05 (plain: above 0.8).
- `has no periodicity`: `yinPitch()` gives aperiodicity above 0.4 in at
  least 95 % of the frames with signal.
- `is noisy`: `hnr` of `analyzeVoice()` below 5 dB (plain: 14.7 dB).
- `is quieter`: level -25 ± 4 dB against plain; `[whisper][soft]` is 5 ± 2 dB
  below and `[whisper][loud]` 5 ± 2 dB above `[whisper]`.
- `keeps the formants and raises F1`: for `{W ˈa W}`, `{W ˈi W}`, `{W ˈu W}`
  (IPA input, tier `high`) `estimateFormants()` finds F1 and F2, and F1 is
  100 to 400 Hz above the voiced vowel; F2 of `i` stays above 1800 Hz.
- `moves energy upwards`: `energyRatio` at least 6 dB above plain and
  `centreOfGravity` at least 1.6 × plain.
- `is slower`: `plan.duration` is 1.3 ± 0.05 × plain.
- `keeps voiced and voiceless stops apart`: in `{W ˈapa W}` the closure is
  at least 20 ms longer and the burst peak at least 3 dB higher than in
  `{W ˈaba W}`.
- `keeps voiced and voiceless fricatives apart`: the fricative of
  `{W ˈasa W}` is at least 20 ms longer and 3 dB stronger than that of
  `{W ˈaza W}`.
- `whispers voiceless vowels`: `ˈhḁ` has a level above -45 dB in the vowel
  (today -120 dB) and `voicedShare` 0.
- `mixes for whispery voice`: `{Ṿ ˈama Ṿ}` has `voicedShare` above 0.5 and
  `hnr` at least 4 dB below `ˈama`.
- `is the same from text and IPA`: `[whisper]ma[/whisper]` and `{W ma W}`
  give equal `plan.channels.whisper`.

## Acceptance criteria

- [ ] All thresholds of `tests/whisper.test.js` hold on Node.js, Bun and
      Deno.
- [ ] `voice-simulator say --markup "[whisper]Hello.[/whisper]" --out w.wav`
      writes a file with `voicedShare` below 0.05.
- [ ] Text without whisper gives the same samples as before this change.
- [ ] The whisper works in English, Russian, Hindi and Mandarin: one
      sentence per language passes `has no voicing`.
- [ ] `docs/markup.md` describes whisper, soft whisper, stage whisper and
      whispery voice with the table above.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- The turbulence model itself: {{P23}}.
- Breathy voice and whispery voice as voice qualities of a whole voice:
  {{P42}}.
- Recognising whisper and whispered words: {{P59}}, {{P60}}.
- Extra cues for tones in whispered Mandarin: none are proven; the reported
  identification rate is 49.9 %.
- The Rust version: {{P70}}.

## References

- Swerdlin, Y., Smith, J., Wolfe, J. (2010). The effect of whisper and creak
  vocal mechanisms on vocal tract resonances. JASA.
- Jiao, L., Xu, Y. (2019). Whispered Mandarin has no production-enhanced
  cues for tone and intonation.
- Carlin, M. A., Smolenski, B. Y., Wenndt, S. J. (2006). Unsupervised
  detection of whispered speech in the presence of normal phonation.
  Interspeech 2006. (Energy ratio and missing periodicity as detectors; it
  also reports that the F1 shift is not consistent for English.)
- Ball, M. J., Esling, J., Dickson, C. (1995). The VoQS system for the
  transcription of voice quality. (`W`, `Ṿ`.)
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
