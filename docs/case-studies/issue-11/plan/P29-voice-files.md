---
id: P29
title: 'Expanded voice configuration: voice files, groups, presets and an editor'
type: Feature
milestone: M2
blocked_by: [P21, P23, P24]
requirements: [R5, R9, R17, R18]
---

## Goal

Describe a voice with more than 100 documented parameters in six groups, store
it in a JSON voice file, and let the library, the CLI and the app read, write
and edit such files.

## Why

Requirement R5 asks for much more voice configuration. The issues of this
milestone add physical constants (fold mass, lung pressure, wall mass) that a
user cannot set and the voice fit ({{P51}}) cannot fit. One table with unit,
range, default and source per parameter documents every number.

## Current state

- `HEAD_PARAMETERS` in `src/head-config.js` has 33 entries
  `{key, label, group, unit, min, max, step, default, description}` in seven
  groups: `anatomy` 5, `mouth` 4, `face` 3, `voice` 6, `source` 5, `prosody` 6,
  `acoustics` 4. An entry has no source and no stated direction of its effect.
- A configuration is a flat object. `normalizeHeadConfig()` clamps values into
  their range and drops unknown keys, both without a message.
- `HEAD_PRESETS` in `src/head-presets.js` has three presets: `male`, `female`
  and `child` (about ten years), with `ranges` of `[small, large, spread]`.
- CLI (`bin/voice-simulator.js`): `--head <random | key=value&…>`,
  `--preset <any | male | female | child>` and `voice-simulator head --json`
  (prints the flat object). There is no `--voice`.
- The microphone (`resolveMicrophone()`) and the room (`resolveRoom()`) are
  options of `synthesize()`, not part of the configuration.
- The app (`examples/universal-app/src/components/HeadEditor.js`,
  `const GROUPS`) shows one slider per parameter; it cannot load or save a file.

## What to do

1. Entries. Add to every entry of `HEAD_PARAMETERS`: `source` (a citation, or
   `fitted: <experiment file>`), `effect` (`{measure, sign}`, see Tests) and
   `advanced` (boolean; true for all new entries). Change `group` to one of six
   groups, exported as `HEAD_GROUPS` in this order: `anatomy` (today's
   `anatomy`, `mouth` and `face`, plus `wallLoss` and `nasalCoupling`), `folds`
   (`pitch`, `tenseness`, `breathiness`, `jitter`, `shimmer`, `glottalChink`),
   `breathing` (`aspirationLevel`, `fricationLevel`), `articulation`
   (`speechRate`, `articulationSpeed`, `stressLengthening`, `finalLengthening`,
   `pauseLength`), `expression` (`pitchRange`, `vibrato`, `vibratoRate`,
   `declination`, `accentStrength`) and `microphone` (`outputGain`). The object
   in the code stays flat (`head.pitch`); only the file is grouped.

2. New entries. Turn the constants of the merged issues into parameters (export
   a constant that is not exported yet): key = the constant in camelCase,
   default = the constant, range and `source` = those of the issue that
   introduced it. Replace each use of the constant by `head.<key>`. Where the
   issue already added the key as a head parameter, only set its group. Always
   done here (33 new, 66 in total):
   - teeth (`src/articulation/teeth.js`, group `anatomy`; `OPEN_GAP` and
     `BACK_GAP` are not exported today): `restGap`, `sibilantGap`, `velarGap`,
     `openGap`, `backGap`, `incisorThickness`;
   - {{P21}}: `foldLength`, `foldMass`, `foldStiffness`, `foldDamping`
     (`folds`), `lungPressure` (`breathing`);
   - {{P23}} (`breathing`): `oralCompliance`, `glottisVoiced`, `glottisOpen`,
     `glottisBreathy`, `reCritical`, `wallSource`, `strouhal`, `chinkNoise`,
     `fricationGain`, `transientGain`;
   - {{P24}} (`anatomy`): `wallMass`, `wallResistance`, `wallStiffness`,
     `lossShape`, `radiationBaffle`;
   - new (`microphone`): `micDistance`, `micAzimuth`, `micElevation`,
     `roomWidth`, `roomHeight`, `roomDepth`, `roomRt60` (0 = no room). The
     options `microphone` and `room` of `synthesize()` win over the voice.

   Done here if the issue is merged, otherwise by that issue later (write this
   into its pull request); with all of them there are 117 or more:
   - {{P20}} (`folds`): `breathinessRd`, `breathGain`, `breathExponent`;
   - {{P22}}: `subglottalLength`, `subglottalLoss` (`anatomy`),
     `glottalPressureCoefficient` (`folds`);
   - {{P72}} (`anatomy`): `nasalLoss`;
   - {{P26}} (`articulation`): `coarticulation`, `roundingLead`, `velumLead` and
     one `speed<Channel>` per entry of `ARTICULATORS` (factor, 0.5 to 2, default
     1): 16 or more;
   - {{P27}} (`articulation`): `rateMinimum`, `rateStretch` and one
     `duration<Rule>` per entry of `DURATION_RULES` (factor, 0.5 to 2, default
     1): 20;
   - {{P28}}: `jawPosture`, `lipPosture`, `larynxPosture`, `tongueRootPosture`,
     `jawArea`, `tongueRootArea` (`articulation`), `intrinsicPitch`,
     `larynxPitch` (`expression`).

