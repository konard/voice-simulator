# Issue 150: golden-set render-back against the 9 dB target

Issue: <https://github.com/konard/voice-simulator/issues/150>.
Pull request: <https://github.com/konard/voice-simulator/pull/151>, stacked
on [PR #149](https://github.com/konard/voice-simulator/pull/149) (issue 65),
which adds the inversion and the golden-set benchmark.

## Status

The issue asks to track the golden-set render-back error of acoustic
inversion against the 9 dB research target. Tracking is delivered: the heavy
report lists the target, the gap and a constant-spectrum reference for every
utterance, and the target is a blocked gate. **The 9 dB target itself is not
met and is blocked.** The mean is 60.749 dB, 51.749 dB above it. The
measurements below show that no setting of the current model can reach it on
this metric scale: the per-frame best of all 5,000 rendered codebook rows,
without any smoothness, is still 42.622 dB. The issue 65 synthetic gates keep
their fixtures and thresholds. The four that the inversion of PR #149 does not
meet yet (steady vowels, sentence, lip closure, render-back) are blocked gates
too, so pull requests warn and the default branch fails until #149 meets them.

## Requirement and verification map

| Requirement                                             | Implementation                                                                                                                               | Verification                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Track the golden-set error against the 9 dB target      | `tests/heavy/recognition-inversion.test.js`: per-utterance gap, mean gap, count at or below the target, JSON fields                          | Full heavy run, [report](../../reports/recognition-inversion.md)                                             |
| Say whether an error is a model failure or a hard frame | `constantCepstrumDistortion` in `src/metrics/distortion.js`, a column of the report                                                          | `tests/metrics.test.js`; 14 of 24 render-backs beat it, mean 60.749 against 61.041 dB                        |
| Do not report the unmet target as met                   | `checkBlockedGate` with the 9 dB criterion: a warning on pull requests (`BLOCKED_GATES=warn`), a failure on main and local runs              | The heavy run ends with the blocked-criterion error that names the human action                              |
| Issue 65 keeps its synthetic gates                      | Same fixtures and thresholds in `tests/recognition-inversion.test.js`; the four that PR #149 does not meet yet go through `checkBlockedGate` | Pull requests warn; main and local runs fail with the measured values, as on PR #149                         |
| Root cause and options                                  | This document and `experiments/issue-150-*.mjs`                                                                                              | Commands below, all numbers re-measured from cached heads equal to fresh fits (60.749 dB reproduced exactly) |

## Reproduce

```sh
npm ci
node --test tests/heavy/recognition-inversion.test.js   # about 3 minutes
# experiments: cache heads and codebooks in /tmp/issue150-cache (ISSUE150_CACHE)
node experiments/issue-150-warm.mjs
node experiments/issue-150-eval.mjs baseline            # 60.749 dB
node experiments/issue-150-metric-scale.mjs             # tilt test
for s in $(node -e "import('./experiments/issue-150-cache.mjs').then(m=>console.log([...new Set(m.items.map(i=>i.speaker.id))].join(' ')))"); do
  node experiments/issue-150-templates.mjs "$s"         # about 90 s per speaker
done
node experiments/issue-150-template-bound.mjs           # 42.622 dB bound
LAMBDA=100 node experiments/issue-150-eval.mjs templates # 57.314 dB
```

The issue quotes 62.398 dB from an earlier commit of PR #149. The final
commit of that pull request measures 60.749 dB, and this branch reproduces it
exactly.

## Measurements (24 golden utterances)

| Render-back                                                                          | Mean MCD (dB) |
| ------------------------------------------------------------------------------------ | ------------: |
| Inversion as merged in PR #149 (16 candidates, smoothness 1)                         |        60.749 |
| Constant spectrum of the recording's own mean cepstrum (an oracle)                   |        61.041 |
| Inversion, 64 candidates                                                             |        59.980 |
| Inversion, smoothness 10                                                             |        59.964 |
| Inversion, smoothness 0.1                                                            |        61.436 |
| Inversion, render-back refinement on                                                 |        60.289 |
| Rendered-template tract path (λ 100), inverted source                                |        57.314 |
| Rendered-template tract path, inverted f0, voicing and noise, loudness 1             |        55.471 |
| Rendered-template tract path, flat voiced source, loudness 1 (λ 100 / λ 1000)        | 53.686/53.203 |
| Per-frame best of 5,000 rendered rows, no smoothness, no source (oracle lower bound) |        42.622 |
| Research target                                                                      |         9.000 |

Per utterance: [the heavy report](../../reports/recognition-inversion.md).

## Root causes

### 1. The metric's scale makes 9 dB a very strict target

`melCepstralDistortion` takes the orthonormal DCT of the natural logarithm of
26 mel filter **powers**. The conventional mel-cepstral distortion (Kubichek
1993, SPTK) uses cepstral coefficients of the log **amplitude** spectrum
normalised as a Fourier series. For the same spectral difference the
coefficients here are about 2 × sqrt(2 × 26) ≈ 14 times larger. The tilt
experiment measures 13.1 for every tilt size:

| Linear spectral tilt | RMS log-spectrum difference | Conventional MCD | This metric |
| -------------------- | --------------------------: | ---------------: | ----------: |
| ±3 dB                |                     1.73 dB |          0.87 dB |    11.32 dB |
| ±6 dB                |                     3.46 dB |          1.73 dB |    22.67 dB |
| ±12 dB               |                     6.93 dB |          3.46 dB |    45.42 dB |

So 9 dB here is about 0.7 dB of conventional MCD, below the few dB that
published resynthesis systems usually report. A ±3 dB tilt alone fails the
target. The README already says this cepstrum gives larger
values than SPTK; the research notes say to compare only like with like. The
9 dB target appears to come from conventional figures.

### 2. The inversion follows almost none of the spectral changes

A render whose spectrum never changes, with the mean shape of the recording,
scores 61.041 dB. The inversion scores 60.749 dB and beats this reference on
only 14 of 24 utterances. The time-varying part of the render-back carries
almost no information about the recording on this metric. On `hi-05`
(51.70 dB) the difference of the mean cepstra alone contributes 26.9 dB;
removing the mean of both cepstra leaves 43.5 dB, close to the 50.7 dB of
the recording against its own mean. `experiments/issue-150-diagnose.mjs`
prints this decomposition.

### 3. The codebook and source model bound the error far above 9 dB

Every one of the 5,000 codebook rows of each speaker was rendered for 85 ms
at the speaker's pitch (`experiments/issue-150-templates.mjs`). Choosing,
for every recorded frame independently, the row whose steady render is
closest (no smoothness, no transition cost) gives 42.622 dB. A held row
rendered through `articulationPlan` matches its stored template within 1.6
to 6.7 dB (`experiments/issue-150-steady-check.mjs`), so this is a sound
lower bound of any tract path through this codebook with the steady voiced
source. Real speech adds transitions, noise, f0 movement and spectral detail
of the speaker that the head does not produce.

### 4. Source and level contour

The rendered frame level has a standard deviation of 13 to 23 dB against 8
to 10 dB in the recordings, with a correlation of 0.48 to 0.63, and 26 to 86
scored frames per utterance are rendered silent, mostly where the frontend
marks non-speech and loudness becomes 0 (`experiments/issue-150-level.mjs`).
Iterative level fitting of the loudness channel made the subset worse (64.39
to 65.16 and 65.67 dB on `hi-05`, `en-02`, `zh-01`, `ru-04`). Replacing the
whole inverted source by a flat voiced source improves the number (53.2 dB)
but only because a steady buzz is closer to the mean spectrum; it discards
the source information and is not an inversion improvement, so it is not
adopted.

## What was tried and not shipped

- The inverter options above change the mean by at most 0.8 dB.
- The rendered-template path (`templatePath` in
  `experiments/issue-150-variants.mjs`) picks tract rows by the distance
  between the rendered templates and the recorded MFCC, with the planner's
  step weights as a transition cost. It is the only honest gain found
  (3.4 dB, to 57.314 dB), but it needs 88 s of rendering per speaker for the
  templates (17.6 ms per row) and stays 48 dB above the target, so it is
  recorded as an option rather than shipped.

## Decisions needed from the issue author

1. Whether the 9 dB target is meant on this metric (then the model, not the
   search, must change: see the 42.6 dB bound) or on a conventional MCD. A
   conventional variant would be a new option of `melCepstralDistortion`
   (log amplitude, Fourier-normalised cepstrum); this changes every report
   that uses the metric, so it is not done here.
2. Which model change to fund: a rendered-template codebook, a source model
   with a level contour that follows the recording, or a larger head fit.

Until then `tests/heavy/recognition-inversion.test.js` reports the gap and
fails outside pull requests with the blocked-criterion message.
