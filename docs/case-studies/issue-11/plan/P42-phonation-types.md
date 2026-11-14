---
id: P42
title: 'Phonation types: breathy, creaky, pressed and falsetto'
type: Feature
milestone: M3
blocked_by: [P38, P20]
requirements: [R17, R5, R7]
---

## Goal

Make `mode.phonation` of {{P38}} audible: breathy, creaky (vocal fry),
pressed, lax, falsetto and harsh voice, on spans and on single segments.
Produce the breathy-voiced stops of Hindi (`bʱ dʱ ɖʱ ɡʱ`) correctly and add
optional creak at the end of a phrase.

## Why

Voice quality carries meaning: it separates Hindi words (`baːl` hair,
`bʱaːl` forehead), marks phrase ends, and is the main cue of several
emotions ({{P43}}). Recognition ({{P59}}) can only output the marks that the
synthesiser can produce and measure.

## Current state

The source in `src/acoustics/glottis.js` is an LF pulse with one shape per
voice:

```js
const rd = Math.min(2.7, Math.max(0.5, 3 * (1 - tenseness)));
```

`head.tenseness` and `head.breathiness` are constants of the voice; nothing
changes them inside an utterance. `#startPeriod()` does not allow periods
below 30 Hz and there is no double pulsing. Measured with
`node experiments/issue-11-audit-m3b.mjs` on one sentence (H1-H2 and HNR in
dB):

```
tenseness 0:   h1h2 13.18  hnr 17.76      tenseness 0.6: h1h2  3.84  hnr 14.70
tenseness 0.3: h1h2 10.46  hnr 16.90      tenseness 0.9: h1h2 -4.31  hnr 13.10
jitter 3:      h1h2  3.79  hnr  9.68      pitch 60: f0 64  voicedShare 0.74
breathiness 1 aspirationLevel 3 chink 10: h1h2 13.99  hnr 13.15
hi baː:  ["consonant:75ms","vowel:250ms"]  peakAspiration 0
hi bʱaː: ["consonant:75ms","vowel:250ms"]  peakAspiration 0
ipa a̤: unknown ["̤"]    ipa a̰: unknown ["̰"]
```

So the pulse shape already moves H1-H2 over 17 dB, but a lax pulse alone
makes the voice cleaner, not breathier (HNR rises), and the noise knob does
almost nothing ({{P20}}). `bʱaː` is identical to `baː`: `pushRelease()` in
`src/articulation/plan.js` returns early for every voiced stop. {{P38}}
makes the parser read `a̤`, `a̰` and the brace labels, but nothing is heard.

## What to do

1. Add plan channels in `src/articulation/plan.js` (time constant 0.03 s,
   default 0; skip `tension` if {{P40}} added it): `tension` (offset on
   `head.tenseness`), `breath`, `creak`, `falsetto`, `harsh` (all 0…1). Pass
   them through `glottis: { … }` in `src/articulation/tract-shape.js`.

2. Create `src/articulation/phonation.js` with the table `PHONATION` and
   `phonationChannels(mode, token, head)`. `d` is the degree (0…1). `Rd` is
   the shape parameter of the LF model; the voice's own value is
   `rdVoice = 3 * (1 - head.tenseness)`. Each type moves Rd towards a target:
   `rd = rdVoice + d * (target - rdVoice)`, `tension = (rdVoice - rd) / 3`.

   | `phonation` field | VoQS     | Rd target | Other channels at `d` = 1  |
   | ----------------- | -------- | --------- | -------------------------- |
   | `breathy`         | `V̤`      | 2.5       | `breath` 1                 |
   | `tension` -1      | `V͉` lax  | 1.8       | none                       |
   | `tension` +1      | `V͈`      | 0.4       | none                       |
   | `creaky`          | `V̰`, `C` | 0.5       | `creak` 1                  |
   | `falsetto`        | `F`      | 2.3       | `falsetto` 1, `breath` 0.3 |
   | `harsh`           | `V!`     | 0.4       | `harsh` 1                  |

   When several fields are set, add the tension offsets and take the
   largest value of each other channel. The Rd targets follow the presets
   of the research notes (modal 1.0, breathy 2.0-2.7, pressed and creaky
   0.3-0.6, falsetto 2.0+); those anchors are marked unverified there, so
   the measured targets in Tests decide, not the Rd numbers. Lower the clamp
   in `lfParameters()` from 0.5 to 0.3.

