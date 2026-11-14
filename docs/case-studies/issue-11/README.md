# Case study: issue #11, the quality of the system must be state of the art

Issue: [konard/voice-simulator#11](https://github.com/konard/voice-simulator/issues/11).
Pull request: [konard/voice-simulator#12](https://github.com/konard/voice-simulator/pull/12).

The issue asks for a plan, not for code. It widens the project from a
simulator that speaks to one physical model that speaks and listens, copies
voices, covers every common mode of speech, runs fast on every device, uses no
neural networks and is given away as public domain. The requested result is a
documentation update (vision, case study, survey of similar projects) and a
full development plan as GitHub issues that are marked as bugs or features,
block each other where they must, and are detailed enough for a weak agent to
deliver.

What this pull request delivers:

- The vision, rewritten: [docs/VISION.md](../../VISION.md).
- The plan: [docs/ROADMAP.md](../../ROADMAP.md) and 72 GitHub issues in six
  milestones with their "blocked by" links. The text of every issue is in
  [plan](plan/README.md).
- This case study: every requirement of the issue, what exists today, the
  options, the chosen solution and the issues that implement it.
- Research with sources in five parts: [research](research).
- A measured audit of the current behaviour, which found nine bugs:
  [experiments/issue-11-audit.mjs](../../../experiments/issue-11-audit.mjs).

Nothing in `src/` changes. No requirement is claimed as implemented in code by
this pull request; the table below says for each one whether it is done here
(documents and issues) or planned in named issues.

## Contents

- [data](data): the issue, the pull request and issues 1, 5 and 9 as fetched
  with `gh`, and the list of created issues.
- [research](research): online research, each part with its sources and a list
  of what could not be verified:
  [similar projects](research/1-similar-projects.md),
  [inversion and recognition](research/2-inversion-and-recognition.md),
  [datasets](research/3-datasets.md),
  [linguistics and modes of speech](research/4-linguistics-and-speech-modes.md),
  [performance and physics](research/5-performance-and-physics.md).
- [plan](plan/README.md): one file per issue, the names the issues share and
  the index.
- Scripts and their committed outputs in [experiments](../../../experiments):
  `issue-11-audit*.mjs` (measurements) and `issue-11-create-issues.mjs`
  (validation of the plan, creation of the issues, the roadmap tables).

## Requirements

Every sentence of the issue that asks for something is a requirement. "Done"
means delivered by this pull request. "Planned" means that the issue asks for a
plan and the plan exists as the named issues; the behaviour itself is not
implemented yet.

| #   | Requirement (issue text, condensed)                                                                   | Status  | Issues or documents                                                                 |
| --- | ----------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| R1  | Plan issues so that the highest possible quality of sound simulation is fully supported               | Done    | [Roadmap](../../ROADMAP.md), all 72 issues                                          |
| R2  | If performance blocks us: sound simulation in a Rust background worker, and make it the default       | Planned | {{P09}}, {{P10}}, {{P11}}, {{P13}}, {{P70}}                                         |
| R3  | Streaming with variable quality: when the algorithm is too slow for the device, make it cheaper       | Planned | {{P15}}, {{P17}}, {{P14}}                                                           |
| R4  | Background checks on page load, without sound and without locking the UI: a small benchmark           | Planned | {{P16}}, {{P19}}                                                                    |
| R5  | Much more configuration of the voice, so that it is as realistic as possible                          | Planned | {{P29}}, {{P20}} to {{P28}}                                                         |
| R6  | Run our own simulation in reverse: speech to text as well as text to speech                           | Planned | {{P46}} to {{P65}}                                                                  |
| R7  | Always text in a language → IPA → audio, and audio → IPA → detected language or mix of languages      | Planned | {{P54}}, {{P56}}, {{P57}}, {{P61}}; principle 3 of the vision                       |
| R8  | Datasets of real recordings, preferably public domain with transcripts, to recognise and to reproduce | Planned | {{P04}}, {{P05}}, {{P07}}, {{P64}}                                                  |
| R9  | Multi-pass algorithm: fit the voice, invert with that voice, stabilise, then copy and recognise       | Planned | {{P51}}, {{P53}}, {{P66}}, {{P67}}, {{P68}}                                         |
| R10 | Highlight every syllable while speaking and while recognising                                         | Planned | {{P34}}, {{P62}}, {{P68}}                                                           |
| R11 | Expensive tests in manually triggered GitHub Actions                                                  | Planned | {{P02}}, {{P18}}, {{P19}}, {{P63}}, {{P64}}                                         |
| R12 | Fast on CPUs, multicore when possible, and fine with a single CPU                                     | Planned | {{P12}}, {{P65}}, {{P69}}                                                           |
| R13 | Everything works with the lowest audio settings: synthesis, recognition, copying                      | Planned | {{P14}}, {{P63}}, {{P69}}                                                           |
| R14 | Check best practices; list all similar projects and projects that implement parts of the vision       | Done    | [Similar projects](#similar-projects), [research 1](research/1-similar-projects.md) |
| R15 | The vision must be updated by this pull request                                                       | Done    | [docs/VISION.md](../../VISION.md)                                                   |
| R16 | Issues detailed enough for a weak agent, marked bug or feature, blockers between them, the full plan  | Done    | [The plan](#the-plan), [plan](plan/README.md)                                       |
| R17 | Tones, accents, loudness changes, question and exclamation intonation, whisper, emotions: in and out  | Planned | {{P30}} to {{P45}}, {{P58}}, {{P59}}, {{P60}}                                       |
| R18 | No neural networks: algorithms, mathematics, physically accurate simulation and its reverse           | Planned | {{P03}}; principle 1 of the vision; rules in every issue                            |
| R19 | A new state-of-the-art system that never existed, a public-domain gift to humanity                    | Planned | {{P07}}, {{P08}}, {{P71}}; [what is new](#what-is-new-and-what-is-uncertain)        |
| R20 | Scope: a docs update, and actually created GitHub issues with the full plan                           | Done    | This pull request, [created issues](data/created-issues.json)                       |
| R21 | Collect the data in `docs/case-studies/issue-11`, analyse, research online, plan every requirement    | Done    | This document, [data](data), [research](research)                                   |
| R22 | Everything in this single pull request                                                                | Done    | [Pull request 12](https://github.com/konard/voice-simulator/pull/12)                |

The issue also says "all requirements you recommended to achieve our previous
vision". Those are covered in
[What the earlier case studies left open](#what-the-earlier-case-studies-left-open).

## How the plan was made

1. **Data.** The issue, the pull request and the three earlier vision issues
   were saved to [data](data).
2. **Audit.** The current code was measured, not read only. The audit scripts
   print numbers; their outputs are committed next to them. Each bug in the
   plan quotes the command and the output that shows it.
3. **Research.** Five surveys were written with online sources: who built
   something similar, how a simulator can be inverted without neural networks,
   which recordings can be used, how the modes of speech work in numbers, and
   how to make the engine fast and the physics better.
4. **Plan.** The requirements were cut into 72 issues. Shared names (files,
   functions, formats, tiers) were fixed first in
   [plan/README.md](plan/README.md) so that issues written apart still fit
   together. A script checks that every issue has all sections, that every
   blocker exists and that the dependencies have no cycle.
5. **Issues.** The script created the milestones and the issues with their
   types, labels and dependencies, and wrote the tables of the roadmap.

## What was measured

Run `node experiments/issue-11-audit.mjs`; the output is
[issue-11-audit.txt](../../../experiments/issue-11-audit.txt). The other
`issue-11-audit-*.mjs` scripts measure what single issues needed.

| What                                 | Measured today                                                                                                   | Consequence                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Mandarin third tone `mǎ`             | Planned pitch 105, 108, 128, 136, 137 Hz: it only rises                                                          | Bug {{P30}}; the tone model {{P37}}                                |
| Mandarin `花儿`                      | `xwa˥ ɚ˧˥`: the suffix is a syllable of its own with a rising tone                                               | Bug {{P31}}                                                        |
| English "record the record"          | `ɹəˈkɔɹd ðə ɹəˈkɔɹd`; "lead pipe" and "they lead" both `lɛd`; "the wind" and "wind the clock" both `waɪnd`       | Bug {{P32}}; lexicons {{P35}}                                      |
| Russian "Замок на замке"             | `ˈzamək na ˈzamkʲə`: the lock is read as the castle                                                              | Bug {{P36}}                                                        |
| Hindi "क्या तुम आओगे?"               | The yes/no question gets a falling mark `↘`                                                                      | Bug {{P33}}                                                        |
| "I have 25 apples on 3/4/2024."      | The words `25` and `3/4/2024` have 3 and 7 syllables without text, so nothing can be highlighted inside them     | Bug {{P34}}                                                        |
| `breathiness` 0 → 1                  | Harmonics-to-noise ratio 15.19 → 14.59 dB, H1-H2 3.43 → 3.46 dB: almost no measurable change                     | Bug {{P20}}; blocks the voice fit {{P51}}                          |
| Nasal against the vowel in `ˈama`    | Level ratio 0.32 with the 1D solver, 1.22 with the 3D solver                                                     | Bug {{P72}}                                                        |
| Sentence types in English            | Statement 141 → 94 Hz, yes/no question 141 → 140 Hz, exclamation starts at 161 Hz and is 1.41 times louder       | Only final movements exist; intonation models {{P39}}              |
| Lowest settings                      | `minimal` tier is 22.05 kHz; forcing 8, 11.025 and 16 kHz works and keeps the formants                           | Narrow-band tiers {{P14}}                                          |
| Configuration                        | 33 head and voice parameters                                                                                     | Expanded configuration {{P29}}                                     |
| Speed, one core of the audit machine | Real-time factor 0.05 (`minimal`), 0.10 (`low`), 0.14 (`medium`), 1.32 (`high`), 6.77 (`ultra`)                  | 1D is real time everywhere; 3D is not: Rust engine {{P09}}-{{P13}} |
| Case-study folders of the template   | `docs/case-studies/issue-13`, `-21`, `-23` and 14 more belong to another repository and collide with new numbers | Bug {{P01}}                                                        |

## Analysis and solution per requirement

Each part says what the issue asks, what exists, which options were weighed,
what was chosen and which issues carry it out.

### R1, R19: the highest quality, state of the art

**Today.** The simulator has a 1D waveguide and a 3D FDTD solver whose formants
were checked against Hillenbrand and others (1995) and Story (2008). It was
never compared with recordings of running speech, and no listening test was
run. "State of the art" is therefore a goal with no number behind it.

**What limits quality.** The research on physics
([part B](research/5-performance-and-physics.md)) points away from the tract
geometry. Birkholz and Drechsel (2021) added three anatomical details to a
physical synthesiser and listeners did not hear it as more natural. Blandin,
Didone and Birkholz (2024) found no significant effect of 3D against 1D
acoustics on naturalness for seven sounds, while an earlier study of the same
group found a preference for 3D for /o/ and /u/. What listeners do hear is the
voice source, the noise of the consonants and the movement and timing of the
articulators. The audit agrees: the wrong things in the output today are tones,
stress, durations and voice quality.

**Options.**

| Option                                    | For                                          | Against                                                                |
| ----------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Finer 3D grids                            | Already built; correct above 5 kHz           | Cost grows with the fourth power of the resolution; small audible gain |
| Physical source, noise and dynamics first | Largest audible gain per unit of computation | New models to validate                                                 |
| Learned control or a neural residual      | Proposed by the issue 9 case study           | Ruled out by R18                                                       |

**Chosen.** Measure first ({{P04}} to {{P08}}), then improve in the order of
audible gain: vocal folds driven by lung pressure ({{P21}}), their coupling to
the tract and the trachea ({{P22}}), turbulence and bursts ({{P23}}), losses
({{P24}}), articulator dynamics calibrated on real data ({{P26}}), durations
({{P27}}), more articulators ({{P28}}), a 2D tier ({{P25}}). The claim "state of
the art" is tested at the end by {{P71}}, which publishes the numbers whatever
they are.

### R2, R12: Rust engine in a background worker, multicore and single core

**Today.** The engine is JavaScript in a Web Worker with one hand-written
WebAssembly kernel for the 3D solver and an optional WebGPU path. It uses one
core. The default tier `studio` is about 12 times slower than real time on a
CPU.

**Options.**

| Option                                       | For                                                      | Against                                                                  |
| -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| Keep JavaScript and hand-written WebAssembly | No new toolchain                                         | Every new model is written twice by hand; no native build; no SIMD types |
| Rust core, `no_std`, raw exports             | One source for the browser, the command line, the server | Port effort; a second language in the repository                         |
| Rust with `wasm-bindgen` everywhere          | Convenient                                               | Glue code in the audio path; harder inside an AudioWorklet               |
| WebAssembly threads for the solver           | Uses all cores                                           | Needs cross-origin isolation; not available on GitHub Pages by default   |
| Plain pool of workers                        | Works everywhere; near-linear for independent work       | Does not speed up one solver run                                         |

**Chosen.** A Rust workspace with a dependency-free core ({{P09}}), ports of
the 1D chain ({{P10}}) and the 3D solver with a scalar and a SIMD binary
({{P11}}), the Rust engine in the worker as the default with the JavaScript
engine as the fallback and as the readable reference ({{P13}}). Multicore is an
enhancement that is detected at run time and never required ({{P12}}, {{P65}});
single-core operation is certified by {{P69}}. Everything that is added to the
JavaScript reference later is brought to Rust by {{P70}}.

### R3, R4: quality that follows the device

**Today.** A start-up benchmark picks a tier, and the stream can restart on a
cheaper tier during its first 40 to 300 ms. After that the tier is fixed for
the utterance. Playback uses scheduled buffers.

**Chosen.** Playback through an AudioWorklet fed from a ring buffer ({{P15}});
a governor that watches how full the buffer is and switches the tier in the
middle of an utterance with a short pre-roll and a crossfade ({{P17}}); a silent
benchmark in small slices in the worker after the page has loaded, cached per
device ({{P16}}); three narrow-band tiers below today's lowest one ({{P14}});
the speed of every tier tracked in CI ({{P19}}). The design numbers (slices of
20 to 40 ms, about 30 ms of pre-roll, 5 to 20 ms of crossfade) come from
[research 5](research/5-performance-and-physics.md) and are marked there as
estimates to be measured.

### R5: much more configuration

**Today.** 33 parameters: anatomy, a Liljencrants-Fant source with tenseness,
breathiness, jitter, shimmer and vibrato, and the microphone and room.

**Chosen.** Parameters follow the models. The vocal folds get length,
thickness, stiffness, rest gap and lung pressure ({{P21}}); the trachea and the
source-tract coupling get their own ({{P22}}); noise, losses and articulators
theirs ({{P23}}, {{P24}}, {{P28}}); speaking habits (rate, pauses, precision of
articulation, pitch range, declination) come with the duration and dynamics
models ({{P26}}, {{P27}}). {{P29}} collects them in a versioned voice file that
can be saved, loaded, compared and fitted. {{P20}} repairs a parameter that
exists but has almost no measurable effect.

### R6, R7: the simulation in reverse, always through IPA

**Today.** `analyzeVoice` measures a recording and `matchVoice` fits six
parameters. Nothing recognises phonemes, language or text.

**Options.**

| Option                                             | For                                                          | Against                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Classic statistical recogniser (GMM-HMM, as Kaldi) | Mature; 20 to 33 % phone error on TIMIT                      | Trained acoustic models are not the simulation in reverse; needs labelled audio |
| Landmarks and distinctive features (Stevens, Liu)  | Rules with a physical meaning; about 90 % landmark detection | Needs a second stage to name the phonemes                                       |
| Codebook inversion with dynamic programming        | Uses the simulator as the model; no training data            | The mapping is not unique; consonants are hard                                  |
| Analysis by synthesis (Halle and Stevens 1962)     | The literal reverse simulation; verifies every hypothesis    | Expensive: only affordable for rescoring                                        |

**Chosen.** A pipeline that combines the last three, in the order of
[research 2, section 8](research/2-inversion-and-recognition.md): a streaming
front end ({{P46}}), pitch, formants and the glottal source ({{P47}}, {{P48}},
{{P49}}), syllable nuclei and landmarks ({{P50}}), a codebook made by the
simulator ({{P52}}), inversion to articulator movements with a continuity
constraint ({{P53}}), decoding to IPA with times ({{P54}}), rescoring by
resynthesis ({{P55}}), IPA to text per language with the project's own lexicons
({{P56}}), language identification including mixed speech ({{P57}}), and one
API, command and server route ({{P61}}). The Rust port follows ({{P65}}).

The path audio → IPA → language → text is fixed by the result shape that all
of these issues share (see [plan/README.md](plan/README.md)): IPA is always
returned, and the text is derived from it.

**Honest target.** With trained statistical models Kaldi reaches 32.7 % phone
error on TIMIT with monophones and 19.7 % with its best non-neural recipe. A
rule- and physics-based recogniser will start far behind that. The plan asks
first for 80 to 90 % correct broad classes and for a perfect round trip on the
simulator's own output ({{P63}}), then measures real recordings ({{P64}}) and
reports the numbers without a pass mark that would have to be invented.

### R8: recordings of real voices

**Today.** No recording of running speech is used anywhere in the tests.

**Chosen.** A registry of datasets with licences and checksums and a fetcher
that refuses licences outside the allow list ({{P04}}); a small golden set of
public-domain recordings with transcripts and IPA that is committed ({{P05}});
larger sets downloaded only inside the manually triggered workflow ({{P64}});
the first report against real speech ({{P07}}). The survey of datasets with
their licences is [research 3](research/3-datasets.md).

### R9: the multi-pass algorithm

**Chosen.** The three passes of the issue map to three components. Pass 1 fits
the voice configuration from the first seconds of speech ({{P51}}). Pass 2
inverts the simulator with that configuration ({{P53}}, {{P54}}). The session
({{P66}}) alternates them: it freezes the speaker parameters inside an
utterance and updates them between utterances, which is the proven design of
online speaker adaptation, and it reports when both estimates have stopped
moving. From then on the same object holds a voice to speak with and a
recogniser tuned to the speaker. Copy synthesis ({{P67}}) replays a recording
through the fitted voice with the recognised timing, melody and voice quality,
and measures the distance to the original. The app shows it live ({{P68}}).

### R10: syllable highlighting in both directions

**Today.** The app highlights syllables while speaking from the planned
timeline. Numbers and dates are one block ({{P34}}).

**Chosen.** Recognition returns syllables with start and end times inside every
word, in the same shape as the speaking timeline, so the app can reuse one
highlighter ({{P62}}, {{P68}}). A syllable that was shown is never taken back;
its text may still change until the word is final. The timing budget (a
syllable within 100 to 200 ms, provisional IPA within 300 to 500 ms, final text
within 2 to 3 s) is from
[research 2, section 6](research/2-inversion-and-recognition.md).

### R11: expensive tests on demand

**Today.** Every workflow runs on pushes and pull requests; the test timeout is
30 s per test.

**Chosen.** One workflow, "Heavy checks", started by hand with a choice of the
suite ({{P02}}). Everything expensive hangs on it: the WebGPU solver ({{P18}}),
speed tracking ({{P19}}), round trips in every tier ({{P63}}), recognition of
datasets ({{P64}}), the certification of the lowest settings ({{P69}}) and the
final evaluation ({{P71}}).

### R13: everything works at the lowest settings

**Today.** The lowest tier is 22.05 kHz with 22 tube sections. Forcing 8 kHz
works for synthesis (measured above).

**Chosen.** Tiers at 8, 11.025 and 16 kHz ({{P14}}) with the measures that keep
them clean: a fixed high internal rate with decimation, and fractional tract
lengths (in {{P24}}). Round-trip tests run in every tier ({{P63}}). {{P69}} is
the certification: synthesis, recognition and copying on the lowest tier, on
one core, with pass marks relative to the best tier.

### R14: best practices and similar projects

See [Similar projects](#similar-projects), [Components and
libraries](#components-and-libraries) and [Best practices](#best-practices).

### R15: the vision

[docs/VISION.md](../../VISION.md) is new. It states the two directions, nine
principles, what the finished system does, the exact boundary of "no neural
networks", where the project is today, how quality is judged, what is not a
goal, and the history of the vision through issues 1, 5, 9 and 11. It withdraws
one recommendation of the issue 9 case study that contradicts R18.

### R16, R20: the issues

See [The plan](#the-plan).

### R17: modes of speech, in and out

**Today.** Tones from two levels, sentence-final pitch movements from
punctuation, four English accents. No whisper, no loudness control inside a
sentence, no emotions, no markup.

**Chosen.** Bugs first ({{P30}} to {{P34}}, {{P36}}). Then one markup that both
directions share ({{P38}}): what the speaker is asked to do and what the
recogniser reports use the same names. On top of it: a tone model with targets
({{P37}}), intonation per language ({{P39}}), vocal effort from soft to shouted
with gradual changes ({{P40}}), whisper ({{P41}}), breathy, creaky, pressed and
falsetto voice ({{P42}}), emotions and attitudes as documented changes of the
physical parameters ({{P43}}), breaths, laughter and hesitations ({{P44}}),
accents beyond English ({{P45}}), large lexicons ({{P35}}). The reverse side
recognises tones, stress and sentence type ({{P58}}), loudness, whisper, voice
quality and emotion ({{P59}}) and whispered speech ({{P60}}).

The numbers behind the presets (for example pitch +2.3 to +2.9 semitones under
focus, whisper about 25 dB quieter and 1.32 times longer) and their sources are
in [research 4](research/4-linguistics-and-speech-modes.md). One limit is
stated there and repeated in {{P59}}: three prosodic cues classify emotions
correctly only 58 % of the time in the literature, so emotion recognition
reports a few coarse classes with a confidence, not a fine label.

### R18: no neural networks

The boundary is written in the vision
([What counts as a neural network](../../VISION.md#what-counts-as-a-neural-network)).
{{P03}} turns it into a check that fails CI when a dependency, a model file or
an import of a neural library appears, and that also enforces the licence
allow list. Every issue repeats the rule. Neural systems stay as a yardstick
that is quoted, never run by the project.

### R21, R22: this case study, one pull request

This folder and [pull request 12](https://github.com/konard/voice-simulator/pull/12).

## What the earlier case studies left open

The issue asks that the plan also covers what was recommended earlier.

| Left open by                                  | What                                                                                       | Now                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [Issue 9](../issue-9/README.md), R9           | No listening test shows the simulator near neural TTS; the gap is in control and prosody   | {{P08}}, {{P26}}, {{P27}}, {{P39}}, {{P71}}                       |
| Issue 9, research on the path past neural TTS | Learned control, a neural residual, scoring with neural recognisers and quality predictors | Withdrawn (R18); replaced by calibrated rules and physical models |
| [Issue 5](../issue-5/README.md)               | Voice matching fits six parameters and was tested on synthetic recordings only             | {{P51}}, {{P66}}, {{P67}}                                         |
| Issue 5                                       | Small dictionaries: stress and readings of words spelled alike                             | {{P32}}, {{P35}}, {{P36}}                                         |
| Issue 9                                       | The WebGPU solver is not exercised in CI                                                   | {{P18}}                                                           |
| [Issue 1](../issue-1/README.md)               | Real time for the 3D tiers on ordinary devices                                             | {{P09}} to {{P13}}, {{P25}}                                       |

## Similar projects

The full survey has 107 projects in six groups with licence, language, state
and what can be reused: [research 1](research/1-similar-projects.md). The
projects closest to each part of the vision:

| Part of the vision                 | Closest projects                                                                        | Licence                                     | What they show                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Physical synthesis                 | VocalTractLab and VocalTractLab3D, gnuspeech                                            | GPL-3.0                                     | The strongest articulatory models; ideas only, the code cannot be copied into a public-domain work |
| Physical synthesis in a browser    | Pink Trombone and its ports; synthie-trombone (Rust and WebAssembly in an AudioWorklet) | MIT; EUPL-1.2                               | A 1D waveguide runs in real time in a worklet                                                      |
| Rule-based speech without networks | eSpeak NG, Klatt synthesisers (klattsch-rs), DECtalk, SAM                               | GPL-3.0; MIT; proprietary; unlicensed       | Intelligible speech from rules at a tiny cost; not natural                                         |
| Recognition without networks       | Kaldi (GMM-HMM recipes), PocketSphinx, Julius, pocketsphinx.js                          | Apache-2.0; BSD; BSD; MIT                   | Non-neural recognition is mature, runs in a browser, and needs trained statistical models          |
| Synthesise and compare             | aeneas                                                                                  | AGPL-3.0                                    | The only production system that aligns audio by synthesising the text; alignment only              |
| One model for both directions      | Halle and Stevens (1962); Al Bawab, Raj and Stern (2008)                                | Papers                                      | The idea is 60 years old; no released software was found                                           |
| Voice copying without networks     | Genetic-algorithm copy synthesis (Gao 2019); vocal-tract-grad; VocalTrax                | No code; no licence; MIT but with a network | Possible in principle; nothing usable under a permissive licence without a network                 |
| Analysis toolkits                  | Praat; Sonorant (Rust analysis core in a worker); openSMILE                             | GPL-3.0; Unlicense; non-commercial          | The algorithms of the front end are published and well understood                                  |
| Phonology data                     | PHOIBLE, CLTS; PanPhon, Epitran, ipa-dict; CMUdict; CLDR                                | CC BY 4.0; MIT; BSD-style; Unicode-3.0      | Inventories, features and dictionaries exist; attribution licences cannot be committed as CC0      |

### What is new, and what is uncertain

The survey found no released project that does any of the following, and the
vision asks for all of them together:

- one physical model used for both speaking and recognising;
- copying a voice by fitting a physical model, without any network, under a
  permissive licence;
- a multilingual text front end (English, Russian, Hindi, Chinese) on a
  physical model;
- 3D wave simulation driven from text in a browser;
- one Rust and WebAssembly engine that both synthesises and analyses;
- a documented list of expressive modes on a physical model.

These statements are limited to what was searched in November 2026; they are
not proofs of absence.

The largest uncertainty is the same finding seen from the other side: **no
listening test was found in which a physical synthesiser without networks
matches neural text-to-speech.** The vision states this as a goal. The roadmap
builds the means to measure it first and publishes the result at the end
({{P71}}), whichever way it falls.

## Components and libraries

Licences are as recorded in the research files; each file lists what was read
from a licence file and what only from a summary. The rule of the project:
code under GPL, AGPL, LGPL, EUPL or a non-commercial licence is read for ideas
and never copied or linked.

| Need                          | Candidates                                                             | Licence                             | Decision                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Rust core                     | `core`, `alloc`, `libm`                                                | MIT or Apache-2.0                   | The only dependencies of the WebAssembly core ({{P09}})                                  |
| SIMD                          | `core::arch::wasm32`, `wide`                                           | Zlib, Apache-2.0 or MIT             | Fixed-width SIMD only; relaxed SIMD is not deterministic and is not used ({{P11}})       |
| Threads in WebAssembly        | `wasm-bindgen-rayon`, plain worker pool, `coi-serviceworker`           | Permissive                          | Worker pool first; threads optional behind detection ({{P12}})                           |
| Audio output                  | AudioWorklet with a ring buffer (`rtrb` natively)                      | Web standard; MIT or Apache-2.0     | Own ring buffer; MessagePort fallback without cross-origin isolation ({{P15}})           |
| FFT and resampling in tools   | `rustfft`, `realfft`, `rubato`                                         | MIT or Apache-2.0                   | Allowed in the command line tool and tests, not in the core                              |
| Benchmarks and licence checks | `criterion`, `cargo deny`                                              | Permissive                          | Development only ({{P09}}, {{P03}})                                                      |
| Optimisers                    | `argmin`, `cmaes`, own Nelder-Mead and CMA-ES                          | MIT or Apache-2.0                   | Own small implementations in JavaScript and Rust so that both give the same result       |
| Front-end algorithms          | Burg LPC, autocorrelation pitch (Boersma 1993), IAIF inverse filtering | Published algorithms                | Reimplemented from the papers ({{P46}} to {{P49}})                                       |
| Recognition design            | Kaldi online decoding, PocketSphinx                                    | Apache-2.0; BSD                     | Design ideas (fixed-lag commit, speaker adaptation between utterances); no code taken    |
| Pronunciation data            | CMUdict, CLDR, ipa-dict, WikiPron, PHOIBLE                             | BSD-style; Unicode-3.0; MIT; CC BY  | Per source in {{P35}}: commit only public-domain or CC0 data, fetch the rest             |
| Objective quality             | Mel-cepstral distortion, log-spectral distance, ESTOI, ViSQOL          | Formulas; Apache-2.0                | Own implementations of the formulas ({{P06}}); PESQ and POLQA are licensed: not used     |
| Listening tests               | webMUSHRA; ITU-R BS.1534                                               | Custom Fraunhofer licence; standard | Own small harness that follows the standard ({{P08}}); webMUSHRA is linked, not vendored |

## Best practices

Taken from the research and turned into rules of the plan.

- **Measure before and after.** Every bug quotes a command and its output;
  every feature has acceptance criteria with numbers and the test that checks
  them. Results of experiments are committed with their scripts.
- **A reference and a fast path.** The scalar double-precision build defines
  the expected output; faster builds (SIMD, single precision in 3D, threads)
  are compared with it inside a stated error bound.
- **Progressive enhancement.** Threads, shared memory, WebGPU and more cores
  make the app faster. None of them is needed for it to work, and each has a
  tested fallback.
- **Never block the interface or the audio thread.** Work happens in workers;
  the audio thread only copies samples; the benchmark runs in slices after
  the page has loaded.
- **Stable live output.** What was shown to the user is not taken back:
  syllables are committed with a fixed lag, and speaker parameters change only
  between utterances.
- **One notation in both directions.** The markup that drives the speaker is
  the notation the recogniser writes, in three layers: IPA with its
  diacritics for sounds, ExtIPA and VoQS marks for voice quality, and an
  SSML-like layer for prosody and emotion.
- **Licences are checked by a machine.** A dependency or a dataset outside the
  allow list fails CI.
- **Expensive checks on demand.** Pull requests stay fast; heavy suites are
  started by hand and publish their reports as artefacts.
- **Claims are limited to what was measured.** The vision and the reports say
  "goal" where no number exists.

## The plan

72 issues in six milestones. Each is a Bug or a Feature (GitHub issue type and
label), names its blockers (GitHub "blocked by" links), and has the same eight
sections: Goal, Why, Current state, What to do, Tests, Acceptance criteria, Out
of scope, References. The tables with numbers and the dependency graph are in
[docs/ROADMAP.md](../../ROADMAP.md).

| Milestone                                     | Issues                   | Bugs | Features |
| --------------------------------------------- | ------------------------ | ---- | -------- |
| 0. Foundations and measurement                | {{P01}}-{{P08}}          | 1    | 7        |
| 1. Rust engine and adaptive quality           | {{P09}}-{{P19}}          | 0    | 11       |
| 2. Voice physics and configuration            | {{P20}}-{{P29}}, {{P72}} | 2    | 9        |
| 3. Languages and modes of speech              | {{P30}}-{{P45}}          | 6    | 10       |
| 4. Reverse simulation (listening)             | {{P46}}-{{P65}}          | 0    | 20       |
| 5. Voice copy and state-of-the-art validation | {{P66}}-{{P71}}          | 0    | 6        |

How the issues were made deliverable by a weak agent:

- They name files, functions, argument lists, constants and formulas, and say
  what must not be touched.
- Names that several issues share were fixed before the issues were written
  ([plan/README.md](plan/README.md)).
- Tests are listed by name with the values to assert.
- Acceptance criteria are checkboxes with numbers.
- "Out of scope" points to the issue that owns each neighbouring topic.
- Every issue ends with the same rules (no neural networks, licences, one pull
  request per issue, determinism, tests, documentation).

## Assumptions

- **Scope.** The issue says that the scope is a docs update and created issues.
  No library code is changed here. The audit scripts are experiments.
- **Bug or feature.** "Bug" is used when the current behaviour is wrong against
  what the project already documents or against the language. Everything else,
  including tests, tools and infrastructure, is a Feature, because the issue
  asks for these two kinds only.
- **"Not smart AI agent".** Read as: an issue must be deliverable without
  reading other issues or research, and without design decisions left open.
- **"Never existed before".** Read as a claim to be checked by the survey and
  by measurement, not as a statement to be written into the README today.
- **Neural networks in evaluation.** The issue forbids them in the system. The
  vision extends this to tests and tools so that the project stays reproducible
  on any machine, and keeps published neural results as a yardstick.
- **Languages.** The four languages of the project stay the scope of the
  plan. The models take language data as tables, so further languages are data
  work.

## Risks

| Risk                                                                                | Where it is handled                                                                     |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A physical synthesiser without networks may not reach the naturalness of neural TTS | Measured from the start ({{P07}}, {{P08}}); reported honestly at the end ({{P71}})      |
| Inversion is not unique: many tract shapes give the same sound                      | Continuity constraint and speaker fit ({{P53}}); rescoring by resynthesis ({{P55}})     |
| Consonants carry little energy and decide the words                                 | Landmarks and consonant cues ({{P50}}, {{P54}}); physical noise for templates ({{P23}}) |
| The simulator's own speech is easier than real speech                               | Round trip first ({{P63}}), real recordings measured apart ({{P64}})                    |
| Real time for recognition on one core at the lowest tier                            | Budget per stage in the issues; Rust port ({{P65}}); certification ({{P69}})            |
| Speaker fit drifts while the person speaks                                          | Parameters frozen inside an utterance; stability criterion ({{P66}})                    |
| Datasets and dictionaries with attribution or share-alike licences                  | Licence gate ({{P04}}); such data is fetched, never committed                           |
| The Rust and JavaScript engines diverge                                             | Parity tests from the first port ({{P10}}); {{P70}}                                     |
| Cross-origin isolation is missing on GitHub Pages                                   | Everything works without shared memory ({{P12}}, {{P15}})                               |

## What could not be verified

Each research file ends with its own list. The points that matter for the
plan:

- The two listening studies that set the order of the physics work were read
  as abstracts and summaries, not as full texts.
- Speed-up figures for SIMD, threads and the 2D tier are estimates until
  {{P11}}, {{P12}} and {{P25}} measure them.
- No accuracy figure exists for a recogniser of this design; the targets in the
  recognition issues are the first measurements to make, not promises.
- Licences that were read from summaries and not from licence files are marked
  in [research 1](research/1-similar-projects.md); {{P03}} and {{P04}} require
  the licence file to be checked before anything is added.
