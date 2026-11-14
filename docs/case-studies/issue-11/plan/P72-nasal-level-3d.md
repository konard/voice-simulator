---
id: P72
title: Nasal consonants are about four times louder in the 3D solver
type: Bug
milestone: M2
blocked_by: []
requirements: [R1, R18]
---

## Goal

The murmur of a nasal consonant (`[m]`, `[n]`, `[ŋ]`) must be weaker than the
vowel next to it, by the same amount in every solver. Target: in `ˈama` the RMS
of the `[m]` divided by the RMS of the first `[a]` is 0.25 to 0.5 (-12 to -6 dB)
on every tier, and the 3D tiers are within 3 dB of the waveguide.

## Why

In real speech a nasal murmur is several dB weaker than the open vowel next to
it (table of relative intensities in Fry 1979): the sound leaves only through
the narrow, soft-walled nose. On the default tier (`studio`, 3D) the nasals are
louder than the vowels, which is heard at once and breaks any comparison with
recordings ({{P07}}, {{P51}}).

## Current state

Reproduce with `node experiments/issue-11-audit.mjs` (item 7):

```
nasal/vowel level medium: {"ratio":0.32}
nasal/vowel level high: {"ratio":1.22}
```

`node experiments/issue-11-audit-m2.mjs` (output in the `.txt` next to it)
splits the output into the flow from the lips and from the nostrils (RMS,
arbitrary units) in the middle of the vowel and of the nasal:

```
ama waveguide 44: {"vowelLips":0.4891,"vowelNose":0.4925,"nasalLips":0,
  "nasalNose":0.2815,"audioVowel":0.263,"audioNasal":0.0832,"ratio":0.32}
ama fdtd3d dx 1: {"vowelLips":0.3572,"vowelNose":0.2519,"nasalLips":0,
  "nasalNose":0.6373,"audioVowel":0.1526,"audioNasal":0.1854,"ratio":1.22}
ama fdtd3d dx 0.6: {... "ratio":1.66}
ama velar port area: {"vowel":0.037,"nasal":1.2681,"firstNoseSection":0.6}
```

The title blames the 3D solver, but the measurements show that **both** solvers
are wrong and that the waveguide's 0.32 is an accident.

**Cause 1 (waveguide): the velar port does not conserve volume flow.**
`#scatterVelum()` in `src/acoustics/waveguide.js` joins three tubes: the pharynx
(area `a`), the mouth (`b`) and the nose branch with `c = this.velumArea`:

```js
const pressure =
  (2 * (a * fromLeft + b * fromRight + c * fromNose)) / (a + b + c);
this.noseJunctionRight[0] = pressure - fromNose;
```

The wave then travels in nose section 0, whose area is `noseAreas[0]` (0.6 cm²
times `nasalSize`, from `NOSE_PROFILE` in `src/articulation/tract-shape.js`),
not `c`, and there is no junction between the two areas (`#scatterNose()` starts
at index 1). Flow is wave amplitude times area, so the flow in the branch is
multiplied by `noseAreas[0] / c`. Evidence: the gain from glottal flow to
radiated flow at 50 Hz, where all the flow that enters must come out, so that an
open mouth and a closed mouth with an open port must give the same gain:

```
gain dB waveguide 44 [a]: {"50":5.3,"100":5.51,"250":6.87,...}
gain dB waveguide 44 [m]: {"50":-5.27,"100":-4.9,"250":-1.87,...}
gain dB fdtd3d dx 1 [a]: {"50":-0.2,"100":0.07,"250":2.16,...}
gain dB fdtd3d dx 1 [m]: {"50":-0.08,"100":0.58,"250":6.78,...}
```

The 3D solver gives 0 dB twice, as it must; the waveguide is 10.6 dB apart. The
arithmetic fits: for `[m]`, `20 * log10(0.6 / 1.268) = -6.5 dB` plus 1.2 dB from
the glottal end (`2 / (1 + GLOTTAL_REFLECTION)`) gives -5.3 dB. In the vowel the
port is 0.037 cm² but section 0 is 0.6 cm², so the leak is multiplied by 16: the
nostrils radiate as much as the lips and the vowel is about 4 dB too loud.

