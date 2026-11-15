---
id: P24
title: Frequency-dependent losses in the 1D solver
type: Feature
milestone: M2
blocked_by: []
requirements: [R1, R5, R9, R18]
---

## Goal

Give the waveguide solver the three losses of a real vocal tract with their real
dependence on frequency: friction and heat exchange at the walls (grow with the
square root of the frequency), walls that yield to the pressure (act below about
300 Hz), and sound radiation at the lips. The formant bandwidths must then agree
with published measurements.

## Why

The bandwidth of a formant decides how sharp and how loud it is. Wrong
bandwidths make vowels sound muffled or buzzy and change their loudness balance.
Yielding walls also set the lowest possible first formant (about 180 to 200 Hz
with the mouth closed) and let voicing continue during `[b d g]`.

## Current state

`lossFactor()` in `src/acoustics/waveguide.js` gives every section one
attenuation for all frequencies:

```js
export function lossFactor(area, wall = 1) {
  const boundary = 0.0004 / Math.sqrt(Math.max(area, 0.05));
  const constriction = Math.min(0.3, 0.0001 / Math.max(area, 1e-3) ** 2);
  return 1 - 0.0007 * wall - boundary * wall - constriction;
}
```

`wall` is the head parameter `wallLoss`. The result is raised to the power
`44 / sections`. The walls are rigid. The lips and the nostrils radiate like a
piston in an infinite wall (`src/acoustics/radiation.js`, Flanagan 1972). The
reference `tubeTransfer()` in `src/acoustics/transfer.js` has a loss that grows
with the square root of the frequency (`2e-5 * sqrt(f) / sqrt(area)` per cm) and
rigid walls too.

Measured bandwidths (-3 dB width of the peaks of the impulse response, tier
`medium`, `node experiments/issue-11-audit-m2.mjs`), with the glottis closed
(`glottalReflection = 1`), against the formula of Hawks & Miller (1995):

```
vowel  formant Hz   measured Hz   Hawks & Miller Hz
[ɑ]    814          64            41
[ɑ]    1238         96            43
[ɑ]    2718         120           107
[i]    358          40            44
[i]    2398         56            84
[i]    3154         88            143
[u]    398          52            40
[u]    942          56            42
[u]    2610         48            99
```

So the bandwidths are up to 2.2 times too wide below 1500 Hz and up to 2 times
too narrow above 2000 Hz. This is what a loss without frequency dependence does.
With the default glottis the first formant of `[ɑ]` is 148 Hz wide.

## What to do

Units: cgs (cm, g, s; pressure dyn/cm²). `c = SPEED_OF_SOUND`,
`rho = AIR_DENSITY`.

1. Reference curve. Create `src/acoustics/losses.js` and export
   `publishedBandwidth(F, f0 = 132)`, the formula of Hawks & Miller (1995):
   `S * (k0 + k1*F + k2*F^2 + k3*F^3 + k4*F^4 + k5*F^5)` with
   `S = 1 + 0.25 * (f0 - 132) / 88` and

   ```
   F < 500:  165.327516, -6.73636734e-1, 1.80874446e-3,
             -4.52201682e-6, 7.49514000e-9, -4.70219241e-12
   F >= 500: 15.8146139, 8.10159009e-2, -9.79728215e-5,
             5.28725064e-8, -1.07099364e-11, 7.91528509e-16
   ```

   Check the twelve numbers against the paper before use. They give 44 Hz at 358
   Hz, 41 Hz at 814 Hz and 107 Hz at 2718 Hz.

2. Wall friction and heat. Export `viscothermalLoss(f, area, shape = 1)`, the
   attenuation in 1/cm of a pressure wave in a round rigid tube:

   ```
   alpha = shape * sqrt(PI * f) * (sqrt(nu) + (gamma - 1) * sqrt(kappa))
           / (r * c),      r = sqrt(area / PI)
   ```

   `nu = 0.15` cm²/s (viscosity of air), `kappa = 0.21` cm²/s (heat diffusion),
   `gamma = 1.4`. This is `5.1e-5 * shape * sqrt(f) / sqrt(area)`. `shape` is
   the perimeter of the real cross-section divided by that of a circle of the
   same area: exported `LOSS_SHAPE = 1.5` (range 1 to 3). Use the same function
   in `sectionMatrix()` of `transfer.js` in place of its constant `2e-5`.

