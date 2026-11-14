---
id: P25
title: 2D acoustic tier between the waveguide and 3D
type: Feature
milestone: M2
blocked_by: []
requirements: [R1, R3, R12, R18]
---

## Goal

Add a third kind of solver, a two-dimensional grid with a depth value per cell
(`fdtd2d`), and a new audio tier `enhanced` that uses it. The tier must cost
less than half of tier `high` and must reproduce what the 1D waveguide cannot:
resonances across the tract and air paths beside the tongue.

## Why

Between tier `medium` (1D, real-time factor 0.14 on the audit machine) and tier
`high` (3D, 1.32) the cost jumps by a factor of 9. Many machines can afford more
than `medium` but not `high` in real time. A 1D model is exact only while the
sound wave is flat across the tube; above 4 to 5 kHz it is not (Blandin et al.
2015), and a lateral consonant like `[l]` has two side channels that 1D cannot
describe. A 2D model with tuned depth keeps most of the 3D behaviour for a
fraction of the cost (Mullen et al. 2006; Arnela & Guasch 2014; Mohapatra et al.
2019).

## Current state

- `SOLVERS` in `src/acoustics/voice.js` has `waveguide`, `fdtd3d` and the GPU
  variant; `registerSolver(name, factory)` adds more. A solver has `setShape()`,
  `step()`, `stepDuration()` and `field()`.
- `AUDIO_TIERS` in `src/perf/lod.js` is `minimal`, `low`, `medium` (waveguide;
  cost 1, 1.6, 2.6), then `high`, `ultra`, `studio`, `reference` (3D; cost 10,
  65, 105, 220). `LodGovernor` moves between neighbours by `cost`.
- `VOWEL_TABLES` in `voice.js` holds a correction table per solver (only
  `fdtd3d` has one).
- The plan channel `lateral` (1 for `[l]`) exists but `tractShape()` does not
  use it; a lateral is only a narrow place of 0.28 cm².
- The 3D solver uses a fixed Courant number (`COURANT = 0.5`), its own time step
  `dt = COURANT * dx / SPEED_OF_SOUND`, and resamples to the output rate.

## What to do

1. Geometry. Create `src/acoustics/sheet-model.js` exporting
   `buildSheet(head, options)` and `updateSheet(sheet, shape)`. The grid lies in
   the plane "along the tract × left-right": `x` runs from the glottis to the
   lips, `y` from the left wall to the right wall, cell size `dx` (default 0.6
   cm). Each cell has a depth `h` in cm (the extent in the third direction).
   - Width of the tract at position `x`:
     `w(x) = min(W(x), sqrt(4 * area / (PI * 0.4)))`, where `W(x)` is the
     largest width allowed by the head (pharynx: `3.2 * head.pharynxWidth` cm,
     mouth: `4.5 * head.oralWidth` cm, lips: `head.mouthWidth`-scaled 4 cm; a
     linear blend over 2 cm between the regions). The second term keeps the
     depth at least 0.4 times the width.
   - Depth across the width is an ellipse:
     `h(x, y) = h0 * sqrt(1 - (2 * y / w)^2)` with `h0 = 4 * area / (PI * w)`,
     so that the integral of `h` over `y` is the area. Sample it per cell as the
     mean over the cell. After sampling, scale each column so that `sum(h) * dx`
     equals the area exactly.
   - Cells with `h < 0.02` cm are walls. The grid has `ceil(maxWidth / dx) + 2`
     rows; it never changes size, only `h` changes.
   - Lateral: with the channel value `lateral` = 1, set `h = 0` in the middle
     third of the width at the tongue constriction (three columns) and scale the
     outer cells to keep the area. Add `lateral` to the object returned by
     `tractShape()`.
   - Piriform fossae and vallecula: use the existing 1D side branches of
     `src/acoustics/sinuses.js`, attached to the column given by their `index`.
     The nose: move the nose line of `Waveguide` (arrays `nose*`,
     `#scatterNose()`) into a class `NoseLine` in `src/acoustics/nose-line.js`,
     used by both solvers; couple it at the velum column with the port area.

