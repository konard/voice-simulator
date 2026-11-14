---
id: P23
title: 'Physically based turbulence noise: frication, aspiration and bursts'
type: Feature
milestone: M2
blocked_by: []
requirements: [R1, R5, R9, R18]
---

## Goal

Compute the strength of every noise source (frication at a constriction,
aspiration at the glottis, the burst of a stop) from the air flow and the
pressure drop at the place where the noise is made, instead of from fixed gains.

## Why

Noise in speech is made by turbulent air. Its strength follows the pressure drop
to the power 1.5 (Stevens 1971), so it depends on the lung pressure, on the area
of the constriction and on the area of the glottis at the same time. A model
with these relations gives, without extra rules: weaker noise in voiced
fricatives, a stop burst that passes through a transient, a frication and an
aspiration phase (Stevens 1993), louder consonants in loud speech, and voicing
that dies in a long closure. Fixed gains give none of them.

## Current state

`VoiceRenderer.#fricationNoise()` in `src/acoustics/voice.js`:

```js
const colour =
  broad * 0.5 * (1 - frication.obstacle) + hiss * 0.17 * frication.obstacle;
const flow =
  (1 - closure) * (1 - voicing * (0.5 - 0.4 * this.glottis.noiseModulation));
return (
  colour * frication.gain * flow * loudness * 2.2 * this.head.fricationLevel
);
```

- `frication.gain` is the plan channel `frication` times `turbulence(area)` of
  `src/articulation/tract-shape.js`: 0 below 0.005 cm², rising to 1 at 0.06 cm²,
  then falling to 0 at 0.46 cm². It does not depend on any pressure.
- `broad` is white noise through a fixed band-pass at 1500 Hz and `hiss` through
  a fixed high-pass at 3200 Hz; aspiration noise uses a band-pass at 800 Hz
  (`NoiseSources.configure()`).
- The burst of a stop is the same noise, switched by the planner: the channel
  `frication` gets the manner gain 0.7 for the release (`MANNERS` in
  `src/articulation/phones.js`), 0.015 s long, or 0.06 s with aspiration.
- Aspiration is `control.aspiration` plus a share of `breathiness` in
  `Glottis.step()` (see {{P20}}). The head parameter `glottalChink` adds no
  noise: with 10 mm² the measured HNR rises from 15.42 to 17.36 dB
  (`experiments/issue-11-audit-m2.txt`).
- There is no air pressure in the model: no lung pressure (until {{P21}}), no
  pressure in the mouth.

## What to do

All quantities are in cgs units: areas cm², flow cm³/s, pressure dyn/cm² (1 Pa =
10 dyn/cm²), `rho = AIR_DENSITY` (`src/acoustics/transfer.js`).

1. Create `src/acoustics/aerodynamics.js` with the class `Aerodynamics`. Its
   method `step(dt, lungPressure, glottalArea, constrictionArea)` keeps one
   state, the pressure in the mouth `P_o`, and returns
   `{flow, flowDerivative, oralPressure, glottalDrop, constrictionDrop}`:

   ```
   target = P_L * A_g^2 / (A_g^2 + A_c^2)
   tau    = C * sqrt(rho * P_L / 2) / (A_g + A_c)
   P_o   += (target - P_o) * (1 - exp(-dt / tau))
   U_c    = A_c * sqrt(2 * P_o / rho)
   ```

   `P_L` is the lung pressure, `A_g` the glottal area, `A_c` the constriction
   area, `U_c` the flow through the constriction; `glottalDrop = P_L - P_o`,
   `constrictionDrop = P_o`. If `A_g + A_c` is 0, `P_o` keeps its value. `C` is
   the compliance of the walls and the air behind the constriction: exported
   `ORAL_COMPLIANCE = 1e-3` cm⁵/dyn (range 0.5e-3 to 2e-3; it sets how fast the
   pressure builds up in a stop: about 11 ms with an open glottis of 0.2 cm²).