The same error makes the waveguide murmur weaker when the port opens wider,
which is the wrong direction (ratio 1.23, 0.81, 0.32, 0.21 for `nasalCoupling`
0.25, 0.5, 1, 2; 3D: 1.65, 1.41, 1.22, 1.15).

**Cause 2 (both solvers): the nose has the losses of a smooth round tube.** Both
use `lossFactor(area, wall)` of `waveguide.js` for the nose as for the mouth.
The real nasal cavity is split by the septum and filled by the turbinates: for
the same area the wall surface is several times larger, and the mucosa is soft
(Dang, Honda & Suzuki 1994). The paranasal sinuses, which take energy out near
their resonances, are not modelled. With cause 1 fixed, the waveguide should
give a ratio near 1.1 (murmur +6.5 dB, vowel -4 dB), close to the 3D value.

**Cause 3 (3D, not yet explained): the ratio grows on a finer grid**, 1.22 at
`dx` 1 cm and 1.66 at 0.6 cm. Also, during the vowel the 3D nostrils carry a
flow of 0.25 against 0.36 at the lips although the port is 0.037 cm².

Ruled out by the same script: sound leaking from the lips during the murmur (lip
flow is 0 in both solvers), the wall loss (`wallLoss` 0 and 3 give 0.30 and 0.32
in 1D, 1.29 and 1.14 in 3D), the piriform fossae and the vallecula (1.25 without
them), the output mode (1.30 with the microphone output).

## What to do

1. Fix the port of the waveguide. Nose section 0 is the port, so give it the
   area of the port. In `Waveguide.setShape()`, after `this.velumArea` is set:
   `this.noseAreas[0] = Math.max(MIN_AREA, this.velumArea)`,
   `this.noseDamping[0] = this.#loss(this.noseAreas[0])`, and recompute
   `this.noseReflection[1]` from `noseAreas[0]` and `noseAreas[1]`. `setNose()`
   must not overwrite section 0 afterwards (store the nose profile and apply the
   port in one private method called by both). A port wider than the first nose
   section is allowed.

2. Add a test helper `lowFrequencyGain(solver, shape)` (at the top of the test
   file): feed a 50 Hz sine of amplitude 1 as glottal flow for 0.4 s and return
   the amplitude of the 50 Hz part of the output in the last 0.2 s. This is the
   check that would have caught cause 1.

3. Add the nasal branch to the chain-matrix reference in
   `src/acoustics/transfer.js`:
   `tubeTransfer(areas, length, frequency, options)` accepts
   `options.nose = {areas, length, velumArea, velumIndex}` and returns the sum
   of the lip flow and the nostril flow. Treat the branch as `branchMatrix()`
   treats the piriform fossae, but end it with `radiationImpedance()` of the
   nostril area. This reference is independent of both solvers.

4. Explain cause 3 with measurements before changing the 3D code. Add a part to
   `experiments/issue-11-audit-m2.mjs` that prints, for `dx` 1, 0.6 and 0.5 cm
   and a static `[m]` shape:
   - the number of velum links and `portArea` (`velumLinks.length * dx * dx`) in
     `Fdtd3d`, next to the requested `velumArea`;
   - the sum of `conductance * dx * dx` over the velum links and over the
     nostril links (the effective areas), next to `noseAreas` at both ends;
   - the frequency, peak gain and -3 dB bandwidth of the lowest resonance of the
     transfer function (impulse response, 0.25 s), next to those of step 3;
   - for `[a]` with `velumArea = 0`: nostril flow against lip flow. If it is not
     near 0, the nostril links pick up the sound field outside the lips; then
     sum the flow output along the outward normal only.

   Fix what the numbers show. Likely places: `linkKind()` in
   `src/acoustics/voxel-model.js` (which links count as velum and nostril
   links), the `open` factor of the velum links in `fdtd3d.js`, and the loss
   `exponent` (defined per waveguide section, not per cell). After the fix the
   effective areas must be within 15 % of the requested areas at every `dx`.

