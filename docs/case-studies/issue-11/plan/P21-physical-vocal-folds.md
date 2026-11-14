---
id: P21
title: Physical vocal-fold model driven by lung pressure
type: Feature
milestone: M2
blocked_by: []
requirements: [R1, R5, R9, R18]
---

## Goal

Add a second voice source that simulates the vocal folds as masses on springs,
set into vibration by air from the lungs. Pitch, loudness and voice quality then
follow from lung pressure, fold tension and how firmly the folds are closed, as
in a real larynx. The source is selected with `source: 'folds'`; the present LF
source stays available as `source: 'lf'` and stays the default in this issue.

## Why

The LF source draws a fixed pulse shape. It cannot produce what real folds do by
themselves: a voice that starts and stops gradually, that stops when the
pressure across the glottis drops in a consonant, that gets brighter when
louder, and that reacts to the vocal tract ({{P22}}). Vocal effort ({{P40}}),
phonation types ({{P42}}) and emotions ({{P43}}) need these controls, and a fit
of a real voice ({{P51}}) needs parameters with a physical meaning.

## Current state

`src/acoustics/glottis.js` exports the class `Glottis`. `VoiceRenderer`
(`src/acoustics/voice.js`) calls `this.glottis.step(dt, control, noise)` once
per solver step; `control` is `{f0, voicing, aspiration, closure, loudness}`
from the plan channels `f0`, `voicing`, `aspiration`, `glottalClosure` and
`loudness`. The returned number is the **derivative of the glottal flow** (the
solvers radiate flow, so a flow-derivative source gives sound pressure). The
pulse is the LF model (Fant, Liljencrants & Lin 1985) with a shape that depends
only on the head parameter `tenseness`. The frequency is whatever the plan asks
for; lung pressure does not exist. The plan (`src/articulation/plan.js`) has 21
channels at `CONTROL_RATE = 200` Hz; none of them is a lung pressure, an
adduction or a fold tension.

## What to do

1. Create `src/acoustics/folds.js` exporting the class `VocalFolds` with the
   same interface as `Glottis`: `constructor(options)`,
   `step(dt, control, noise)` returning the flow derivative, `reset()`, and the
   fields `intensity` and `noiseModulation` that `VoiceRenderer` reads.
   `control` gets three more fields: `lungPressure` (Pa), `adduction` (0 to 1)
   and `foldTension` (no unit).

2. Implement the symmetric two-mass model of Steinecke & Herzel (1995), a
   simplified form of Ishizaka & Flanagan (1972). Each fold is a lower mass
   (index 1) and an upper mass (index 2). Use cgs units inside the file (cm, g,
   s, dyn); 1 Pa = 10 dyn/cm². For `i` in {1, 2} and `j` the other index:

   ```
   m_i * x_i'' + r_i * x_i' + k_i * x_i + kc * (x_i - x_j)
       + collision_i = F_i
   a_i = a0_i + 2 * L * x_i              area between the masses (cm²)
   collision_i = c_i * a_i / (2 * L)     only when a_i < 0, else 0
   a_min = max(0, min(a_1, a_2))         glottal area (cm²)
   P_1 = Ps * (1 - (a_min / a_1)^2)      when a_1 > 0, else 0
   F_1 = L * d_1 * P_1,   F_2 = 0
   U = a_min * sqrt(2 * Ps / rho)        glottal flow (cm³/s)
   ```

   `x_i` is the displacement of mass `i` from rest (cm), `L` the fold length,
   `d_i` the thickness of mass `i`, `Ps` the lung pressure (dyn/cm²),
   `rho = AIR_DENSITY`. The air jet separates at the narrowest point, so no
   pressure acts on the upper mass (`F_2 = 0`). Default values (Steinecke &
   Herzel 1995, table of standard parameters), each an exported constant:

   | Symbol       | Value        | Unit   |
   | ------------ | ------------ | ------ |
   | `m_1`, `m_2` | 0.125, 0.025 | g      |
   | `k_1`, `k_2` | 80000, 8000  | dyn/cm |
   | `kc`         | 25000        | dyn/cm |
   | `r_1`, `r_2` | 20, 20       | g/s    |
   | `c_1`, `c_2` | 3 k_1, 3 k_2 | dyn/cm |
   | `d_1`, `d_2` | 0.25, 0.05   | cm     |
   | `L`          | 1.4          | cm     |
   | `a0_1, a0_2` | 0.05, 0.05   | cm²    |