2. Inputs.
   - `P_L`: the plan channel `lungPressure` in Pa times 10. {{P21}} creates this
     channel and the head parameter `lungPressure` (default 800 Pa); if that
     issue is not merged, create both here exactly as described there.
   - `A_c`: `frication.area` of `tractShape()` (the narrowest place of the
     mouth) plus `velumArea`.
   - `A_g`: with `source: 'folds'` the area of the fold model. With the LF
     source (mean areas in cm²: `GLOTTIS_VOICED = 0.05`, range 0.03 to 0.1;
     `GLOTTIS_OPEN = 0.25`, 0.15 to 0.4; `GLOTTIS_BREATHY = 0.1`, 0.05 to 0.2):

     ```
     A_g = (GLOTTIS_VOICED * voicing + GLOTTIS_OPEN * aspiration
            + GLOTTIS_BREATHY * breathiness * voicing) * (1 - closure)
           + glottalChink / 100
     ```

3. Source strength. Export two pure functions:

   ```
   reynolds(U, A)      = (U / A) * sqrt(4 * A / PI) / VISCOSITY
   sourceStrength(dp, A, U) = gate * dp^1.5 * A^0.5
   gate = clamp((reynolds(U, A) - RE_CRITICAL) / RE_CRITICAL, 0, 1)
   ```

   `VISCOSITY = 0.15` cm²/s (air), `RE_CRITICAL = 1800` (range 1700 to 2300).
   `dp` is the pressure drop at the place of the source and `A` its area. Divide
   by the strength at a reference state (`P_L = 8000`, `A_g = 0.25`,
   `A_c = 0.09`, the area of a fricative in `MANNERS`) so that the result is 1
   for a default voiceless fricative.

4. Use it in `VoiceRenderer`:
   - frication gain = `frication` channel × `head.fricationLevel` × relative
     `sourceStrength(constrictionDrop, frication.area, U_c)` × `FRICATION_GAIN`.
     Remove `turbulence(area)`, the factor `flow`, `loudness` and the constant
     2.2 from this path. Tune `FRICATION_GAIN` so that `[s]` at default settings
     keeps its level within 1 dB.
   - obstacle share: keep `frication.obstacle` (teeth in the jet, a dipole
     source) and give the wall source `WALL_SOURCE = 0.18` of the obstacle
     amplitude (-15 dB; range 0.1 to 0.35) in place of the constants 0.5 and
     0.17.
   - spectrum: replace the two fixed filters by one band-pass with Q 0.5 at
     `clamp(STROUHAL * (U_c / A_c) / sqrt(4 * A_c / PI), 500, 6000)` Hz,
     `STROUHAL = 0.2` (range 0.15 to 0.3); update the filter at the control
     rate. The front cavity of the tract shapes the rest.
   - aspiration: multiply the breath term of `Glottis.step()` by the relative
     `sourceStrength(glottalDrop, A_g, U_c)` (reference: open tract,
     `A_g = 0.25`), and add `CHINK_NOISE * glottalChink / 10` to the breath
     term, `CHINK_NOISE = 0.5` as a starting value.
   - burst transient: inject `flowDerivative * TRANSIENT_GAIN` as a flow source
     at `frication.position`. Tune `TRANSIENT_GAIN` so that the peak of the
     first 3 ms of `[t]` is 0 to 6 dB above the peak of its frication.
   - pass `oralPressure` to the source as `control.oralPressure`. The source
     of {{P22}} reads it; without that issue the value is ignored.

5. In `src/articulation/plan.js` stop writing the release as a `frication` pulse
   of fixed length: keep `frication` at the manner gain from the start of the
   closure to the end of the release, and let the areas do the timing. Aspirated
   stops keep the glottis open (`aspiration` 1) for the planned release time.

6. `experiments/issue-11-turbulence.mjs` (output committed as `.txt`): for
   `[s ʃ f θ x z v]` between `[a]` print the noise level against the vowel and
   the centre of gravity and peak of the spectrum; for
   `[pa ta ka pʰa tʰa kʰa ba]` the times of transient, frication, aspiration and
   voice onset; and `[s]` at `lungPressure` 400, 800 and 1600 Pa.

Every constant above is exported so that {{P29}} can turn it into a voice
parameter and the voice fit can change it.

## Tests

