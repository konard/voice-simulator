---
id: P22
title: Source-tract interaction and the subglottal tract
type: Feature
milestone: M2
blocked_by: [P21]
requirements: [R1, R5, R9, R18]
---

## Goal

Let the air flow through the glottis depend on the sound pressure just above it
(in the vocal tract) and just below it (in the windpipe), and add the windpipe
as a second tube with its own resonances. After that, check the fold source of
{{P21}} against a list of measurements and make it the default if it passes.

## Why

In a real voice the glottal flow depends on the tract. The air column above the
glottis delays the flow, so the pulse leans to the right and closes more sharply
(a brighter voice for free); the first formant leaves a ripple on the pulse; the
formant bandwidth is larger while the glottis is open; and the resonances of the
windpipe add weak peaks and dips near 600, 1400 and 2100 Hz. Titze (2008)
describes this as non-linear source-filter coupling.

## Current state

The source and the tract are coupled in one direction only. In
`Waveguide.step()` (`src/acoustics/waveguide.js`):

```js
this.junctionRight[0] =
  this.left[0] * this.glottalReflection + glottalFlow / this.areas[0];
```

`glottalFlow` comes from `Glottis.step()` (or `VocalFolds.step()` after {{P21}})
and does not depend on `this.left[0]`, the wave coming back from the tract. The
glottis is a constant reflection `GLOTTAL_REFLECTION = 0.75` (lower with the
head parameter `glottalChink`, see `glottalReflection()` in
`src/acoustics/glottis.js`), the same in the open and the closed phase. `Fdtd3d`
(`src/acoustics/fdtd3d.js`) does the same with a constant admittance
`(1 - reflection) / (1 + reflection)` on its `sourceCells`. There is no tube
below the glottis.

Two facts about units, needed below. The waves in `Waveguide` are pressure
divided by `AIR_DENSITY * SPEED_OF_SOUND` (flow is `(right - left) * area`). The
source is the **derivative** of the flow times an arbitrary constant, so the
waves in the tract are derivatives of the true waves.

A candidate area function for the windpipe was checked with `tubeFormants()` of
`src/acoustics/transfer.js` (`node experiments/issue-11-audit-m2.mjs`):

```
subglottal resonances, trachea 10 cm of 2.5 cm², flare 8 cm to 20 cm²:
  [626,1461,2221]
```

Measured values in adults are near 600 to 640, 1400 to 1550 and 2100 to 2200 Hz
(Ishizaka, Matsudaira & Kaneko 1976; Lulich 2010).

## What to do

1. Subglottal tube. Create `src/acoustics/subglottal.js` exporting the class
   `Subglottal`, a Kelly-Lochbaum line like the nose branch of `Waveguide`:
   - area function from the glottis downwards, exported as
     `subglottalShape(head)`: 10 cm of 2.5 cm² (trachea), then 8 cm in which the
     area grows exponentially to 20 cm² (bronchi); both lengths times
     `head.vocalTractLength / 16.5` and times a new head parameter
     `subglottalLength` (factor, 0.8 to 1.25, default 1);
   - the far end uses `Radiation` (`src/acoustics/radiation.js`) with the end
     area: the lungs act as a wide, absorbing opening;
   - losses: `lossFactor(area, head.wallLoss * SUBGLOTTAL_LOSS)`,
     `SUBGLOTTAL_LOSS = 3` (range 1 to 8); tune it so that the -3 dB bandwidth
     of the first resonance is 150 to 350 Hz (soft walls; Ishizaka et al. 1976);
   - `step(flowIn)` advances one step; the getter `incident` is the wave that
     arrives at the glottis; `area` is the area of the first section;
   - advance the line on every second solver step (`SUBGLOTTAL_DECIMATION = 2`,
     sections of length `2 * SPEED_OF_SOUND * dt`) to halve its cost.

