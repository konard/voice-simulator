---
id: P28
title: Explicit jaw, larynx height and lip protrusion articulators
type: Feature
milestone: M2
blocked_by: []
requirements: [R1, R5, R17, R18]
---

## Goal

Add four articulator channels that can be set apart from the vowel: `jaw`,
`larynxHeight`, `lipProtrusion` and `tongueRoot`. Each one changes the area
function and the length of the tract at the place where the organ is. In the 3D
solver a change of length must no longer stretch the nose and the air around the
head.

## Why

A speaker can say the same vowel with a raised larynx (tense, small voice), a
lowered larynx (dark, "big" voice), spread lips (a smile is audible), pushed-out
lips or a nearly closed jaw. These are the main ways in which emotions, vocal
effort and speaker habits change the sound of the tract (Lindblom & Sundberg
1971; Sundberg & Nordström 1976). Today none of them can be set, so the later
issues on emotions and accents have nothing to drive.

## Current state

- Jaw. `teethGap(state, head)` in `src/articulation/teeth.js` computes the gap
  between the incisors from other channels:
  `REST_GAP + (OPEN_GAP * (1 - height) + BACK_GAP * back * height) * jawRange`
  (0.35, 0.8 and 0.4 cm), raised towards 0.15 cm for sibilants and tongue-tip
  stops and 0.55 cm for velars. `tractShape()` returns `jaw: openness` with
  `openness = 1 - height`. The jaw has no channel and no time constant of its
  own.
- Length. The length comes with the vowel: `STORY_LENGTHS` in
  `src/articulation/vowel-space.js` goes from 16.11 cm (`[æ]`) to 19.59 cm
  (`[u]`); `roundLips()` adds `1.1 * amount` cm; `fitToHead()` in
  `src/articulation/tract-shape.js` returns
  `shape.length * head.vocalTractLength / 17.5 + 0.5 * (head.lipThickness - 1)`.
  No channel moves the larynx or the lips alone.
- 1D. `stepDuration = shape.length / (sections * SPEED_OF_SOUND)`
  (`src/acoustics/voice.js`): all sections get longer together, and so do the
  nose line and the side branches, which run on the same time step.
- 3D. `Fdtd3d.stepDuration()` returns
  `this.dt * length / this.model.lengths[CELL_TRACT]`. The comment at the top of
  `src/acoustics/fdtd3d.js` still holds: "The voxel tract has the head's rest
  vocal tract length; the dynamic length of the larynx and lips stretches the
  time step instead … that stretch scales the nose and the air around the head
  with the tract". Between `[æ]` and `[u]` the stretch differs by 22 %.
- Face. `faceRig()` in `src/animation/visemes.js` uses
  `protrusion: PROTRUSION * rounding` (0.6 cm; the same constant is in
  `src/geometry/lips.js`) and `jawAngle(shape.teeth.gap, config)`.

## What to do

1. Channels. Add to `CHANNELS` in `src/articulation/plan.js` (or `ARTICULATORS`
   if {{P26}} is merged) and to the channel defaults:

   ```
   name           unit  meaning                          range        tau s
   jaw            cm    gap between the incisors         0.1 to 1.8   0.035
   lipProtrusion  cm    lips pushed forward              -0.3 to 1.2  0.02
   larynxHeight   cm    larynx above its place in the
                        vowel (negative: lowered)        -1.5 to 1.5  0.04
   tongueRoot     -     -1 pulled back, +1 pushed
                        forward, 0 as in the vowel       -1 to 1      0.03
   ```

   The planner writes per segment: `jaw = teethGap(target, head)` (today's
   formula on the target of the segment),
   `lipProtrusion = LIP_PROTRUSION * rounding` with `LIP_PROTRUSION = 0.6`
   exported from `tract-shape.js` (replace the two copies of `PROTRUSION`),
   `larynxHeight = 0`, `tongueRoot = 0`. The time constants are starting values
   (range 0.01 to 0.08 s).

