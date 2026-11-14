---
id: P14
title: 'Narrow-band tiers: 8, 11.025 and 16 kHz'
type: Feature
milestone: M1
blocked_by: []
requirements: [R13, R3]
---

## Goal

Add three audio tiers below `minimal` to `AUDIO_TIERS`: `telephone`
(8000 Hz), `narrowband` (11025 Hz) and `wideband` (16000 Hz). Speech at
these tiers must be free of aliasing, keep the formants F1 to F3 of the
48 kHz render, and be understood by the analysis code. The library, the
command line, the server and the app must accept the new tiers.

## Why

R13: "even at lowest audio settings ... everything should work". Today the
lowest tier is 22050 Hz and the server refuses 8000 Hz. Telephone speech is
8 kHz, and the recognition tests ({{P63}}, {{P69}}) need a tier at that
rate. R3: slow devices need cheaper steps for the streaming governor.

## Current state

- `src/perf/lod.js`: `AUDIO_TIERS` is a frozen list of
  `{name, solver, sections | dx, sampleRate, cost}`. The cheapest three are
  `minimal` (waveguide, 22 sections, 22050 Hz, cost 1), `low` (32, 32000,
  1.6), `medium` (44, 48000, 2.6). `tests/library.test.js` (line 80) checks
  that `cost` rises strictly with the index.
- The waveguide runs at `sections * 35000 / length` samples per second
  (`length` 16.5 cm at rest): 2121 Hz per section. 12 sections give
  25 455 Hz, 16 give 33 939 Hz, 22 give 46 667 Hz. The solver rate must be
  at least twice the highest frequency that is kept.
- `src/acoustics/voice.js`: `OutputStage` filters at the solver rate with
  two low-pass biquads (Q 0.54 and 1.31, fourth order) at
  `Math.min(sampleRate * 0.45, 20000)` (line 97), then the renderer takes
  output samples by linear interpolation. `VoiceRenderer` updates the tract
  every `blockSize` output samples, default 32 (line 142): 0.67 ms at
  48 kHz but 4 ms at 8 kHz. `prepareUtterance` (`src/synthesize.js`) does
  not pass `blockSize`.
- Measured (`experiments/issue-11-audit-m1.txt`), waveguide, seed 1, worst
  relative difference of F1 to F3 of `aː`, `iː`, `uː` against 44 sections
  at 48 kHz, and real-time factor (RTF) on one core:

  | sections @ rate | worst F1-F3 difference | RTF   |
  | --------------- | ---------------------- | ----- |
  | 8 @ 8000        | 22 %                   | 0.012 |
  | 12 @ 8000       | 6.8 %                  | 0.017 |
  | 16 @ 11025      | 9.5 %                  | 0.024 |
  | 22 @ 16000      | 4.1 %                  | 0.038 |
  | 22 @ 22050      | (`minimal`)            | 0.041 |

  A control interval near 1.5 ms instead of 32 samples changes the signal
  by -5.8 dB (8 kHz), -12.8 dB (11.025 kHz), -13.7 dB (16 kHz) relative to
  its level, and raises the RTF to 0.024, 0.029, 0.039.

- Aliasing: rendering `sː` with 12 sections straight at 8000 Hz has 1.5 dB
  more energy in 300 to 3400 Hz than the same render at 24000 Hz resampled
  with `resample` of `src/audio/resample.js`; `ʃː` 1.2 dB; `aː` 0.2 dB.
- `src/analysis/voice-features.js`: `analyzeVoice` does not resample input
  at or below 11025 Hz, uses LPC order `round(rate / 1000) + 1` (9 at
  8 kHz) and always asks for four formants. For a sentence at 8 kHz it
  reports a fourth "formant" at 3245 Hz and a `vocalTractLength` of
  17.57 cm; the 48 kHz render gives 15.62 cm (12 % apart). `f0` agrees
  (123.3 Hz both).