3. Realise the channels in `Glottis`:
   - `breath`: add `control.breath` to `this.breathiness` in the noise term
     as repaired by {{P20}}. At `breath` 1 the noise must be 10 to 20 dB
     below the voiced part (research notes).
   - `creak` `c`: lower f0 by `12 * c` semitones, not below 25 Hz (change the
     floor in `#startPeriod()` from 30 to 20 Hz); raise jitter by `10 * c`
     percent (research notes: 5-15 %); double pulsing: every second period
     has its amplitude × `(1 - 0.5 * c)` and its length × `(1 + 0.2 * c)`.
     The last two factors are project choices.
   - `falsetto` `f`: raise f0 by `12 * f` semitones and lower the level by
     `6 * f` dB (project choice; the notes only say "often one octave up").
   - `harsh` `h`: raise jitter by `4 * h` percent and shimmer by `10 * h`
     percent, and add noise as `breath` 0.3 would (project choice).

4. Single segments. A token with `breathy: true` (`a̤`, U+0324) or
   `creaky: true` (`a̰`, U+0330) gets the row of the table with `d` = 0.67
   for its own duration. Remove `aspiration: token.breathy ? 0.4 : 0` from
   `vowelChannels()` in `src/articulation/phones.js`.

5. Breathy-voiced stops. In `pushRelease()` add a branch before the early
   return: a plosive or affricate with `token.voiced && token.breathy`
   (`bʱ dʱ ɖʱ ɡʱ dʒʱ`) gets a release segment of `0.08 * context.rate` s with
   `voicing` 1, `breath` 1, Rd target 2.5 and f0 lowered by 1.5 st, which
   then glides into the vowel. The 80 ms and 1.5 st are the proposal of the
   research notes (60-100 ms, 1-2 st), not measurements.

6. Phrase-final creak. Add the head parameter `finalCreak` (0…1, default 0)
   to `src/head-config.js`. In the last syllable before `.` or `‖`, where
   `channels.f0` is below `0.8 * head.pitch`, set
   `creak = finalCreak * min(1, (0.8 * head.pitch - f0) / (0.2 * head.pitch))`.
   With the default 0 nothing changes.

7. Add to `src/analysis/mode-features.js` (create it if it does not exist):
   `cpp(samples, sampleRate)` (cepstral peak prominence in dB: cepstrum of
   40 ms Hann frames, peak between 1/300 and 1/60 s minus the regression
   line over that range, median over voiced frames) and
   `jitterPercent(samples, sampleRate)` (mean absolute difference of
   neighbouring periods divided by the mean period).

8. If {{P21}} is merged, drive the fold model instead of Rd: breathy = folds
   further apart; pressed = folds pressed together; creak = thick slack
   folds at low pressure; falsetto = thin stiff folds with little contact.
   Remove a rule of step 3 only when the fold model alone passes the tests.

How each type is written and recognised (targets against modal voice of the
same speaker; modal today: H1-H2 3.8 dB, HNR 14.7 dB):

| Type     | Inline / `vs:phonation name` | IPA span, segment | Correlates (targets at `d` = 1)       |
| -------- | ---------------------------- | ----------------- | ------------------------------------- |
| breathy  | `[breathy]`                  | `{V̤ … V̤}`, `a̤`    | H1-H2 ≥ 7 dB; HNR and CPP lower       |
| creaky   | `[creaky]`                   | `{V̰ … V̰}`, `a̰`    | f0 -12 st, jitter ≥ 5 %, H1-H2 < 0 dB |
| creak    | `degree="1"`                 | `{C … C}`         | f0 below 70 Hz                        |
| pressed  | `[pressed]`                  | `{V͈ … V͈}`         | H1-H2 < 0 dB, HNR not lower           |
| lax      | `[lax]`                      | `{V͉ … V͉}`         | H1-H2 + 3 dB                          |
| falsetto | `[falsetto]`                 | `{F … F}`         | f0 + 12 st, H1-H2 ≥ 8 dB              |
| harsh    | `[harsh]`                    | `{V! … V!}`       | H1-H2 < 0 dB, HNR lower, jitter ≥ 3 % |