2. Solver interface. Add to `Waveguide` and `Fdtd3d` a method `glottalLoad()`
   that returns `{incident, area}`:
   - `Waveguide`: `{incident: this.left[0], area: this.areas[0]}`;
   - `Fdtd3d`: `{incident: p / 2, area: Infinity}` where `p` is the mean
     pressure of `sourceCells` after the last update (the formula of step 3 then
     uses the pressure itself, one step late).

   Add a setter that makes the glottal end fully reflecting
   (`glottalReflection = 1`; in `Fdtd3d` recompute `glottisAdmittance`).

3. Flow equation. `a` is the glottal area (cm², `a_min` of `VocalFolds`), `A_s`
   and `A_e` the areas of the first section below and above the glottis, `P_L`
   the lung pressure (dyn/cm²), `P_o` the static pressure in the mouth (0 unless
   {{P23}} provides `control.oralPressure`), `p_s` and `p_e` the incident sound
   pressures from below and above, `rho` the air density, `c` the speed of sound
   and `k_t = 1.1` the pressure coefficient of the glottis (exported
   `GLOTTAL_PRESSURE_COEFFICIENT`, range 1.0 to 1.4). The pressure across the
   glottis is `k_t * rho * u^2 / (2 * a^2)`; the pressures at its sides are
   `P_L + 2 * p_s - rho * c * u / A_s` and `P_o + 2 * p_e + rho * c * u / A_e`.
   Solving for the flow `u` (cm³/s) gives the formula of Titze (1984, 2008):

   ```
   1 / A = 1 / A_s + 1 / A_e
   D = (P_L - P_o) / 2 + p_s - p_e
   u = sign(D) * (a * c / k_t)
       * (-(a / A) + sqrt((a / A)^2 + 4 * k_t * |D| / (rho * c^2)))
   ```

   Implement it as an exported pure function `interactiveFlow(a, A_s, A_e, D)`
   in `src/acoustics/folds.js`.

4. True pressures. Because the tract carries derivatives, recover the incident
   pressure by a leaky integrator on `glottalLoad().incident`:
   `y += x * dt; y *= 1 - 2 * Math.PI * PRESSURE_CORNER * dt`, with
   `PRESSURE_CORNER = 20` Hz, then `p_e = y * rho * c / FOLDS_FLOW_SCALE` (the
   constant of {{P21}}). Do the same for the subglottal line. Static pressure is
   removed on purpose: it belongs to the slow air-flow circuit of {{P23}}.

5. Coupled stepping. `VocalFolds.step(dt, control, noise, load)` gets a fourth
   argument `load = {below: {pressure, area}, above: {pressure, area}}`. When it
   is given:
   - compute `u` with `interactiveFlow()`;
   - use the pressures at the two sides (step 3) in the fold forces:
     `P_1 = p_below - (p_below - p_above) * (a_min / a_1)^2` and
     `F_2 = L * d_2 * p_above`;
   - return `(u - u_previous) / dt * FOLDS_FLOW_SCALE` as before.

   `VoiceRenderer` then sets the glottal reflection of the solver to 1, feeds
   the returned value into the tract and its negative into `Subglottal.step()`.

6. Options. `VoiceRenderer` accepts `interaction: boolean` (constant
   `DEFAULT_INTERACTION = false`) and `subglottal: boolean` (default: same as
   `interaction`). `interaction: true` with `source: 'lf'` throws
   `Interaction needs source: 'folds'`. Add the CLI flag `--interaction`.

7. `experiments/issue-11-interaction.mjs` (output committed as `.txt`): for
   static `[ɑ]`, `[i]`, `[u]` at 120 Hz, with and without interaction, print the
   skew of the flow pulse (time from opening to the flow peak divided by the
   open time), the frequency and relative size of the ripple on the rising part
   of the pulse, the -3 dB bandwidth of F1, H1-H2 of the output, and the three
   subglottal resonances with their bandwidths.