3. In `Waveguide`, remove the terms `0.0007 * wall` and `boundary * wall` from
   `lossFactor()` (keep `constriction`). Split the tract into `LOSS_STAGES = 4`
   groups of sections (the nose: 2 groups). At the end of each group filter both
   travelling waves with `y[n] = b0 * x[n] - a1 * y[n-1]`. Export
   `designLossFilter(K, sampleRate)` returning `{b0, a1}` whose gain equals
   `exp(-K * sqrt(f))` at 500 Hz and at 4000 Hz, where `K` is the sum over the
   group of `viscothermalLoss(1, area, LOSS_SHAPE) * sectionLength * wallLoss`.
   Recompute the filters in `setShape()`.

4. Yielding walls. At the end of each group add a wall branch: a mass, a damper
   and a spring driven by the local pressure `p` (dyn/cm²), with the wall flow
   `U_w` (cm³/s) and the wall volume `V_w` (cm³):

   ```
   dU_w/dt = (S / m) * (p - (b / S) * U_w - (k / S) * V_w)
   dV_w/dt = U_w
   ```

   `S` is the wall surface of the group (sum of
   `2 * sqrt(PI * area) * sectionLength`). Starting values per unit area from
   Ishizaka, French & Flanagan (1975), relaxed cheek: `m = 2.1` g/cm², `b = 800`
   dyn·s/cm³, `k = 84500` dyn/cm³. Integrate with semi-implicit Euler (first
   `U_w`, then `V_w`) every sample and take `U_w` out of the tract as a negative
   flow source at that junction, in the way `step()` adds the noise source. Add
   the same branch to `tubeTransfer()` as a shunt admittance
   `S / (b + i * (omega * m - k / omega))` per section.

5. Head parameters (group `acoustics`): `wallMass` (g/cm², 1 to 3, default 2.1),
   `wallResistance` (dyn·s/cm³, 400 to 2400, default 800), `wallStiffness`
   (dyn/cm³, 30000 to 500000, default 84500). `wallLoss` stays and multiplies
   `LOSS_SHAPE` and `wallResistance`.

6. Radiation. A head is a sphere, not an infinite wall: at low frequencies a
   piston on a sphere radiates half the resistance of a piston in a wall. Add
   the argument `baffle` (0 = free pipe end, 1 = infinite wall) to
   `Radiation.configure(area, rate, baffle = 1)`: the resistance constant is
   `RADIATION_RESISTANCE * (0.5 + 0.5 * baffle)` and the end correction
   `(0.61 + 0.24 * baffle) * a` (`a` is the radius of the opening). Exported
   `RADIATION_BAFFLE = 1` keeps today's sound; step 7 decides its final value
   (range 0.3 to 1).

7. Calibrate with `experiments/issue-11-bandwidths.mjs` (output committed as
   `.txt`): for the eleven vowels of `STORY_LENGTHS` print the first four
   formants and bandwidths of the waveguide, of `tubeTransfer()` and of
   `publishedBandwidth()`. Change only `LOSS_SHAPE` (first), `RADIATION_BAFFLE`
   and `LOSS_STAGES` until the mean absolute error is smallest. Do not change
   `wallMass`, `wallResistance` or the glottis.

8. The walls raise the first formant of close vowels (about
   `sqrt(F1^2 + 185^2)`: 358 Hz becomes about 400 Hz). Re-run
   `experiments/fdtd-formants.mjs` and the experiments that fit the vowel
   shapes, and update the tables so that the vowel tests pass again.

## Tests

Create `tests/losses.test.js`:

- `grows with the square root of the frequency`: `viscothermalLoss(2000, 3)` is
  twice `viscothermalLoss(500, 3)` within 1e-9, and `viscothermalLoss(500, 3)`
  is 6.6e-4 ± 10 %.
- `fits the loss filter`: for `K` = 2e-5, 1e-4 and 5e-4 the gain of the filter
  differs from `exp(-K * sqrt(f))` by less than 15 % of the loss in dB at 250,
  1000, 2000 and 8000 Hz (rate 48000).
