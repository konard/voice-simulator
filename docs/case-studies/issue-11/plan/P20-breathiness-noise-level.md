---
id: P20
title: '`breathiness` hardly changes the measured noise level'
type: Bug
milestone: M2
blocked_by: []
requirements: [R5, R9, R18]
---

## Goal

Moving the head parameter `breathiness` from 0 to 1 must turn a clear voice into
a clearly breathy one, and the analysis (`analyzeVoice`) must measure that
change: the harmonics-to-noise ratio (HNR) must fall by at least 8 dB and the
level difference of the first two harmonics (H1-H2) must rise by at least 4 dB.

## Why

`breathiness` is one of the 33 voice parameters and the voice match
(`matchVoice`) fits it from the measured HNR. Today the measurement does not
react, so the fit cannot find the breathiness of a real speaker. The voice fit
({{P51}}) and the phonation types ({{P42}}) are blocked by this bug.

## Current state

Reproduce with `node experiments/issue-11-audit.mjs` (sentence, tier `medium`):

```
breathiness 0: {"hnr":15.19,"h1h2":3.43}
breathiness 0.5: {"hnr":15.01,"h1h2":3.44}
breathiness 1: {"hnr":14.59,"h1h2":3.46}
```

More detail comes from `node experiments/issue-11-audit-m2.mjs` (output in
`experiments/issue-11-audit-m2.txt`). There are three causes.

**Cause 1: the noise is far too weak.** `Glottis.step()` in
`src/acoustics/glottis.js` adds the breath noise like this:

```js
const breath =
  (control.aspiration + this.breathiness * voicing * 0.35) *
  (1 - control.closure);
return (
  voiced + noise * breath * modulation * loudness * 0.45 * this.aspirationLevel
);
```

`noise` is white noise after a band-pass at 800 Hz with Q 0.5
(`NoiseSources.configure()` in `src/acoustics/voice.js`). Measured level of the
noise against the level of the glottal pulses (both RMS, at the source):

```
source noise re pulses, breathiness 0.2: {"dB":-39.98}
source noise re pulses, breathiness 0.5: {"dB":-32.02}
source noise re pulses, breathiness 1: {"dB":-26}
```

Real breathy voices have aspiration noise about 10 to 20 dB below the voiced
part (Klatt & Klatt 1990). The strongest setting is 6 dB weaker than the weak
end of that range.

**Cause 2: `breathiness` does not change the pulse shape.**
`lfParameters(tenseness)` in the same file computes the pulse from `tenseness`
only: `rd = Math.min(2.7, Math.max(0.5, 3 * (1 - tenseness)))`. A breathy voice
has a longer open phase and a stronger first harmonic (H1-H2 of 7 to 12 dB
against 0 to 4 dB for a modal voice; Klatt & Klatt 1990, Hanson 1997). Measured
on a steady `[aː]`:

```
steady [aː], ..., breathiness 0: {"hnr":15.42,"h1h2":5.26}
steady [aː], ..., breathiness 1: {"hnr":13.96,"h1h2":5.29}
steady [aː], tenseness 0.2: {"hnr":21.81,"h1h2":13.45}
steady [aː], tenseness 0.9: {"hnr":10.76,"h1h2":-2.83}
```

So `tenseness` moves H1-H2 by 16 dB and `breathiness` by 0.03 dB.

**Cause 3: the HNR measure is limited by pitch movement, not by noise.**
`analyzeVoice()` in `src/analysis/voice-features.js` takes the YIN aperiodicity
`d` of a 40 ms frame (`WINDOW = 0.04`) and reports
`10 * Math.log10((1 - d) / d)`, clamped to at most 30 dB. When the pitch moves
inside the frame, the periods do not line up and `d` grows although there is no
noise:

```
noise-free harmonic signal, 120 Hz: {"hnr":30}
noise-free harmonic signal, gliding 126 to 114 Hz: {"hnr":23.81}
planned f0 of [aː], default prosody: {"from":119.8,"to":98.6,"seconds":0.51}
steady [aː], pitchRange 0.5, breathiness 0: {"hnr":20.53,"h1h2":5.18}
```

A synthesized vowel with no noise at all reads only 15.4 dB, because its pitch
falls by 42 Hz per second. Noise weaker than about -15 dB cannot be seen under
that floor. The noise does reach the measure once it is strong enough:
`breathiness` 1 with `aspirationLevel` 3 reads 9.05 dB. `glottalChink` 10 mm²
raises the reading to 17.36 dB, because the chink adds no noise ({{P23}}).

## What to do

1. In `src/acoustics/glottis.js` add two exported constants,
   `BREATHINESS_RD = 1.5` and `BREATHINESS_REFERENCE = 0.2`, and change the
   signature to `lfParameters(tenseness, breathiness = BREATHINESS_REFERENCE)`
   with

   ```
   rd = clamp(3 * (1 - tenseness)
              + BREATHINESS_RD * (breathiness - BREATHINESS_REFERENCE),
              0.5, 2.7)
   ```

   `rd` is the shape parameter Rd of the LF model (Fant 1995): 0.5 is a pressed
   voice, 2.7 a very breathy one. The default `breathiness` 0.2 gives the same
   result as today. Pass `this.breathiness` at every call inside `Glottis`.