3. Voice file. Create `src/voice-file.js` and export from `src/index.js`:

   ```json
   {
     "format": "voice-simulator/voice",
     "version": 1,
     "preset": "female",
     "folds": { "pitch": 205, "breathiness": 0.4 }
   }
   ```

   - `loadVoice(input, options = {})`: `input` is such an object (it may also
     have a `name` and a free-text `description`), its JSON text, a flat
     configuration object (today's `head --json`) or a `key=value&…` string. It
     returns `{name, description, preset, head, warnings}` with `head` complete
     and flat. Missing values come from `presetHeadConfig(preset, 0.5)` or from
     the defaults.
   - Problems: wrong `format`; `version` above `VOICE_VERSION = 1`; an unknown
     group or key; a key in the wrong group; a value that is not a finite number
     or lies outside `min` to `max`. With `options.strict` (default true) throw
     one `Error` with one line per problem, for example
     `folds.pitch = 900 is outside 60 to 320 Hz`. With `strict: false` clamp,
     skip and return the lines in `warnings`.
   - `saveVoice(voice, options = {})` returns the object for `JSON.stringify`
     with only the values that differ from the preset or default
     (`options.full`: all values).
   - `voiceSchema()` returns a JSON Schema (draft 2020-12) built from
     `HEAD_PARAMETERS`; commit its output as `schemas/voice.schema.json`.
   - `RENAMED_KEYS` (old key to new key, empty today) is applied to flat input.
     `encodeHeadConfig()` and `decodeHeadConfig()` keep working for all keys.

4. Presets. Add to `HEAD_PRESETS`, with `ranges` like the present ones and all
   other values from the base. Starting centres as (base, `vocalTractLength` in
   cm, `pitch` in Hz); check each against the sources in References before use:
   `child5` (child, 11.5, 260), `teenMale` (male, 15.8, 130), `teenFemale`
   (female, 14.2, 220), `elderlyMale` (male, 17.2, 125), `elderlyFemale`
   (female, 14.8, 175), `bass` (male, 18.5, 95), `baritone` (male, 17.5, 110),
   `tenor` (male, 16.5, 135), `alto` (female, 15.3, 185), `mezzo` (female, 14.8,
   210), `soprano` (female, 14.2, 240). The elderly presets also get `jitter`
   and `shimmer` × 1.5, `breathiness` + 0.1 and `speechRate` 0.9. Scale
   `foldLength` with the pitch as {{P21}} describes.

5. CLI. Add `--voice <file.json>` to all audio commands (`--head` wins over
   `--voice`, which wins over `--preset`), `voice-simulator head --voice-file`
   (prints `saveVoice()` of the resolved head; `--full` for all values) and
   `voice-simulator voice check <file.json>` (exit code 1 on a problem).

6. App. In `HeadEditor.js` use `HEAD_GROUPS`, one collapsible `<details>` per
   group, and hide `advanced` parameters behind a switch "Show all parameters".
   Add the buttons "Import voice" (`.json` file, `loadVoice()`, shows the error
   text on failure) and "Export voice" (downloads `saveVoice()` as
   `voice.json`). Add the new texts to `examples/universal-app/src/i18n.js`.

7. Documentation. Add `scripts/voice-parameters.mjs` that writes
   `docs/VOICE-PARAMETERS.md` from `HEAD_PARAMETERS` (one table per group: key,
   unit, range, default, effect, source) and, with `--count`, only prints the
   number of parameters. Link the file from `README.md`.

## Tests

Create `tests/voice-file.test.js`:

- `round-trips a voice`: `loadVoice(saveVoice(v)).head` equals `v.head` for the
  default, each preset and three random heads.
- `writes only what differs`: `saveVoice()` of the default head has no group
  keys; with `full: true` it has every parameter.
- `reads the old formats`: a flat object and the string of `encodeHeadConfig()`
  give the same `head`.
- `reports every problem`: a file with an unknown key, a value out of range and
  a key in the wrong group throws an error whose message has three lines; with
  `strict: false` it returns three `warnings`. `"version": 2` throws.
- `keeps the schema file current`: `schemas/voice.schema.json` equals
  `voiceSchema()`.

Change `tests/head-parameters.test.js`:

- `documents every parameter`: each entry has a `unit` (`x` for a factor),
  `min < max`, a `default` inside, a `source` of at least 10 characters, an
  `effect` and a group of `HEAD_GROUPS`; `docs/VOICE-PARAMETERS.md` is current.
- `moves the sound in the documented direction`: for each entry, render
  `ˈmama ˈsasa` (IPA, tier `minimal`, fixed seed) at `min` and at `max`; the
  sign of the difference of `effect.measure` is `effect.sign`. `measure` is one
  of `duration`, `rms`, `f0`, `f0Range`, `hnr`, `h1h2`, `centroid`, `f1`, `f2`,
  `f3`, `bandwidth1`, `noiseLevel` (RMS of the `[s]`), `nasalLevel` (RMS of the
  `[m]`), `reverb` (energy after the end of the plan). `headWidth`, `headHeight`
  and `noseLength` use the 3D tier `high` on `ˈa`.

Add to `tests/head-presets.test.js`: `orders the voice types` (pitch and
formants fall from `soprano` to `bass`; `child5` has the highest F1 to F3 of
`[a]`). Add to `tests/cli-audio.test.js`: `renders with a voice file` and
`rejects a broken voice file`.

## Acceptance criteria

- [ ] `node scripts/voice-parameters.mjs --count` prints at least 66, and at
      least 117 once all issues of step 2 are merged.
- [ ] `node bin/voice-simulator.js head --preset bass --voice-file` prints a
      voice file; "Hello." rendered with `--voice` and that file has a pitch
      (`voice-simulator match`) within 10 % of 95 Hz.
- [ ] `node experiments/issue-11-audit.mjs` prints the same numbers as before.
- [ ] `grep -rn "group: '\(mouth\|acoustics\)'" src` finds nothing.
- [ ] The new tests exist and pass on Node.js, Bun and Deno; the direction test
      takes under 60 s. A screenshot of the editor with the six groups and the
      two buttons is in the pull request.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Fitting a voice file to a recording: {{P51}}. The copy-voice screen: {{P68}}.
- Language, accent and style in the file: {{P45}} adds `"accent"`; {{P40}} to
  {{P43}} add their own parameters to the group `expression`.
- New physics: this issue only exposes what the issues of step 2 implement.

## References

- Fitch, W. T., & Giedd, J. (1999). Morphology and development of the human
  vocal tract: a study using magnetic resonance imaging. Journal of the
  Acoustical Society of America 106(3), 1511-1522.
- Lee, S., Potamianos, A., & Narayanan, S. (1999). Acoustics of children's
  speech: developmental changes of temporal and spectral parameters. Journal of
  the Acoustical Society of America 105(3), 1455-1468.
- Titze, I. R. (1989). Physiologic and acoustic differences between male and
  female voices. Journal of the Acoustical Society of America 85(4), 1699-1707.
- Roers, F., Mürbe, D., & Sundberg, J. (2009). Voice classification and vocal
  tract of singers: a study of x-ray images and morphology. Journal of the
  Acoustical Society of America 125(1), 503-512.
- Linville, S. E. (2001). Vocal Aging. Singular Thomson Learning.
- Research notes 4 and 5 in `docs/case-studies/issue-11/research/`.