2. Speaker habits. Add head parameters to `src/head-config.js` (group `mouth`;
   {{P29}} regroups them), each added to its channel in `tractShape()`:
   `jawPosture` (cm, -0.2 to 0.6, default 0), `lipPosture` (cm, -0.3 to 0.6,
   default 0; negative is spread lips), `larynxPosture` (cm, -1 to 1, default
   0), `tongueRootPosture` (-1 to 1, default 0).

3. Effects on the shape, in `tractShape()` and `fitToHead()`. Each effect uses
   the difference from the value of step 1, so that default channels give
   exactly today's shape:
   - Jaw: `teethGap()` returns `state.jaw` when it is defined. Multiply the
     scale of the mouth region (`0.55 < x < 0.95` in `regionScale()`) by
     `clamp(1 + JAW_AREA * (jaw - expected), 0.3, 2)`, where `expected` is
     today's formula and `JAW_AREA = 0.8` per cm (range 0.3 to 1.5).
   - Lips: `extra = lipProtrusion - LIP_PROTRUSION * rounding`. The sections of
     the last `LIP_REGION = 1.5` cm share `extra` cm of added length.
   - Larynx: the sections of the first `LARYNX_REGION = 3` cm share
     `-larynxHeight` cm of added length (a lower larynx makes the pharynx
     longer).
   - Tongue root: multiply the areas from 2 cm above the glottis to the velum by
     `1 + TONGUE_ROOT_AREA * tongueRoot`, `TONGUE_ROOT_AREA = 0.4` (range 0.2 to
     0.6).
   - No section may get shorter than 0.3 times its length. Add
     `stretchSections(areas, lengths, sections)`: it takes sections of unequal
     length and returns `sections` equal ones with the same volume in each
     stretch of the tract (mean of the area over the new section), plus the new
     total `length`. Compute `velumIndex`, the teeth, `frication.position` and
     the `index` of the side branches from distances in cm from the lips, so
     that they stay where they are when the larynx moves.

   Calibrate `JAW_AREA` so that 0.5 cm more gap raises F1 of `[ɛ]` by 8 to 15 %,
   and check the other effects against the direction and size in Lindblom &
   Sundberg (1971): 1 cm lower larynx lowers all formants, F2 of front vowels
   most.

4. 3D. Stop stretching the time step by whole centimetres:
   - In `src/acoustics/voxel-model.js` build the tract tube longer at the
     glottis end, straight down along the direction of the last centreline
     segment, by `LARYNX_TRAVEL = 0.25` times the rest length. Cells know their
     `arc`; cells below the active glottis get fill 0 (closed).
   - In `Fdtd3d`, make `sourceCells` depend on the shape: precompute the list of
     source cells for every whole-cell position of the glottis; `setShape()`
     picks the position whose active length (lips to source plane) is nearest to
     `shape.length`, with a hysteresis of 0.15 cells. Map the area function onto
     the active part only. When the position changes, set the pressure of the
     cells that open or close to 0.
   - `stepDuration()` returns `this.dt * shape.length / activeLength`. The rest
     of the stretch is then at most half a cell: 3 % at `dx` 1 cm, 1.2 % at 0.4
     cm.
   - Every change of length is then a movement of the glottis end; the lips stay
     where the face has them. Replace the comment quoted above.

5. Optional couplings, off by default (head parameters, group `prosody`):
   `intrinsicPitch` (semitones between the closest and the most open vowel, 0 to
   3, default 0; real speakers about 1.5, Whalen & Levitt 1995): in
   `fillPitch()` multiply `f0` by `2^(intrinsicPitch * (height - 0.5) / 12)`.
   `larynxPitch` (cm per octave, 0 to 1, default 0): add
   `larynxPitch * log2(f0 / head.pitch)` to `larynxHeight`.

6. Face. `faceRig()` and `src/geometry/lips.js` read `state.lipProtrusion` in
   place of `PROTRUSION * rounding`; the jaw angle already follows
   `shape.teeth.gap`. Add `larynxHeight` (cm) to the object that `faceRig()`
   returns.

7. Document the four channels and the six head parameters in `README.md` and
   `src/index.d.ts`.

## Tests

Create `tests/articulators.test.js` (formants from the impulse response of the
waveguide, 44 sections):