2. Solver. Create `src/acoustics/fdtd2d.js` with the class `Fdtd2d` (same public
   methods as `Fdtd3d`). Pressure `p` sits in the cell centres, the velocities
   `vx`, `vy` on the faces. With `hf` the depth of a face (harmonic mean
   `2 * h1 * h2 / (h1 + h2)` of its two cells, 0 if one is a wall),
   `rho = AIR_DENSITY`, `c = SPEED_OF_SOUND`:

   ```
   vx += -(dt / (rho * dx)) * (p[i+1][j] - p[i][j])
   vy += -(dt / (rho * dx)) * (p[i][j+1] - p[i][j])
   p[i][j] += -(rho * c^2 * dt / (dx * h[i][j]))
              * (hf_e * vx_e - hf_w * vx_w + hf_n * vy_n - hf_s * vy_s)
   ```

   (`e`, `w`, `n`, `s` are the four faces of the cell.) Time step
   `dt = COURANT_2D * dx / c`, `COURANT_2D = 0.68` (the limit is 0.707). Use
   typed arrays and precomputed coefficients `hf / h`; recompute them in
   `setShape()`.
   - Glottis: the first column is driven like `sourceCells` of `Fdtd3d`, with
     the same termination admittance.
   - Walls: the wall admittance of `Fdtd3d` (head parameter `wallLoss`) on faces
     next to wall cells, plus a loss on every cell in proportion to `dx / h` for
     the two flat sides that the grid does not see.
   - Lips: sum the flow through the last column and terminate it with
     `Radiation` (`src/acoustics/radiation.js`) for the lip area.
   - Noise: add the frication source as a pressure difference across the faces
     at `frication.position`, as `Waveguide.step()` does.
   - `stepDuration(shape)` returns `dt * shape.length / restLength`, as in
     `Fdtd3d`.

3. Register it: `registerSolver('fdtd2d', ...)` in `voice.js`; CLI
   `--solver fdtd2d` and `--dx`.

4. Fit a vowel table. Copy `experiments/fdtd-formants.mjs` to
   `experiments/issue-11-fdtd2d-formants.mjs`, measure the formants of the
   eleven vowels of `STORY_LENGTHS` and add `VOWEL_CORRECTIONS_2D` to
   `src/articulation/vowel-calibration.js` only if a formant is off by more than
   3 %.

5. Compare with 3D. `experiments/issue-11-fdtd2d-compare.mjs` (output committed
   as `.txt`) prints, for the eleven vowels, the log-spectral distance in dB
   between the transfer functions (impulse response, 4 to 8 kHz, 50 Hz steps) of
   `fdtd2d` and `fdtd3d` with `dx` 0.5, and of the waveguide and the same 3D
   reference; and the render time of the audit sentence for `medium`, `fdtd2d`
   and `high`.

6. Decide. If the mean distance of `fdtd2d` to 3D is smaller than that of the
   waveguide, and the render time is at most half of `high`, add the tier after
   `medium`:

   ```js
   { name: 'enhanced', solver: 'fdtd2d', dx: 0.6, sampleRate: 48000, cost: 5 }
   ```

   with `cost` measured by `experiments/issue-5-tier-costs.mjs`. If the time is
   too long, raise `dx` (up to 0.8). If the distance is not smaller, do not add
   the tier: keep the solver registered, and report both numbers in the pull
   request.

7. Adding a tier shifts the numeric levels above `medium`. Check every use of a
   level number (`grep -rn "AUDIO_TIERS\[" src examples tests`, `maxLevel`,
   stored settings of the app in `examples/universal-app`) and the tier lists in
   `README.md`, `src/index.d.ts` and the CLI help.

## Tests

Create `tests/fdtd2d.test.js`:

- `keeps the area of every column`: for the shapes of `[ɑ]`, `[i]`, `[u]`,
  `sum(h) * dx` equals the area within 1e-9 for every column.
- `resonates like a uniform tube`: 17.5 cm of 3 cm²: the first three formants
  are within 3 % of `tubeFormants()`.
- `follows the area function`: F1 to F3 of `[ɑ]`, `[i]`, `[u]` are within 5 % of
  the waveguide.
- `shows a resonance across a wide tube`: a tube 6 cm wide and 1 cm deep, driven
  in one corner only, has a peak within 8 % of `c / (2 * 6)` = 2917 Hz; the
  waveguide for the same area has no peak within 300 Hz of it.
- `lets the air pass beside the tongue`: for `[l]` the middle cells of the
  constriction columns have `h = 0`, the outer cells do not, and the area is
  kept.
- `is stable and about as loud as the waveguide`:
  `synthesize('ˈama', {ipa: true, solver: 'fdtd2d'})` is finite; its RMS is
  within 3 dB of tier `medium`; the nasal is quieter than the vowels.
- `runs slower for a longer tract`: `stepDuration()` grows in proportion to
  `shape.length`.

In `tests/library.test.js` the existing test that `cost` rises along
`AUDIO_TIERS` must pass; add `places the 2D tier between medium and high` (only
if step 6 added the tier). In `tests/cli-audio.test.js` add
`renders with the 2D solver`.

## Acceptance criteria

- [ ] `experiments/issue-11-fdtd2d-compare.txt` is committed with the two mean
      distances and the three render times.
- [ ] The render time of `fdtd2d` in that file is at most 0.5 times that of
      `high`.
- [ ] `node bin/voice-simulator.js "Hello." --solver fdtd2d --out /tmp/e.wav`
      writes a file; `voice-simulator match` reads its pitch within 5 % of the
      `medium` file.
- [ ] The pull request states the decision of step 6 with both numbers; if the
      tier was added, `--tier enhanced` works and `AUDIO_TIERS` has 8 entries.
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- A bent tract in the midsagittal plane and free air around the head: the 3D
  tiers have both.
- A WebAssembly or GPU kernel for the 2D solver and its Rust port: {{P70}}.
- Frequency-dependent wall losses: {{P24}} (reuse its `losses.js` when merged).
- The narrow-band tiers below `minimal`: {{P14}}. Real-time factor tracking:
  {{P19}}.

## References

- Mullen, J., Howard, D. M., & Murphy, D. T. (2006). Waveguide physical modeling
  of vocal tract acoustics: flexible formant bandwidth control from increased
  model dimensionality. IEEE Transactions on Audio, Speech, and Language
  Processing 14(3), 964-971. doi:10.1109/TSA.2005.858052
- Mullen, J., Howard, D. M., & Murphy, D. T. (2007). Real-time dynamic
  articulations in the 2-D waveguide mesh vocal tract model. IEEE Transactions
  on Audio, Speech, and Language Processing 15(2), 577-585.
  doi:10.1109/TASL.2006.876751
- Arnela, M., & Guasch, O. (2014). Two-dimensional vocal tracts with
  three-dimensional behavior in the numerical generation of vowels. Journal of
  the Acoustical Society of America 135(1), 369-379. doi:10.1121/1.4837221
- Mohapatra, D. R., Zappi, V., & Fels, S. (2019). An extended two-dimensional
  vocal tract model for fast acoustic simulation of single-axis symmetric
  three-dimensional tubes. Interspeech 2019. doi:10.21437/Interspeech.2019-1764
- Blandin, R., Arnela, M., Laboissière, R., Pelorson, X., Guasch, O., Van
  Hirtum, A., & Laval, X. (2015). Effects of higher order propagation modes in
  vocal tract like geometries. Journal of the Acoustical Society of America
  137(2), 832-843. doi:10.1121/1.4906166
- Research notes:
  `docs/case-studies/issue-11/research/5-performance-and-physics.md`.