Create `tests/aerodynamics.test.js`:

- `splits the lung pressure`: after 0.2 s with `P_L = 8000`, `A_g = 0.2`,
  `A_c = 0.1` the flow is 335 ± 2 cm³/s, `constrictionDrop` is 6400 ± 20 and the
  two drops add up to 8000.
- `needs a critical Reynolds number`: `reynolds(335, 0.1)` is between 7900 and
  8050; `sourceStrength` is 0 for a flow of 20 cm³/s through 1 cm².
- `follows the power 1.5`: doubling `P_L` at the areas above raises the strength
  by 9 ± 0.5 dB.
- `builds up pressure behind a closure`: with `A_c = 0` and `A_g = 0.2`, `P_o`
  reaches 63 % of `P_L` after 8 to 14 ms; with `A_g = 0.05` after 30 to 55 ms.
- `releases a stop in three phases`: `A_c` opens linearly from 0 to 1 cm² in 20
  ms after 100 ms of closure, `A_g = 0.25`: `flowDerivative` peaks in the first
  3 ms; the strength at the constriction peaks before the strength at the
  glottis and is below 10 % of its peak after 30 ms; the strength at the glottis
  is at least 90 % of its final value after 40 ms.

Add to `tests/acoustics.test.js` (tier `medium`):

- `makes sibilants louder than other fricatives`: the noise of `[s]` in `asa` is
  at least 6 dB above that of `[f]` in `afa`.
- `weakens the noise of voiced fricatives`: the energy above 4 kHz of `[z]` in
  `aza` is 3 to 12 dB below that of `[s]` in `asa`.
- `lets the lung pressure drive frication`: `[s]` is 7 to 11 dB stronger with
  `lungPressure` 1600 than with 800.
- `adds noise through a glottal chink`: `analyzeVoice().hnr` of a steady `[aː]`
  is at least 3 dB lower with `glottalChink` 10 than with 0.

The existing test
`keeps consonants quieter than vowels and closures nearly silent` must pass
unchanged.

## Acceptance criteria

- [ ] `experiments/issue-11-turbulence.txt` is committed; the peak of `[s]` is
      between 4 and 8 kHz and at least 1000 Hz above the peak of `[ʃ]`.
- [ ] In the same file the voice onset of `[pʰa tʰa kʰa]` is 40 to 100 ms after
      the release and that of `[pa ta ka]` at most 30 ms.
- [ ] `grep -n "turbulence(" src` finds nothing.
- [ ] `node experiments/issue-11-audit-m2.mjs` prints the same source noise
      levels for `breathiness` 0.2 and 1 as before this change, within 1 dB
      (if {{P20}} is merged they are inside its ranges).
- [ ] The sentence of the audit renders at most 5 % slower on tier `medium`.
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Noise sources computed in the 3D field itself; the 3D solver gets the same
  source signal at the same place as today.
- The effect of the mouth pressure on the vocal folds: {{P21}}, {{P22}}.
- Whisper: {{P41}}. Clicks and ejectives: {{P44}}. Voice files: {{P29}}.

## References

- Stevens, K. N. (1971). Airflow and turbulence noise for fricative and stop
  consonants: static considerations. Journal of the Acoustical Society of
  America 50(4B), 1180-1192. doi:10.1121/1.1912751
- Stevens, K. N. (1993). Models for the production and acoustics of stop
  consonants. Speech Communication 13(3-4), 367-375.
  doi:10.1016/0167-6393(93)90035-J
- Stevens, K. N. (1998). Acoustic Phonetics. MIT Press.
- Shadle, C. H. (1985). The acoustics of fricative consonants. PhD thesis,
  Massachusetts Institute of Technology.
- Narayanan, S., & Alwan, A. (2000). Noise source models for fricative
  consonants. IEEE Transactions on Speech and Audio Processing 8(3), 328-344.
  doi:10.1109/89.841215
- Jongman, A., Wayland, R., & Wong, S. (2000). Acoustic characteristics of
  English fricatives. Journal of the Acoustical Society of America 108(3),
  1252-1263.
- Research notes: `docs/case-studies/issue-11/research/` note 5 (part B).