3. Tension. `foldTension` is the factor `Q` of Ishizaka & Flanagan: use
   `k_i * Q`, `kc * Q`, `m_i / Q` and `d_i / Q`. The pitch is then close to
   proportional to `Q` (about 120 Hz at `Q = 1`). Allowed range 0.4 to 5.

4. Adduction. `adduction` sets the rest area `a0_1 = a0_2` by linear
   interpolation in the table (0 → 0.30 cm², 0.25 → 0.10, 0.5 → 0.05, 1 →
   -0.02). 0.5 is a modal voice, lower is breathy, 0 is the open glottis of a
   voiceless sound, 1 is a pressed voice (folds pushed together at rest).

5. Time stepping. Use the semi-implicit Euler method (first the velocities from
   the forces, then the positions from the new velocities). Split each call of
   `step(dt, ...)` into `n = Math.ceil(dt * FOLD_RATE)` equal sub-steps,
   `FOLD_RATE = 44100`: the stiffest case (`Q = 5`, in collision) has about 8000
   rad/s, ten times below the stability limit `omega * dt < 2`. Return
   `(U_new - U_old) / dt * FOLDS_FLOW_SCALE`; choose `FOLDS_FLOW_SCALE` once so
   that the RMS of a steady vowel at 800 Pa, `Q = 1`, `adduction = 0.5` equals
   the RMS of the LF source at its defaults.

6. Noise. Add the breath noise as `Glottis` does, but modulate it by the area:
   `modulation = Math.min(1, a_min / 0.1)`. ({{P23}} replaces this by a
   flow-based law.)

7. Plan channels. In `src/articulation/plan.js` add to `CHANNELS` (time
   constants in s) and `CHANNEL_DEFAULTS`: `lungPressure` (0.04, default 800),
   `adduction` (0.015, default 0.5), `foldTension` (0.03, default 1). Fill them
   in `planUtterance()`:
   - `lungPressure = head.lungPressure * loudness ** (2 / 3)` (sound level rises
     about 9 dB per doubling of lung pressure, Titze & Sundberg 1992, so
     amplitude goes with pressure to the power 1.5);
   - `adduction` as below, lowered to at most 0.2 where `aspiration` is 1 and
     set to 1 where `glottalClosure` is 1:

     ```
     tense     = 0.6 * (head.tenseness - 0.6)
     breathy   = 0.3 * (head.breathiness - 0.2)
     adduction = voicing * clamp(0.5 + tense - breathy, 0.25, 1)
     ```

   - `foldTension = tensionForPitch(f0, lungPressure, head)`, exported by
     `folds.js`, which inverts a table of measured pitch: at first use, simulate
     0.15 s for `Q` in 0.4, 0.6, ... 5 and pressures 400, 800 and 1600 Pa, count
     the upward zero crossings of `U - mean(U)` over the last 0.1 s, cache the
     table per head, and interpolate.

8. Head parameters in `src/head-config.js` (group `source`): `lungPressure` (Pa,
   300 to 2000, default 800), `foldLength` (cm, 0.6 to 1.8, default 1.4),
   `foldMass` (factor on `m_i`, 0.5 to 2, default 1), `foldStiffness` (factor on
   `k_i` and `kc`, 0.5 to 2, default 1), `foldDamping` (factor on `r_i`, 0.5 to
   3, default 1). Give the presets in `src/head-presets.js` a `foldLength`
   range: male 1.4 to 1.6, female 0.9 to 1.1, child 0.6 to 0.8 (Titze 1989).

9. Selection. `VoiceRenderer` accepts `source: 'lf' | 'folds'` (constant
   `DEFAULT_SOURCE = 'lf'` exported by `voice.js`). Pass the option through
   `prepareUtterance()` in `src/synthesize.js`, add the CLI option
   `--source <lf|folds>` to `OPTIONS` in `bin/voice-simulator.js` and document
   it in `README.md`. An unknown value throws `Unknown source: <value>`.

10. Add `experiments/issue-11-folds.mjs` (output committed as `.txt`) that
    prints, for the default head: the phonation threshold pressure (lowest
    pressure in steps of 25 Pa at which the flow still oscillates after 0.3 s),
    the pitch for `Q` 0.5, 1, 2 and 4, and the open quotient (share of the
    period with `a_min > 0`) and H1-H2 for `adduction` 0.3, 0.5, 0.7 and 0.9.

## Tests

Create `tests/folds.test.js` (helper: run `VocalFolds.step()` at 44100 Hz with
constant controls and no noise, return the flow `U` per sample through a public
getter `flow`):

