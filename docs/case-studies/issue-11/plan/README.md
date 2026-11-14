# Plan files of the roadmap

Every file `PNN-slug.md` in this folder is the source of one GitHub issue of
the roadmap planned in
[issue 11](https://github.com/konard/voice-simulator/issues/11). The issues
were created from these files by
[`experiments/issue-11-create-issues.mjs`](../../../../experiments/issue-11-create-issues.mjs);
the numbers they received are in
[`../data/created-issues.json`](../data/created-issues.json) and in
[`docs/ROADMAP.md`](../../../ROADMAP.md).

After the issues exist, GitHub is the place where they are discussed and
changed. These files stay as the record of what was planned in issue 11.

## Format

```markdown
---
id: P30
title: Mandarin third tone is spoken as a plain rise because the dip is dropped
type: Bug
milestone: M3
blocked_by: []
requirements: [R17, R19]
---

## Goal

## Why

## Current state

## What to do

## Tests

## Acceptance criteria

- [ ] ...

## Out of scope

## References
```

- `id` is the plan identifier. `{{P37}}` in a body becomes the number of the
  GitHub issue made from `P37`.
- `type` is `Bug` (the software does something wrong today, with a
  reproduction) or `Feature` (something new).
- `milestone` is one of `M0` to `M5`, see below.
- `blocked_by` lists the plan identifiers that must be closed first. They
  become "blocked by" dependencies on GitHub.
- `requirements` lists the requirements of issue 11 (`R1` to `R22`, see the
  [case study](../README.md#requirements)) that the issue serves.

The script adds a header, the list of dependencies in both directions and
the rules that hold for every roadmap issue. Check the files with
`node experiments/issue-11-create-issues.mjs check`.

## How the issues are written

They are written for a reader who has never seen the project and follows
instructions literally:

- one issue is one pull request;
- "Current state" quotes the code or the measurement that shows the gap, with
  the command that reproduces it;
- "What to do" is a numbered list that names files, functions, arguments,
  units, default values and formulas;
- "Tests" names every test, its input and its threshold;
- "Acceptance criteria" can each be checked by running a command;
- "Out of scope" says which other issue owns the neighbouring work;
- "References" lists the papers and projects to read first.

## Names fixed by the plan

The issues refer to each other's files and functions. These names are part of
the plan; an issue that needs a different name says so in its pull request and
updates the issues that depend on it.

| Thing                                | Name                                                                                                                                                                                                | Introduced by |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Manual workflow for expensive checks | `.github/workflows/heavy.yml`, name `Heavy checks`, input `suite`; tests in `tests/heavy/*.test.js`; `npm run test:heavy`; reports in `reports/` (artifact), committed copies in `docs/reports/`    | P02           |
| Policy check                         | `scripts/check-policy.mjs`, deny list `scripts/policy-denylist.json`, part of `npm run check`                                                                                                       | P03           |
| Dataset registry                     | `datasets/registry.json`, `scripts/datasets.mjs` (`list`, `fetch`, `verify`), cache folder `.datasets/` (ignored by git)                                                                            | P04           |
| Golden set                           | `tests/fixtures/golden/manifest.json` and `tests/fixtures/golden/<id>.flac`                                                                                                                         | P05           |
| Metrics                              | `src/metrics/` exporting `logSpectralDistance`, `melCepstralDistortion`, `f0Errors`, `formantErrors`, `dtw`, `editDistance`, `errorRate`, `compareRecordings`; CLI `voice-simulator compare`        | P06           |
| Baseline report                      | `docs/reports/baseline-quality.md`, produced by `scripts/quality-report.mjs`                                                                                                                        | P07           |
| Listening tests                      | `examples/listening-test/`                                                                                                                                                                          | P08           |
| Rust workspace                       | `Cargo.toml` at the root; `crates/voice-simulator-core` (pure Rust, no I/O), `crates/voice-simulator-wasm` (WebAssembly interface), `crates/voice-simulator-cli` (native binary)                    | P09           |
| Engine switch                        | `src/engine/` with `createEngine({ engine: 'auto' \| 'rust' \| 'js' })`; option `engine` of `synthesize` and friends; CLI flag `--engine`                                                           | P13           |
| Narrow-band tiers                    | `telephone` (8000 Hz), `narrowband` (11025 Hz), `wideband` (16000 Hz) in `AUDIO_TIERS`, below `minimal`                                                                                             | P14           |
| Voice file                           | JSON with `"format": "voice-simulator/voice"` and `"version": 1`; `loadVoice`, `saveVoice`; CLI flag `--voice file.json`                                                                            | P29           |
| Speech markup                        | `parseMarkup(text)` in `src/markup/`; the mode track `plan.modes`; ExtIPA and VoQS brace notation such as `{f … f}` and `{W … W}` in IPA                                                            | P38           |
| Analysis front end                   | `src/recognition/frontend.js`, `analyzeFrames` and `createFrameAnalyzer`                                                                                                                            | P46           |
| Trackers                             | `trackPitch` (`src/recognition/pitch.js`), `trackFormants` (`src/recognition/formants.js`), `inverseFilter` (`src/recognition/inverse-filter.js`), `findLandmarks` (`src/recognition/landmarks.js`) | P47 to P50    |
| Voice fit                            | `fitVoice(samples, sampleRate, options)` in `src/analysis/voice-fit.js`; `matchVoice` stays as a wrapper                                                                                            | P51           |
| Codebook and inversion               | `buildCodebook` (`src/recognition/codebook.js`), `invertArticulation` (`src/recognition/inversion.js`)                                                                                              | P52, P53      |
| Sound to IPA                         | `audioToIpa(samples, sampleRate, options)` in `src/recognition/decode.js`                                                                                                                           | P54           |
| IPA to text                          | `ipaToText(ipa, options)` in `src/recognition/ipa-to-text.js`; `identifyLanguage(ipa)` in `src/recognition/language-id.js`                                                                          | P56, P57      |
| Recognition API                      | `recognize(samples, sampleRate, options)`, `createRecognizer(options)` in `src/recognition/recognizer.js`; CLI `voice-simulator recognize`; `POST /api/recognize`                                   | P61           |
| Voice session                        | `createVoiceSession(options)` in `src/session/voice-session.js`                                                                                                                                     | P66           |
| Copy synthesis                       | `copyRecording(samples, sampleRate, options)` in `src/session/copy.js`; CLI `voice-simulator copy`                                                                                                  | P67           |
| State-of-the-art report              | `docs/reports/state-of-the-art.md`                                                                                                                                                                  | P71           |

The app already has a module called `listening.js`. It holds the microphone and
room settings of the listener. The new feature is therefore called
"recognition" in code and in the interface, never "listening".

The result of `recognize` has this shape in every issue that mentions it:

```js
{
  ipa: 'həˈloʊ ˈwɝld',
  text: 'hello world',
  languages: [{ language: 'en', share: 1 }],
  words: [
    {
      text: 'hello',
      ipa: 'həˈloʊ',
      language: 'en',
      start: 0.12,
      end: 0.48,
      confidence: 0.83,
      syllables: [
        { text: 'hel', ipa: 'hə', start: 0.12, end: 0.21, stress: 0 },
        { text: 'lo', ipa: 'ˈloʊ', start: 0.21, end: 0.48, stress: 1 },
      ],
    },
  ],
  modes: [], // spans of loudness, voice quality, emotion (P58, P59)
  voice: null, // fitted voice configuration when a voice session is used
}
```

Times are in seconds from the start of the audio. `syllables[].text` uses the
same split of the spelling as the timeline of the synthesiser
(`utteranceTimeline`), so the app highlights both directions with one
component.

## Milestones

| Key | Milestone on GitHub                                   | What is true when it is closed                                                                                                   |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| M0  | Roadmap 0: Foundations and measurement                | Quality is a number: public recordings, metrics, a manual workflow for expensive checks, a baseline report                       |
| M1  | Roadmap 1: Rust engine and adaptive quality           | The Rust engine in a background worker is the default; precision is set by a silent benchmark and changes while speaking         |
| M2  | Roadmap 2: Voice physics and configuration            | The voice source, the noise and the losses are physical models, and every one of their constants is a parameter of a voice file  |
| M3  | Roadmap 3: Languages and modes of speech              | Tones, stress, intonation, loudness, whisper, voice qualities, emotions and accents can be written, spoken and marked in IPA     |
| M4  | Roadmap 4: Reverse simulation (listening)             | Sound becomes IPA, languages and text by inverting the simulator, with syllables highlighted as they are recognised              |
| M5  | Roadmap 5: Voice copy and state-of-the-art validation | A voice is copied while the person speaks, recordings are reproduced, the lowest settings are certified and the result is public |

## Index

| Id  | Type    | Milestone | Title                                                                          | Blocked by                        |
| --- | ------- | --------- | ------------------------------------------------------------------------------ | --------------------------------- |
| P01 | Bug     | M0        | Template case studies occupy `docs/case-studies/issue-N` folders               |                                   |
| P02 | Feature | M0        | Manually triggered workflow for expensive checks                               |                                   |
| P03 | Feature | M0        | Policy check: no neural networks, permissive licences only                     |                                   |
| P04 | Feature | M0        | Speech dataset registry and fetcher with checksums and a licence gate          | P02, P03                          |
| P05 | Feature | M0        | Golden set of public-domain recordings with transcripts and IPA                | P04                               |
| P06 | Feature | M0        | Objective speech metrics and a `compare` command                               |                                   |
| P07 | Feature | M0        | Baseline quality report against real recordings                                | P02, P05, P06                     |
| P08 | Feature | M0        | Listening-test harness: MUSHRA, ABX and intelligibility                        |                                   |
| P09 | Feature | M1        | Rust workspace and WebAssembly build pipeline                                  |                                   |
| P10 | Feature | M1        | Port the waveguide, the glottal source and the voice renderer to Rust          | P09, P02                          |
| P11 | Feature | M1        | Port the 3D FDTD solver to Rust with WebAssembly SIMD                          | P09, P10                          |
| P12 | Feature | M1        | Multicore 3D solver with a single-core fallback                                | P11                               |
| P13 | Feature | M1        | Rust engine in a background worker as the default, JavaScript as the fallback  | P10, P11                          |
| P14 | Feature | M1        | Narrow-band tiers: 8, 11.025 and 16 kHz                                        |                                   |
| P15 | Feature | M1        | AudioWorklet playback with a ring buffer                                       |                                   |
| P16 | Feature | M1        | Silent load-time device benchmark that sets the precision                      | P13, P14                          |
| P17 | Feature | M1        | Change quality in the middle of an utterance while streaming                   | P13, P15                          |
| P18 | Feature | M1        | Run the WebGPU solver in CI                                                    | P02                               |
| P19 | Feature | M1        | Performance tracking: real-time factor per tier in CI                          | P02, P13                          |
| P20 | Bug     | M2        | `breathiness` hardly changes the measured noise level                          |                                   |
| P21 | Feature | M2        | Physical vocal-fold model driven by lung pressure                              |                                   |
| P22 | Feature | M2        | Source-tract interaction and the subglottal tract                              | P21                               |
| P23 | Feature | M2        | Physically based turbulence noise: frication, aspiration and bursts            |                                   |
| P24 | Feature | M2        | Frequency-dependent losses in the 1D solver                                    |                                   |
| P25 | Feature | M2        | 2D acoustic tier between the waveguide and 3D                                  |                                   |
| P26 | Feature | M2        | Articulator dynamics and coarticulation calibrated on real data                | P06, P05                          |
| P27 | Feature | M2        | Rule-based segment duration model per language                                 | P05, P06                          |
| P28 | Feature | M2        | Explicit jaw, larynx height and lip protrusion articulators                    |                                   |
| P29 | Feature | M2        | Expanded voice configuration: voice files, groups, presets and an editor       | P21, P23, P24                     |
| P72 | Bug     | M2        | Nasal consonants are about four times louder in the 3D solver                  |                                   |
| P30 | Bug     | M3        | Mandarin third tone is spoken as a plain rise because the dip is dropped       |                                   |
| P31 | Bug     | M3        | Mandarin erhua is spoken as a separate syllable                                |                                   |
| P32 | Bug     | M3        | English heteronyms are always read the same way                                |                                   |
| P33 | Bug     | M3        | Hindi yes/no questions that start with क्या get a falling contour              |                                   |
| P34 | Bug     | M3        | Expanded numbers and dates are highlighted as one word                         |                                   |
| P35 | Feature | M3        | Pronunciation lexicons at scale from permissive sources                        | P03, P04                          |
| P36 | Bug     | M3        | Russian stress is wrong outside the small dictionary and for homographs        | P35                               |
| P37 | Feature | M3        | Tone model with targets, the neutral tone and tone coarticulation              | P30                               |
| P38 | Feature | M3        | Speech markup: an SSML subset, inline tags and voice-quality symbols in IPA    |                                   |
| P39 | Feature | M3        | Intonation models per language: sentence types, focus and Russian contours     | P38                               |
| P40 | Feature | M3        | Vocal effort and loudness dynamics                                             | P38                               |
| P41 | Feature | M3        | Whisper                                                                        | P38, P23                          |
| P42 | Feature | M3        | Phonation types: breathy, creaky, pressed and falsetto                         | P38, P20                          |
| P43 | Feature | M3        | Emotions and attitudes                                                         | P39, P40, P42, P08                |
| P44 | Feature | M3        | Paralinguistic sounds: breaths, laughter, sighs and hesitations                | P38, P23                          |
| P45 | Feature | M3        | Accents beyond English and foreign accents                                     |                                   |
| P73 | Bug     | M3        | English function words are spoken as full stressed words                       |                                   |
| P74 | Bug     | M3        | Russian prepositions and particles are read as separate stressed words         |                                   |
| P46 | Feature | M4        | Streaming analysis front end                                                   |                                   |
| P47 | Feature | M4        | Robust pitch and voicing tracker                                               | P46, P06, P04                     |
| P48 | Feature | M4        | Formant tracker                                                                | P46, P06, P05                     |
| P49 | Feature | M4        | Glottal inverse filtering and source parameters                                | P46                               |
| P50 | Feature | M4        | Syllable nuclei, landmarks and broad sound classes                             | P46, P05                          |
| P51 | Feature | M4        | Voice configuration fit on real speakers (pass 1)                              | P47, P48, P49, P05, P20           |
| P52 | Feature | M4        | Articulatory codebook generated by the simulator                               | P46                               |
| P53 | Feature | M4        | Acoustic-to-articulatory inversion (pass 2)                                    | P52, P48, P51                     |
| P54 | Feature | M4        | Decode articulation into IPA with times                                        | P53, P50                          |
| P55 | Feature | M4        | Analysis-by-synthesis rescoring                                                | P54, P06                          |
| P56 | Feature | M4        | IPA to text per language                                                       | P35                               |
| P57 | Feature | M4        | Language identification and mixed-language speech from IPA                     | P56                               |
| P58 | Feature | M4        | Recognise tones, stress and sentence type                                      | P54, P47, P37, P39                |
| P59 | Feature | M4        | Recognise loudness, whisper, voice quality and emotion                         | P49, P40, P41, P42, P43, P05      |
| P60 | Feature | M4        | Recognise whispered speech                                                     | P54, P41                          |
| P61 | Feature | M4        | Recognition API, command and server route with streaming results               | P54, P56, P57                     |
| P62 | Feature | M4        | App: recognition from the microphone and files with live syllable highlighting | P61                               |
| P63 | Feature | M4        | Round-trip tests: text to audio to text in the heavy workflow                  | P61, P02, P14                     |
| P64 | Feature | M4        | Recognition benchmark on public recordings                                     | P61, P04, P06, P02                |
| P65 | Feature | M4        | Recognition in Rust and on several cores with a single-core fallback           | P61, P09                          |
| P66 | Feature | M5        | Multi-pass voice session: fit, invert, stabilise, keep recognising             | P51, P61                          |
| P67 | Feature | M5        | Copy synthesis: reproduce a real recording                                     | P66, P58, P59, P08                |
| P68 | Feature | M5        | App: copy a voice while the person keeps speaking                              | P66, P62                          |
| P69 | Feature | M5        | Lowest-settings certification: 8 kHz and one core                              | P63, P64, P67, P14                |
| P70 | Feature | M5        | Rust parity for everything added after the port                                | P13, P21, P22, P23, P24, P41, P42 |
| P71 | Feature | M5        | State-of-the-art evaluation and public report                                  | P07, P08, P67, P69, P19, P16      |