- `src/server/server.js`: `SAMPLE_RATES` (line 53) lacks 8000 and 11025,
  and `Number(params.sampleRate ?? 24000)` (line 118) overrides the rate of
  the tier. All encoders (`wav`, `flac`, `aiff`, `au`) accept the three
  rates.
- The app addresses tiers by index: `AUDIO_TIERS[message.tier]`
  (`synth-worker.js` lines 145, 178); the start level is the literal 0 in
  `voice-engine.js` (lines 75, 80, 90), `synth-worker.js` (line 323) and
  `App.js` (line 145). New tiers at the front shift every index.

## What to do

1. `src/perf/lod.js`: put these three objects at the front of
   `AUDIO_TIERS`, in this order:

   | name         | sections | sampleRate | blockSize | bandLimit |
   | ------------ | -------- | ---------- | --------- | --------- |
   | `telephone`  | 12       | 8000       | 12        | 3400      |
   | `narrowband` | 16       | 11025      | 16        | 4800      |
   | `wideband`   | 22       | 16000      | 24        | 7000      |

   All have `solver: 'waveguide'`. `blockSize` is in output samples,
   `bandLimit` in Hz. Do not change the other tiers or
   `DEFAULT_AUDIO_TIER`.

2. `cost`: run `node experiments/issue-5-tier-costs.mjs 2` three times,
   take the median load of each new tier divided by the median load of
   `minimal`, round to two decimals. The values must rise strictly and stay
   below 1; if a measured value is not below the next one, use the next
   value minus 0.05 and say so in a comment. Record the measured loads in
   the pull request. (The RTF column above suggests about 0.6, 0.7 and
   0.95; measure, do not copy.)
3. Also export from `lod.js`: `audioTierIndex(name)` (index in
   `AUDIO_TIERS`, throws `Unknown audio tier: <name>`) and
   `BASE_AUDIO_LEVEL = audioTierIndex('minimal')`. Export both from
   `src/index.js` and declare them in `src/index.d.ts`.
4. `prepareUtterance`: add to `renderOptions`
   `blockSize: options.blockSize ?? tier?.blockSize` and
   `bandLimit: options.bandLimit ?? tier?.bandLimit`.
5. `OutputStage(sampleRate, gain, bandLimit)`; `VoiceRenderer` passes
   `options.bandLimit`. Without `bandLimit` nothing changes (the present
   tiers stay bit-identical). With it: `cutoff = Math.min(bandLimit,
0.45 * sampleRate)` and four low-pass biquads at that cutoff with Q
   0.5098, 0.6013, 0.9000 and 2.5629 (eighth-order Butterworth).
6. `analyzeVoice` gets the option `formantCount`, default
   `Math.min(4, Math.floor((0.45 * rate) / 1000))` where `rate` is the rate
   after its own resampling: 3 at 8000 Hz, 4 from 11025 Hz. It asks
   `estimateFormants` for that many and fits `formantSpacing` on them.
   `formants` keeps four entries; entries that were not asked for are 0.
   Write this rule into the JSDoc and into `src/index.d.ts`.
7. Server: add 8000 and 11025 to `SAMPLE_RATES`. When the request has no
   `sampleRate` and the tier has a `bandLimit`, use the tier's
   `sampleRate`; in every other case keep 24000.
8. App (`examples/universal-app/src`): replace the literal start level 0 by
   `BASE_AUDIO_LEVEL` at the five places listed above. Keep
   `message.tier > 0` in the overload rule, so an overloaded device may go
   down to `telephone`. In the quality menu show `11.025 kHz` (three
   decimals only for this rate). The benchmark cache key contains the tier
   names, so old cached levels are dropped without more code.
9. `tests/library.test.js`: the checks of `fallbackLevel` use the indices
   4, 3, 2. Rewrite them with `audioTierIndex('ultra')`, `('high')`,
   `('medium')` and compute the new expected levels by the rule of
   `fallbackLevel` with the costs of step 2.
10. Documentation: add the three rows to the tier table in `README.md`
    (the table with the row `minimal`) with the columns of the existing
    rows, and one sentence: "`wideband` costs almost the same CPU time as
    `minimal`; it exists for the 16 kHz output rate".