- `keeps the default shape`: for the eleven vowels of `STORY_LENGTHS` and for
  `[s]`, `[m]`, `[k]`, `tractShape()` with the channels of step 1 set as the
  planner sets them returns the same `areas` (within 1e-12) and `length` as with
  the four channels left out.
- `lowers all formants with a lower larynx`: `larynxHeight = -1` on `[ɑ]` makes
  `length` 1 cm longer and lowers each of F1 to F4 by 1 to 9 %.
- `lowers the upper formants with protruded lips`: 0.6 cm more `lipProtrusion`
  on `[i]` lowers F3 by at least 3 %; `lipPosture = -0.3` raises it.
- `raises F1 with a lower jaw`: `jaw` 0.5 cm above its default on `[ɛ]` raises
  F1 by 8 to 15 %.
- `narrows the pharynx with the tongue root`: `tongueRoot = -1` on `[ə]` raises
  F1 by at least 5 % and lowers F2.
- `keeps the velum in place`: with `larynxHeight = -1` the distance of
  `velumIndex` from the lips in cm changes by less than one section.
- `moves the jaw more slowly than the tongue`: in the plan of `ata` the channel
  `jaw` at the middle of `[t]` is larger than `teethGap()` of the other channels
  at that time.
- `raises the pitch of close vowels on request`: with `intrinsicPitch = 2` the
  mean `f0` of `[i]` is 1.5 to 2.5 semitones above that of `[a]`; with 0 the
  difference is below 0.1.

Add to `tests/fdtd3d.test.js` (`dx` 1):

- `keeps the nose still when the tract gets longer`: `stepDuration()` for `[u]`
  and for `[æ]` differ by less than 7 % (22 % before).
- `follows the length with the source plane`: F1 to F3 of `[u]` and `[æ]` stay
  within the tolerance that the file uses today.
- `moves the source without a click`: for a glide from `[æ]` to `[u]` in 0.3 s,
  the largest step between two output samples divided by the RMS is at most 1.5
  times that of the waveguide.

Add to `tests/visemes.test.js`: `pushes the lips out with the channel`:
`faceRig()` with `lipProtrusion = 1` returns `protrusion` 1.

## Acceptance criteria

- [ ] `node experiments/issue-11-audit.mjs` prints the same formants for the
      vowels as before (within 1 %) and a level within 0.5 dB.
- [ ] `grep -n "PROTRUSION \* rounding" src` finds nothing.
- [ ] `node experiments/issue-11-audit-m2.mjs` still runs; the ratio of `ama` in
      3D changes by less than 10 % (the nose is no longer stretched, so a small
      change is expected; report it in the pull request).
- [ ] The audit sentence is at most 5 % slower on tiers `medium` and `high`.
- [ ] The four channels and six head parameters are in the direction test of
      `tests/head-parameters.test.js`.
- [ ] The new tests exist and pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- The share of lips and larynx in the length of each measured vowel: Story
  (2008) gives only the total, so the vowel's own length stays spread evenly.
- The nose line and the side branches of the 1D solver still get longer with the
  tract (at most 6 % per cm).
- Which emotions, efforts, phonation types or accents use the channels: {{P40}},
  {{P42}}, {{P43}}, {{P45}}. Speaker fit: {{P51}}. Voice files: {{P29}}.

## References

- Lindblom, B. E. F., & Sundberg, J. E. F. (1971). Acoustical consequences of
  lip, tongue, jaw, and larynx movement. Journal of the Acoustical Society of
  America 50(4B), 1166-1179.
- Sundberg, J., & Nordström, P.-E. (1976). Raised and lowered larynx: the effect
  on vowel formant frequencies. STL-QPSR 17(2-3), 35-39.
- Story, B. H. (2008). Comparison of magnetic resonance imaging-based vocal
  tract area functions obtained from the same speaker in 1994 and 2002. Journal
  of the Acoustical Society of America 123(1), 327-335.
- Whalen, D. H., & Levitt, A. G. (1995). The universality of intrinsic F0 of
  vowels. Journal of Phonetics 23(3), 349-366.
- Research notes: `docs/case-studies/issue-11/research/` note 5.