8. Default. Run this checklist on tier `medium`:
   - all tests of this issue and of {{P21}} pass;
   - the audit sentence renders at most 35 % slower than with `source: 'lf'`;
   - the vowel formant tests of `tests/head-presets.test.js` pass with
     `source: 'folds', interaction: true`;
   - `[aba]` keeps voicing for at least 40 ms after the lips close and `[apa]`
     stops voicing within 30 ms.

   If all four hold, set `DEFAULT_SOURCE = 'folds'` and
   `DEFAULT_INTERACTION = true`, re-run `experiments/issue-9-preset-source.mjs`
   and the slopes of `src/analysis/voice-match.js`, and update the values. If
   one fails, keep the defaults and state which check failed and by how much. If
   the Rust engine of {{P13}} is already the default, do not flip here; record
   the result in {{P70}}.

## Tests

Create `tests/interaction.test.js`:

- `solves the flow equation`: `interactiveFlow(a, Infinity, Infinity, D)` equals
  `a * sqrt(4 * D / (k_t * rho))` within 1e-9 relative; for `a = 0.1`,
  `A_s = A_e = 3`, `D = 4000` the result is smaller and satisfies the pressure
  balance of step 3 within 1e-6 relative; `-D` gives the negative; `a = 0`
  gives 0.
- `reports the load of a uniform tube`: in a `Waveguide` with 44 sections of 3
  cm² and a unit step of glottal flow, the integral of `glottalLoad().incident`
  stays 0 until the round-trip time of the tube and `area` is 3.
- `resonates like a windpipe`: the impulse response of `Subglottal` for the
  default head peaks in 550 to 700, 1300 to 1650 and 2000 to 2400 Hz.
- `skews the pulse to the right`: for `[ɑ]` the skew of step 7 is larger by at
  least 0.05 with interaction than without.
- `leaves a ripple at the first formant`: for `[ɑ]`, the flow minus its 3 ms
  moving average, inside the open phase, has a dominant frequency within 20 % of
  F1 and an RMS of at least 1 % of the peak flow.
- `damps the first formant more while the glottis is open`: the bandwidth of F1
  of `[ɑ]` with `adduction` 0.3 is at least 20 % larger than with 0.8.
- `stays stable in 3D`: `'ˈama'` on tier `high` with `source: 'folds'` and
  `interaction: true` is finite; its RMS is within 6 dB of the `medium` result.
- `rejects interaction with the LF source`: throws the message of step 6.

## Acceptance criteria

- [ ] `experiments/issue-11-interaction.txt` is committed and shows, for all
      three vowels, a larger skew with interaction, and subglottal resonances
      inside the three ranges of the test.
- [ ] With `--source folds --interaction`,
      `node bin/voice-simulator.js "Hello." --out /tmp/i.wav` writes a file
      whose pitch (`voice-simulator match`) is within 8 % of the file without
      `--interaction`.
- [ ] The pull request contains the four results of the checklist of step 8 and
      says whether the defaults were flipped.
- [ ] With the defaults not flipped, default audio is bit-identical to before.
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- The slow air-flow circuit with the static mouth pressure, and flow noise:
  {{P23}}. Yielding walls, which decide how long voicing lasts in `[b d g]`:
  {{P24}}.
- Interaction for the LF source. Modes of speech: {{P41}}, {{P42}}. Rust:
  {{P70}}.

## References

- Titze, I. R. (2008). Nonlinear source-filter coupling in phonation: theory.
  Journal of the Acoustical Society of America 123(5), 2733-2749.
  doi:10.1121/1.2832337
- Titze, I. R. (1984). Parameterization of the glottal area, glottal flow, and
  vocal fold contact area. Journal of the Acoustical Society of America 75(2),
  570-580. doi:10.1121/1.390530
- Ishizaka, K., Matsudaira, M., & Kaneko, T. (1976). Input acoustic-impedance
  measurement of the subglottal system. Journal of the Acoustical Society of
  America 60(1), 190-197.
- Lulich, S. M. (2010). Subglottal resonances and distinctive features. Journal
  of Phonetics 38(1), 20-32. doi:10.1016/j.wocn.2008.10.006
- Research notes: `docs/case-studies/issue-11/research/` note 5 (part B).