## Tests

`tests/narrow-band.test.js` (fast; waveguide only). Helper
`vowelFormants(ipa, options)` =
`analyzeVoice(synthesize(ipa, {ipa: true, seed: 1, ...options}).samples,
rate).formants.slice(0, 3)`. The reference is
`{solver: 'waveguide', sections: 44, sampleRate: 48000}`.

- `tiers exist below minimal`: the first four names of `AUDIO_TIERS` are
  `telephone`, `narrowband`, `wideband`, `minimal`;
  `synthesize('Hello world.', {tier: 'telephone'}).sampleRate` is 8000.
- `formants survive`: for `aː`, `iː`, `uː` and each new tier, every one of
  F1 to F3 differs from the reference by at most 12 % (`telephone`,
  `narrowband`) or 8 % (`wideband`). F4 is not tested: at 8 kHz the band
  ends at 3400 Hz.
- `no aliasing`: with `bandLevel` copied from section 7 of
  `experiments/issue-11-audit-m1.mjs`, the excess for `sː` and `ʃː` at
  tier `telephone` is at most 0.6 dB (reference: the same options with
  `sampleRate: 24000` and no `bandLimit`, then `resample` to 8000).
- `band limit holds`: for `sː` at each new tier, the level above
  `bandLimit * 1.1` is at least 30 dB below the level of 300 Hz to
  `bandLimit`.
- `analysis works at 8 kHz`: for
  `'The quick brown fox jumps over the lazy dog.'` at tier `telephone`,
  `formants[3] === 0`, `f0` is within 2 % of the reference render, and
  `vocalTractLength` is within 6 % of the reference render analysed with
  `{formantCount: 3}`.
- `present tiers are unchanged`: the SHA-256 of the samples of
  `synthesize('Hi.', {tier: 'minimal', seed: 1})` equals the value recorded
  on `main` before the change (write the hex string into the test).

`tests/server.test.js`: `tier=telephone` without `sampleRate` gives a WAV
header with 8000 Hz; `sampleRate=11025` is accepted; `tier=minimal` without
`sampleRate` still gives 24000. `tests/cli-audio.test.js`:
`say 'ˈmama' --ipa --tier telephone` writes a file that decodes to 8000 Hz.

## Acceptance criteria

- [ ] `node --test tests/narrow-band.test.js` passes; the three worst
      formant differences and the two aliasing numbers are in the pull
      request.
- [ ] `node bin/voice-simulator.js benchmark` lists `telephone`,
      `narrowband`, `wideband` before `minimal`, each with a load below
      that of `minimal`.
- [ ] `curl 'localhost:<port>/api/tiers'` lists the three tiers, and a
      synthesis request with `tier=telephone` returns audio at 8000 Hz.
- [ ] In the built app the quality menu shows the three tiers, "auto"
      starts at `minimal`, and choosing `telephone` plays speech (a
      screenshot of the menu is in the pull request).
- [ ] `grep -rc "BASE_AUDIO_LEVEL" examples/universal-app/src` counts at
      least five uses: one in `synth-worker.js`, three in `voice-engine.js`,
      one in `App.js`.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Narrow-band 3D tiers: the 3D solver is far above the cost of these
  tiers.
- Telephone codecs (G.711, AMR) and band-pass filtering below 300 Hz.
- Choosing a tier from a device benchmark: {{P16}}. Changing the tier
  inside an utterance: {{P17}}.
- The Rust port of `blockSize` and `bandLimit`: the layout of {{P10}} gets
  two more numbers in {{P70}} if this issue lands after {{P10}}; if it
  lands first, {{P10}} ports them.
- Recognition at 8 kHz: {{P69}}.

## References

- `experiments/issue-11-audit-m1.mjs` and its output
  `experiments/issue-11-audit-m1.txt` (all numbers of "Current state").
- `experiments/issue-5-tier-costs.mjs` (how `cost` is calibrated).
- Research note `docs/case-studies/issue-11/research/5-performance-and-physics.md`,
  section 6.