- `resonates on its walls when closed`: a uniform tube of 3 cm², 17 cm long,
  closed at both ends, has the lowest peak of the pressure in its middle between
  170 and 210 Hz (expected: `c / (2 * PI) * sqrt(2 * rho / (m * r))` = 186 Hz),
  in the waveguide and in `tubeTransfer()`.
- `matches published bandwidths`: for `[ɑ]`, `[i]` and `[u]` with
  `glottalReflection = 1` the bandwidths of the first three formants are within
  35 % of `publishedBandwidth(F)`.
- `widens the formants for an open glottis`: the bandwidth of F1 of `[ɑ]` with
  the default glottis is 1.2 to 2.5 times the closed value.
- `agrees with the tube transfer`: formants within 3 % and bandwidths within 25
  % between `Waveguide` and `tubeTransfer()` for the same three vowels.
- `radiates less from a free pipe end`: with `baffle` 0 the bandwidth of F3 of
  `[ɑ]` is smaller than with 1.

Add `wallMass`, `wallResistance` and `wallStiffness` to the direction test of
`tests/head-parameters.test.js`: more `wallResistance` lowers the level of F1 of
`[i]`; more `wallMass` lowers F1 of `[i]`.

## Acceptance criteria

- [x] `experiments/issue-11-bandwidths.txt` is committed; the mean absolute
      error of the waveguide against `publishedBandwidth()` over 11 vowels and 3
      formants is below 25 %, and the old value (measured before the change) is
      printed beside it. (23.7 %, before 34.7 %.)
- [ ] `node experiments/issue-11-audit-m2.mjs` prints bandwidths for `[ɑ]`,
      `[i]`, `[u]` (closed glottis) within 35 % of the Hawks & Miller column.
      Not met: the audit prints the bandwidths with the Hawks & Miller column
      and the error, but B2 of `[ɑ]` (+64 %), B2 (−37 %) and B3 (−40 %) of
      `[i]`, B2 (+46 %) and B3 (−42 %) of `[u]` are outside 35 %. A larger loss widens the narrow
      formants together with the wide ones, so no `LOSS_SHAPE`,
      `RADIATION_BAFFLE` or `LOSS_STAGES` fits all of them
      (`experiments/issue-36-audit-scan.txt`).
- [x] The sentence of the audit renders at most 8 % slower on tier `medium`.
      (3.0 %, median of 7 processes; `experiments/issue-36-render-speed.txt`.)
- [x] The vowel formant tests in `tests/acoustics.test.js`,
      `tests/head-presets.test.js` and `tests/fdtd3d.test.js` pass.
- [x] The new tests exist and pass on Node.js, Bun and Deno.
- [x] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Losses in the 3D solver: it keeps its wall admittance; only its vowel table is
  re-fitted (step 8). Sound radiated through the skin of the neck and cheeks.
- Losses of the nose and the sinuses: {{P72}}. Losses at the glottis: {{P22}}.
- The 2D solver, which reuses `losses.js`: {{P25}}. Voice files: {{P29}}.

## References

- Hawks, J. W., & Miller, J. D. (1995). A formant bandwidth estimation procedure
  for vowel synthesis. Journal of the Acoustical Society of America 97(2),
  1343-1344.
- Fant, G. (1972). Vocal tract wall effects, losses, and resonance bandwidths.
  STL-QPSR 13(2-3), 28-52.
- Fujimura, O., & Lindqvist, J. (1971). Sweep-tone measurements of vocal-tract
  characteristics. Journal of the Acoustical Society of America 49(2B), 541-558.
- Ishizaka, K., French, J. C., & Flanagan, J. L. (1975). Direct determination of
  vocal tract wall impedance. IEEE Transactions on Acoustics, Speech, and Signal
  Processing 23(4), 370-373.
- Maeda, S. (1982). A digital simulation method of the vocal-tract system.
  Speech Communication 1(3-4), 199-229. doi:10.1016/0167-6393(82)90017-6
- Flanagan, J. L. (1972). Speech Analysis, Synthesis and Perception (2nd ed.).
  Springer.
- Research notes: `docs/case-studies/issue-11/research/` note 5 (part B).