## Tests

Create `tests/phonation.test.js`. Use `Please call Stella.` (tier `medium`,
`seed: 1`, `markup: true`) plain and inside each tag with degree 1, for
example `<vs:phonation name="breathy" degree="1">`. `modal` is the plain
version.

- `breathy`: `h1h2` ≥ 7 dB and ≥ 4 dB above modal; `hnr` ≥ 4 dB below modal;
  `cpp` ≥ 3 dB below modal; median f0 within 1 st of modal.
- `pressed`: `h1h2` ≤ 0 dB and ≥ 4 dB below modal; `hnr` ≥ modal - 2 dB.
- `lax`: `h1h2` 2 to 6 dB above modal; `hnr` ≥ modal - 2 dB.
- `creaky`: median f0 -12 ± 2 st; `jitterPercent` ≥ 5; `h1h2` < 0 dB;
  `{C ˈa C}` (IPA input, 400 ms) has median f0 below 70 Hz.
- `falsetto`: median f0 +12 ± 1 st; `h1h2` ≥ 8 dB.
- `harsh`: `h1h2` ≤ 0 dB; `hnr` ≥ 5 dB below modal; `jitterPercent` ≥ 3.
- `scales with the degree`: for breathy, `h1h2` at degree 0.33, 0.67 and 1
  rises strictly.
- `marks one vowel`: in `ˈma̤ma` H1-H2 of the first vowel is ≥ 4 dB above
  that of the second; in `ˈma̰ma` its f0 is ≥ 6 st lower.
- `separates the four Hindi stops`: for `paː`, `pʰaː`, `baː`, `bʱaː`
  (`language: 'hi'`): `bʱaː` has segments consonant, release (80 ± 5 ms),
  vowel; inside the release `voicedShare` > 0.8 (it is < 0.2 in `pʰaː`) and
  H1-H2 is ≥ 4 dB above the first 80 ms of the vowel of `baː`.
- `creaks at the end only when asked`: `You are coming.` with
  `head: { finalCreak: 1 }` has `jitterPercent` ≥ 5 in the last vowel and
  below 2 in the first; with the default head the samples equal today's.
- `is the same from text and IPA`: `[creaky]ma[/creaky]` and `{V̰ ma V̰}`
  give equal `plan.channels.creak`.

## Acceptance criteria

- [ ] All thresholds of `tests/phonation.test.js` hold on Node.js, Bun and
      Deno.
- [ ] `node experiments/issue-11-audit-m3b.mjs` prints different segments
      for `hi bʱaː` and `hi baː`.
- [ ] Text without markup and with the default head gives the same samples
      as before, except Hindi words with breathy-voiced stops.
- [ ] `docs/markup.md` has the two tables of this issue.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Repairing the noise level of `breathiness`: {{P20}}.
- Whisper and whispery voice: {{P41}}.
- The fold model: {{P21}}. Choosing a quality for an emotion: {{P43}}.
- Recognising voice quality: {{P59}}. The Rust version: {{P70}}.
- Other VoQS settings (ventricular, nasalised, labialised voice).

## References

- Gordon, M., Ladefoged, P. (2001). Phonation types: a cross-linguistic
  overview. Journal of Phonetics.
- Keating, P., Esposito, C., Garellek, M., Khan, S., Kuang, J. (2011).
  Phonation contrasts across languages. ICPhS 2011.
- Ní Chasaide, A., Gobl, C. (1995). Towards acoustic profiles of phonatory
  qualities. ICPhS 1995.
- Wang, Z., Gobl, C. (2023). A system for generating voice source signals
  that implements the transformed LF-model parameter control. Interspeech 2023. (Rd formulas.)
- Hillenbrand, J., Cleveland, R. A., Erickson, R. L. (1994). Acoustic
  correlates of breathy vocal quality. Journal of Speech and Hearing
  Research 37, 769-778. (Cepstral peak prominence.)
- Ball, M. J., Esling, J., Dickson, C. (1995). The VoQS system for the
  transcription of voice quality.
- Research notes:
  `docs/case-studies/issue-11/research/4-linguistics-and-speech-modes.md`.