2. In `Glottis.step()` replace the linear noise gain by a power law, with the
   exported constants `BREATH_GAIN = 2.2` (range 1 to 4) and
   `BREATH_EXPONENT = 2.15` (range 1.5 to 3):

   ```
   breath = (aspiration
             + BREATH_GAIN * breathiness ** BREATH_EXPONENT * voicing)
            * (1 - closure)
   ```

   The default 0.2 keeps today's level (`2.2 * 0.2 ** 2.15 = 0.069`, today
   `0.2 * 0.35 = 0.07`) and `breathiness` 1 is 30 dB stronger. Tune both until
   part 1 of `experiments/issue-11-audit-m2.mjs` prints -40 ± 2 dB at 0.2,
   between -26 and -20 dB at 0.5 and -10 ± 2 dB at 1.

3. Remove the pitch-movement bias from the HNR measure in
   `src/analysis/voice-features.js`. Add an internal function
   `straighten(signal, start, length, sampleRate, slope, f0)` that resamples one
   frame so that its pitch is constant:
   - `slope` is the pitch change in Hz per second, from the `f0` of the previous
     and the next voiced frame (`(next - previous) / (2 * HOP)`; 0 when one of
     them is unvoiced), limited to `4 * f0` per second;
   - for output sample `n` at time `t = (n - length / 2) / sampleRate` read the
     input at time `t + slope * t * t / (2 * f0)` with cubic interpolation.

   Run `yinPitch()` once as today to get `f0` per frame, then compute the
   aperiodicity for the HNR again on the straightened frame.

4. In `src/analysis/voice-match.js` the entry of `CONTROLS` for `breathiness`
   uses `feature: 'hnr'` with slope `-2`. Measure the new slope with
   `experiments/issue-5-voice-sensitivity.mjs` (extend it if needed) and write
   the measured value into `CONTROLS`. `tenseness` keeps `h1h2`; because
   `breathiness` now moves `h1h2` too, check that `matchVoiceSteps()` still
   converges (test below) and lower `maxStep` of both entries if it oscillates.

5. Update the description of `breathiness` in `src/head-config.js` to: "Breathy
   voice: more aspiration noise at the glottis and a longer open phase."

6. Re-run `experiments/issue-9-preset-source.mjs` and
   `experiments/issue-9-preset-fit.mjs`. If a preset in `src/head-presets.js`
   moves away from its target H1-H2 by more than 1 dB, adjust its `tenseness`
   range, not its `breathiness`. Re-run both audit scripts and commit the new
   `.txt` outputs.

## Tests

Add to `tests/acoustics.test.js`:

- `makes the pulse breathier with breathiness`: `lfParameters(0.6, 1).rd` is
  greater than `lfParameters(0.6, 0).rd` by at least 1.2, and
  `lfParameters(0.6)` equals `lfParameters(0.6, 0.2)`.
- `raises the breath noise by 30 dB over the range`: run `Glottis.step()` for 1
  s at 48000 Hz, 120 Hz, once with the noise input set to 0 and once with white
  noise of unit RMS and the difference taken; the level of the difference
  against the pulses rises by 28 to 32 dB from `breathiness` 0.2 to 1.

Add to `tests/voice-match.test.js`:

- `measures breathiness in both features`: synthesize `MATCH_TEXT` on tier
  `minimal`, seed 1, with `breathiness` 0, 0.25, 0.5, 0.75 and 1. `hnr` must
  fall at every step and by at least 8 dB in total; `h1h2` must rise at every
  step and by at least 4 dB in total.
- `reads a noise-free glide as clean`: a sum of 10 harmonics with amplitude
  `1 / k`, pitch gliding linearly from 150 to 100 Hz in 0.5 s, sample rate 16000
  Hz; `analyzeVoice().hnr` is at least 25 dB.
- `recovers breathiness`: `matchVoice()` on audio synthesized with `breathiness`
  0.1 and with 0.8 (other parameters default) returns `breathiness` within 0.2
  of the true value.

All existing tests must pass. If preset tests fail, fix the slopes or the
presets (steps 4 and 6), not the tests.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit.mjs` prints `hnr` values for
      `breathiness` 0, 0.5 and 1 that fall at each step and differ by at least 8
      dB between 0 and 1, and `h1h2` values that rise by at least 4 dB.
- [ ] `node experiments/issue-11-audit-m2.mjs` prints the source noise at -40 ±
      2 dB for `breathiness` 0.2 and -10 ± 2 dB for 1.
- [ ] The same script prints an `hnr` of at least 20 dB for the steady `[aː]`
      with `breathiness` 0.
- [ ] Audio rendered with the default head differs from the audio before this
      change by less than 1 dB in RMS level and less than 0.5 dB in `h1h2`.
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Noise computed from glottal area and air flow, chink noise: {{P23}}.
- Physical vocal folds: {{P21}}. Modes of speech: {{P41}}, {{P42}}.
- A better pitch tracker and a full voice fit: {{P47}}, {{P51}}.

## References

- Klatt, D. H., & Klatt, L. C. (1990). Analysis, synthesis, and perception of
  voice quality variations among female and male talkers. Journal of the
  Acoustical Society of America 87(2), 820-857. doi:10.1121/1.398894
- Hanson, H. M. (1997). Glottal characteristics of female speakers: acoustic
  correlates. Journal of the Acoustical Society of America 101(1), 466-481.
- Fant, G. (1995). The LF-model revisited. Transformations and frequency domain
  analysis. STL-QPSR 36(2-3), 119-156.
- de Cheveigné, A., & Kawahara, H. (2002). YIN, a fundamental frequency
  estimator for speech and music. Journal of the Acoustical Society of America
  111(4), 1917-1930.
- Research notes 4 (section 5) and 5 in `docs/case-studies/issue-11/research/`.