- `oscillates at conversational lung pressure and not far below it`: at 800 Pa,
  `Q = 1`, `adduction = 0.5` the pitch is between 90 and 160 Hz; at 100 Pa the
  peak-to-peak flow in the last 0.1 s of 0.4 s is below 1 % of the 800 Pa value.
- `has a phonation threshold in the human range`: the threshold of the
  experiment is between 150 and 600 Pa (Titze 1988: about 200 to 500 Pa).
- `raises the pitch with tension`: the pitch for `Q` 0.5, 1, 2, 4 rises at every
  step, and `pitch(2) / pitch(1)` is between 1.6 and 2.4.
- `goes from breathy to pressed with adduction`: for `adduction` 0.3, 0.5, 0.7,
  0.9 the open quotient falls at every step, is above 0.7 at 0.3, and is at
  least 0.15 lower at 0.9 than at 0.3.
- `gets louder with lung pressure`: RMS of the returned source at 1600 Pa is 4
  to 12 dB above the value at 800 Pa.
- `starts and stops by itself`: from rest at 800 Pa the flow reaches half of its
  steady peak-to-peak value within 60 ms; after the pressure is set to 0 it is
  below 5 % within 40 ms.
- `does not depend on the step size`: pitch at `FOLD_RATE` 44100 and 88200
  differs by less than 1 %.
- `finds the tension for a pitch`: for 90, 120, 200 and 300 Hz at 800 Pa,
  simulating with `tensionForPitch()` gives the pitch within 3 %.

Add to `tests/acoustics.test.js`: `speaks with the fold source`:
`synthesize('ma', {ipa: true, tier: 'minimal', source: 'folds'})` is finite, has
`|sample| <= 1`, a measured `f0` within 8 % of the same call with
`source: 'lf'`, and an RMS within 3 dB of it. Add to `tests/cli-audio.test.js`:
`--source folds` writes a WAV file; `--source x` exits with a non-zero code.

## Acceptance criteria

- [ ] `node bin/voice-simulator.js "Hello." --source folds --out /tmp/f.wav`
      writes a file, and `voice-simulator match /tmp/f.wav` reports a pitch
      within 8 % of the `--source lf` file.
- [ ] `experiments/issue-11-folds.txt` is committed: threshold between 150 and
      600 Pa, pitch rising with `Q`, open quotient falling with `adduction`.
- [ ] The audit sentence on tier `medium` with `source: 'folds'` takes at most
      15 % longer than with `source: 'lf'` (median of 5 runs).
- [ ] With `source: 'lf'` (the default) the audio is bit-identical to the audio
      before this change.
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Feeding the pressure of the vocal tract and of the trachea back into the
  folds, and making `'folds'` the default: {{P22}}. Flow noise: {{P23}}.
- Creaky voice, falsetto and other registers as modes: {{P42}}. If the two-mass
  model cannot reach them, {{P42}} adds the body-cover model of Story & Titze
  (1995) behind the same interface.
- The voice file and the editor: {{P29}}. The Rust port: {{P70}}.

## References

- Ishizaka, K., & Flanagan, J. L. (1972). Synthesis of voiced sounds from a
  two-mass model of the vocal cords. Bell System Technical Journal 51(6),
  1233-1268. doi:10.1002/j.1538-7305.1972.tb02651.x
- Steinecke, I., & Herzel, H. (1995). Bifurcations in an asymmetric vocal-fold
  model. Journal of the Acoustical Society of America 97(3), 1874-1884.
- Story, B. H., & Titze, I. R. (1995). Voice simulation with a body-cover model
  of the vocal folds. Journal of the Acoustical Society of America 97(2),
  1249-1260. doi:10.1121/1.412234
- Titze, I. R. (1988). The physics of small-amplitude oscillation of the vocal
  folds. Journal of the Acoustical Society of America 83(4), 1536-1552.
- Titze, I. R. (1989). Physiologic and acoustic differences between male and
  female voices. Journal of the Acoustical Society of America 85(4), 1699-1707.
- Titze, I. R., & Sundberg, J. (1992). Vocal intensity in speakers and singers.
  Journal of the Acoustical Society of America 91(5), 2936-2946.
- Fant, G., Liljencrants, J., & Lin, Q. (1985). A four-parameter model of
  glottal flow. STL-QPSR 26(4), 1-13.
- Research notes: `docs/case-studies/issue-11/research/` note 5 (part B).