5. Add the missing nasal loss as a head parameter `nasalLoss` in
   `src/head-config.js` (group `acoustics`, no unit, range 1 to 8, step 0.1,
   default 3 as a starting value): "Wall losses of the nasal cavity relative to
   a smooth round tube of the same area." Use it in both solvers for nose
   sections and nose cells: `lossFactor(area, head.wallLoss * head.nasalLoss)`.
   Its physical meaning is the wetted perimeter of the nose divided by that of a
   circle of the same area; coronal sections give about 2 to 6.

6. Calibrate. Set the default of `nasalLoss` (and nothing else) so that the
   target of the Goal holds for the waveguide with 44 sections and for 3D at
   `dx` 1 and 0.6 cm. If no value in the range reaches it, add a second
   parameter `sinusLoss` only after showing with step 3 that a Helmholtz side
   branch (maxillary sinus: about 15 cm³, opening 0.1 cm², neck 0.6 cm, which
   resonates near 500 Hz) gives the missing loss. Do not add an unexplained
   gain.

7. Vowels next to nasals and nasalised vowels change level. Re-run
   `experiments/issue-9-preset-fit.mjs` and the vowel table tests; re-fit
   `VOWEL_CORRECTIONS_3D` only if a formant test fails.

## Tests

Add to `tests/acoustics.test.js`, in `waveguide synthesis`:

- `conserves flow through the velar port`: `lowFrequencyGain()` of a static
  `[m]` shape is within 1 dB of the gain of a static `[a]` with `velumArea = 0`.
- `leaks little through a nearly closed port`: for a static `[a]` with
  `velumArea = 0.04`, the RMS of `solver.noseOutput` is below 0.25 times the RMS
  of `solver.lipOutput` (0.2 s of white noise low-passed at 1 kHz as glottal
  flow). Today the two are equal.
- `keeps the nasal murmur below the vowel`: in
  `synthesize('ˈama', {ipa: true, tier: 'medium', seed: 1})` the RMS over 30 ms
  in the middle of the `[m]` is 0.25 to 0.5 times that of the first vowel.

Add to `tests/fdtd3d.test.js`, in `3D FDTD rendering`:

- `keeps the nasal murmur as weak as the waveguide`: the same ratio on tier
  `high` is between 0.25 and 0.5 and within 3 dB of the `medium` value.
- `opens the velar port by the requested area`: for `dx` 1 and 0.6 the effective
  port area of step 4 is within 15 % of `velumArea` 0.3, 0.8 and 1.3 cm².

Add to `tests/radiation.test.js`: `adds a nasal branch to the tube transfer`:
with `options.nose`, the gain at 50 Hz is within 0.5 dB of the gain without the
branch, and the transfer of `[m]` has its lowest peak between 200 and 500 Hz.

Add `nasalLoss` to the list in `tests/head-parameters.test.js`; a higher value
must lower the level of `[m]`.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit-m2.mjs` prints an `ama` ratio between
      0.25 and 0.5 for `waveguide 44`, `fdtd3d dx 1` and `fdtd3d dx 0.6`, and
      the largest of the three is at most 1.41 times the smallest (3 dB).
- [ ] The same script prints 50 Hz gains of the waveguide for `[a]` and `[m]`
      that differ by less than 1 dB, and a `nasalCoupling` sweep (0.25, 0.5,
      1, 2) that changes the ratio in the same direction in both solvers.
- [ ] The ratio at `dx` 0.5 cm (tier `studio`) is measured once by hand, is
      inside 0.25 to 0.5, and is written into the pull request.
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Frequency-dependent wall losses and yielding walls for the whole tract:
  {{P24}}; `nasalLoss` stays a multiplier there.
- Paranasal sinuses with their own anti-resonances, beyond step 6.
- Nasal frication and noise at the nostrils: {{P23}}. Voice files: {{P29}}.

## References

- Dang, J., Honda, K., & Suzuki, H. (1994). Morphological and acoustical
  analysis of the nasal and the paranasal cavities. Journal of the Acoustical
  Society of America 96(4), 2088-2100.
- Stevens, K. N. (1998). Acoustic Phonetics. MIT Press. Chapter 9 (nasals).
- Fry, D. B. (1979). The Physics of Speech. Cambridge University Press.
- Research notes: note 5 in `docs/case-studies/issue-11/research/`.
