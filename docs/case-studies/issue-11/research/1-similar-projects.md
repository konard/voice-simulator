# Similar projects and projects that implement parts of the vision

_Scope: projects that overlap with the vision of a physical, non-neural voice simulator that also runs
"in reverse" (speech to text, voice copying). Research date: November 2026. Licences were read from each
repository's licence file, README or GitHub metadata; activity is the year of the last push or commit we saw;
paper facts come from pages or abstracts we opened, or from search-result summaries (marked as such).
Anything not confirmed is marked "(unverified)". Only ideas are proposed for reuse; no code is copied._

## How to read this survey

- **Licence matters because the host project is public domain (Unlicense).** GPL, AGPL, LGPL,
  non-commercial and "no licence" code cannot be copied into it. Permissive code (MIT, BSD, Apache-2.0,
  ISC) could be, but this survey still proposes ideas only.
- **"Vision part"** uses these labels: _synthesis_ (text or articulation to sound), _inversion_ (sound to
  articulation or parameters), _recognition_ (sound to phones or text), _voice copy_ (fit a speaker),
  _engine_ (Rust, WASM, worker), _expressive_ (tones, emotion, whisper), _front end_ (text to IPA).
- **"NN" flags** tell whether a project needs a neural network at run time. The vision excludes them, so
  neural projects are listed only for contrast.
- Groups A to F follow the task list; the summary table and the gap section are at the end.

## A. Articulatory and physical speech synthesizers

### VocalTractLab family (TU Dresden)

- **[VocalTractLab](https://www.vocaltractlab.de/)** ([source](https://github.com/TUD-STKS/VocalTractLab-dev)) - the
  reference articulatory synthesizer: a 3D geometric vocal tract, gestural scores, glottis models and a 1D
  acoustic simulation (feature list from memory of the manual, not re-read). Licence: GPL-3.0. Language: C++. Activity: GUI repository pushed 2024; the
  [VTL 2.4 manual](https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf) is the current documentation.
  Vision part: synthesis, expressive. Idea: gestural scores with separate tiers (lips, tongue tip, tongue body,
  velum, glottis, F0, lung pressure) as the plan format between phonemes and geometry.
- **[VocalTractLabBackend](https://github.com/TUD-STKS/VocalTractLabBackend-dev)** - the same engine without the GUI,
  exposed as a C/C++ API. Licence: GPL-3.0. Language: C++. Activity: pushed 2026. Vision part: engine. Idea: a small,
  stable, GUI-free API (load speaker, set tract and glottis parameters per frame, synthesise block) is exactly the
  boundary a Rust/WASM worker engine needs.
- **VocalTractLab Python wrappers** - [paul-krug/VocalTractLab-Python](https://github.com/paul-krug/VocalTractLab-Python)
  (GPL-3.0, pushed 2025) and [Simon-Stone/VocalTractLab-Python](https://github.com/Simon-Stone/VocalTractLab-Python)
  (GPL-3, last commit 2022). Vision part: engine, tooling. Idea: batch helpers that turn motor-parameter arrays into
  audio and transfer functions make optimisation loops easy to script.
- **VocalTractLab3D** - 3D acoustic simulation of the vocal tract with a multimodal (eigenfunction projection)
  method instead of FDTD; the [user guide](https://www.vocaltractlab.de/download-vocaltractlab/user_guide_vtl3d.pdf)
  describes it as free, GPL, C++, for Windows and Linux (licence statement seen in a search summary of the guide; we
  found no public repository). Vision part: synthesis (3D acoustics). Idea: use a multimodal solver as an independent
  cross-check of 3D FDTD transfer functions. Related: Mohapatra et al., Interspeech 2022, speed up a 3D FDTD model
  and compare it with FEM ([abstract](https://www.isca-archive.org/interspeech_2022/mohapatra22_interspeech.html),
  [PDF](https://www.vocaltractlab.de/publications/mohapatra-2022-interspeech.pdf)); no code repository was named.
- **[TargetOptimizer](https://github.com/TUD-STKS/TargetOptimizer)** - estimates pitch targets of the target
  approximation model from a measured F0 contour. Licence: GPL-3.0. Language: C++. Activity: pushed 2022. Vision part:
  inversion (prosody), expressive (tones). Idea: treat tone and intonation as a small set of per-syllable targets that
  are fitted to a recording by optimisation - an inverse problem with few parameters.
- **[Microprosody](https://github.com/TUD-STKS/Microprosody)** - supplementary code to Krug et al., "Modelling
  microprosodic effects can lead to an audible improvement in articulatory synthesis": it adds microprosodic
  deflections to the pitch contour of VocalTractLab utterances. Licence: GPL-3.0 (README). Language: Python.
  Activity: last commit 2022. Vision part: expressive. Idea: model segment-induced F0 deflections explicitly as a
  post-processing step on the pitch plan.
- **[PAULE](https://github.com/quantling/paule)** - "Predictive Articulatory speech synthesis Utilizing Lexical
  Embeddings": plans VocalTractLab control trajectories by iterative error minimisation. Licence: GPL-3.0. Language:
  Python. Activity: pushed 2025. NN: yes (predictive and inverse models). Vision part: inversion, voice copy. Idea:
  the planning loop itself (synthesise, compare with target, correct the plan) is independent of the neural parts.
- **[articubench](https://github.com/quantling/articubench)** - a benchmark for articulatory synthesis control
  models. Licence: GPL-3.0. Language: Python. Activity: pushed 2025. Vision part: evaluation. Idea: publish a fixed
  task list (its three tasks are acoustic only, i.e. copy synthesis, semantic-acoustic and semantic only) and report
  cost columns (execution time, memory, energy) next to quality.
- **[create_vtl_corpus](https://github.com/quantling/create_vtl_corpus)** - builds synthetic corpora with
  VocalTractLab. Licence: GPL-3 (README says this follows from the GPL VTL library and speaker file). Activity: last
  commit 2026. Vision part: tooling. Idea: generate paired (parameters, audio) corpora from one's own simulator to
  build inversion codebooks without any recorded data.

### Pink Trombone and its ports

- **[Pink Trombone](https://dood.al/pinktrombone/)** (Neil Thapen, 2017) - an interactive browser voice: a glottal
  source driving a 44-cell Kelly-Lochbaum waveguide that the user shapes with a finger. Licence: MIT according to the
  licence file in the mirror [evykassirer/pink-trombone](https://github.com/evykassirer/pink-trombone) (last commit
  2019). Language: JavaScript. Vision part: synthesis. Idea: two-number tongue control (index, diameter) plus
  transient constrictions is the smallest articulation space that still sounds like speech.
- **[zakaton/Pink-Trombone](https://github.com/zakaton/Pink-Trombone)** - a programmable version with an API.
  Licence: GPL-3.0. Language: JavaScript. Activity: pushed 2025. Vision part: synthesis, engine. Idea: expose every
  constriction and glottis value as an automatable audio parameter.
- **[chdh/pink-trombone-mod](https://github.com/chdh/pink-trombone-mod)** - a modularised TypeScript rewrite.
  Licence: MIT. Activity: pushed 2019. Idea: separate glottis, tract, tract shaper and UI into independent modules.
- **[lostmsu/pink-trombone](https://github.com/lostmsu/pink-trombone)** - a Rust conversion of the TypeScript
  version (crate `pink-trombone`). Licence: MIT. Activity: pushed 2021. Vision part: engine. Idea: proof that the
  waveguide core ports to Rust almost line by line.
- **[sunsided/synthie-trombone](https://github.com/sunsided/synthie-trombone)** - a Rust Pink Trombone with phonemes
  and text-to-speech, described as allocation-free and sample-rate independent; the browser build runs the Rust
  engine through WebAssembly in an AudioWorklet. Licence: EUPL-1.2 (derived from the MIT original). Activity: crate
  v0.2.0 created November 2026. Vision part: engine, synthesis. Idea: the closest existing example of the target
  architecture (Rust core, WASM, audio worklet, terminal app and library from one crate).
- **Other ports** - [cutelabnyc/pink-trombone-cpp](https://github.com/cutelabnyc/pink-trombone-cpp) (MIT, C++, pushed 2021) and [dkadish/pynkTrombone](https://github.com/dkadish/pynkTrombone) (no licence file, Python, pushed 2022).

### Differentiable vocal tract simulators

- **[vocal-tract-grad](https://github.com/davidmarttila/vocal-tract-grad)** - Pink Trombone rewritten in PyTorch so
  that tract controls are recovered from a recording by gradient descent; paper: Suedholt, Camara, Xu and Reiss,
  DAFx 2023 ([arXiv:2307.04702](https://arxiv.org/abs/2307.04702)). Licence: none in the repository (so not reusable).
  Language: Python. Activity: pushed 2023. NN: no network in the model, but it depends on an autodiff framework.
  Vision part: inversion, voice copy. Idea: compute the loss against an analytical transfer function of the tube
  (not against the time-domain waveform) and separate the glottal source first by inverse filtering (GFM-IAIF).
- **[VocalTrax](https://github.com/PapayaResearch/vocaltrax)** ([site](https://vocaltrax.media.mit.edu),
  [OpenReview](https://openreview.net/forum?id=kIDxwvWznF)) - a JAX implementation of a differentiable articulatory
  synthesizer for voice fitting (NeurIPS Audio Imagination workshop 2024). Licence: MIT. Activity: last commit 2025.
  NN: installs the neural pitch tracker CREPE, so the pipeline is not network-free. The authors report "persistent
  challenges in matching natural voice quality". Vision part: inversion, voice copy. Idea: vectorise the simulator so
  thousands of candidate parameter sets are evaluated in one batch.
- **Differentiable Kelly-Lochbaum model for biphonic singing** (Camara et al., DAFx 2026,
  [arXiv:2606.04943](https://arxiv.org/abs/2606.04943),
  [PDF](https://dafx.de/paper-archive/2026/papers/DAFx26_paper_39.pdf)) - adds a second source, a cubic B-spline
  tract and learnable damping; the abstract reports a 30-38% cut in log-spectral distance against an articulatory
  baseline. No code link found. Vision part: inversion. Idea: parameterise the area function with a few spline
  control points and make wall damping a fitted parameter.
- **"Reconstructing the vocal tract with differentiable acoustic simulation"** (Chen, Lee and Sitzmann,
  [NeurIPS 2026 poster](https://neurips.cc/virtual/2026/poster/151084),
  [OpenReview](https://openreview.net/forum?id=d61YXzFcB9)) - a GPU acoustic tube simulator in the frequency domain
  (reported as about 70 times more parallelisable than FDTD) with a differentiable turbulence model, tested on 11
  languages. NN: yes, the geometry is parameterised by a network. No code link found. Idea: a frequency-domain
  solver as the fast forward model inside the inversion loop, with the time-domain solver kept for final rendering.

### Other articulatory synthesizers and models

- **gnuspeech** - [gnuspeech_sa](https://github.com/mym-br/gnuspeech_sa) (GPL-3.0-or-later, C++, pushed 2024) and the
  older [GnuSpeech](https://github.com/nygard/GnuSpeech) port (last commit 2015); see the
  [overview](https://en.wikipedia.org/wiki/Gnuspeech). A complete rule-based text-to-speech system on a tube
  resonance model. Vision part: synthesis, front end. Idea: the only fully rule-driven pipeline from text to a
  waveguide; its posture tables, transition rules and rhythm/intonation models are the classic design to study.
- **[Praat articulatory synthesis](https://www.fon.hum.uva.nl/praat/manual/Articulatory_synthesis.html)** - a
  `Speaker` plus an `Artword` (muscle activities over time) produce sound
  ([manual](https://www.fon.hum.uva.nl/praat/manual/Artword___Speaker__To_Sound___.html)). Licence: GPL-3.0-or-later
  ([repository](https://github.com/praat/praat.github.io)). Language: C/C++. Activity: pushed 2026. Vision part:
  synthesis. Idea: drive the model with muscle activations and let walls be mass-spring systems, so voicing and
  closures emerge from aerodynamics instead of being switched on.
- **[TADA](https://haskinslaboratories.org/tada)** (Haskins Laboratories) - task dynamics and gestural scores,
  version 0.982, MATLAB. Licence: "for non-commercial use only", no redistribution without permission; the page says
  it is no longer supported and that full audio needs the commercial HLsyn. CASY licence: (unverified). Vision part:
  synthesis (planning). Idea: coupled-oscillator timing of gestures instead of fixed segment durations.
- **[VocalTractModels](https://github.com/sensein/VocalTractModels)** - Maeda's articulatory model (VTCalcs and
  VTsynth) as C/C++ MEX code. Licence: Apache-2.0. Activity: last commit 2023. Vision part: synthesis, inversion.
  Idea: seven statistically derived articulatory parameters form a compact, well-studied basis for inversion.
- **[DIVA, GODIVA and SimpleDIVA](https://sites.bu.edu/guentherlab/software)** - speech motor control models from
  the Guenther lab, MATLAB/Simulink, "freely available", no explicit licence seen. A PyTorch reimplementation,
  [TorchDIVA](https://github.com/skinahan/DIVA_PyTorch) ([arXiv:2210.09334](https://arxiv.org/abs/2210.09334)), has
  no licence file (last commit 2023). NN: DIVA is a neural model by design. Vision part: inversion (control). Idea:
  targets as regions in auditory space with feedforward plus feedback correction - usable as a plain control loop.
- **TubeTalker** (B. Story) - an airway modulation model: a vowel substrate from two shaping modes with consonant
  constrictions superimposed ([paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC3596841),
  [record](https://experts.arizona.edu/en/publications/phrase-level-speech-simulation-with-an-airway-modulation-model-of/)).
  We found audio demonstrations only, no code download or licence. Vision part: synthesis. Idea: describe an
  utterance as vowel modes plus timed constriction events on a neutral tract.
- **[TubeN](https://github.com/jbeskow/tuben)** - a tube model that computes formant frequencies from segment
  lengths and areas (algorithms from Liljencrants and Fant 1975), synthesises static vowels and, per its
  [preprint](https://www.biorxiv.org/content/10.1101/2025.10.15.682256.full.pdf) (search summary), has a GUI and
  exports printable STL files. Licence: MIT. Language: Python. Activity: last commit 2026. Idea: export the tract as a printable tube to validate simulated
  formants against a physical measurement.
- **[ArtiSynth](https://github.com/artisynth/artisynth_core)** - biomechanical modelling (multibody plus finite
  elements) used for tongue, jaw and airway models. Licence: BSD 2-clause. Language: Java. Activity: pushed 2026.
  Vision part: synthesis (biomechanics). Idea: derive articulator shapes from muscle activations, then hand the
  resulting airway to the acoustic solver.
- **Generic wave solvers** - [k-Wave](https://github.com/ucl-bug/k-wave) (LGPL-3.0, MATLAB, pushed 2026),
  [openEMS](https://github.com/thliebig/openEMS) (GPL-3.0, C++, an electromagnetic FDTD solver, pushed 2026) and
  openCFS, whose aeroacoustic pipeline was applied to human phonation
  ([arXiv:2302.13290](https://arxiv.org/abs/2302.13290); licence unverified). We did not confirm a published vocal
  tract study for k-Wave or openEMS. Idea: use an independent solver as a numerical reference for a few static shapes.
- **[The Synthesis ToolKit (STK)](https://github.com/thestk/stk)** - physical-modelling audio classes. Licence:
  MIT-style. Language: C++. Activity: pushed 2025. Idea: small composable unit generators with a uniform `tick` API.
- **Talking robots** (H. Sawada, Kagawa University) - a mechanical vocal system (air pump, artificial vocal cords,
  resonance tube, nasal cavity) that learns to speak through auditory feedback
  ([article record](https://www.jstage.jst.go.jp/article/ijae/14/2/14_95/_article/-char/en), seen in search
  results, not opened). NN: yes, for the motor-to-sound mapping. Idea: closing the loop through a microphone is the
  same "listen to yourself" loop that parameter fitting needs.
- **Rust formant and voice crates** - [klattsch-rs](https://github.com/tgies/klattsch-rs) (MIT, Klatt 1980
  parallel-formant synth with a WASM AudioWorklet build, 2026; a port of the JavaScript
  [klattsch](https://github.com/tgies/klattsch)), [klatt](https://github.com/TTWNO/klatt) (MIT OR Apache-2.0, 2025),
  [svara](https://github.com/MacCracken/svara) (GPL-3.0-only, formant synthesis with Rosenberg and LF glottal models,
  nine tones and a whisper-to-shout effort continuum, 2026), [grail-rs](https://github.com/Dimev/grail-rs) (dual
  Apache/MIT per README, last commit 2023) and the DSP graph library [fundsp](https://github.com/SamiPerttu/fundsp)
  (MIT OR Apache-2.0, last commit 2026). Vision part: engine. Idea: realtime-safe `process` functions with no
  allocation, published as small crates.

## B. Non-neural rule, formant, concatenative and statistical TTS

- **[eSpeak NG](https://github.com/espeak-ng/espeak-ng)** - compact formant synthesizer with rule-based front ends
  for more than a hundred languages. Licence: GPL-3.0. Language: C. Activity: pushed 2026. Vision part: front end,
  synthesis. Idea: per-language rule files plus phoneme tables keep a language to kilobytes; there is also a Rust
  port, [espeak-ng-rs](https://github.com/eugenehp/espeak-ng-rs) (GPL-3.0-or-later, 2026).
- **[klatt-syn](https://github.com/chdh/klatt-syn)** - Klatt cascade-parallel formant synthesizer. Licence: MIT.
  Language: TypeScript. Activity: pushed 2026. Also [tdklatt](https://github.com/guestdaniel/tdklatt) (MIT, Python,
  2018). Idea: a formant baseline in the same language is the cheapest A/B reference for listening tests.
- **[DECtalk source archive](https://github.com/dectalk/dectalk)** - the classic formant synthesizer. Licence:
  proprietary; the licence file says the software "is proprietary to and embodies the confidential technology of
  FONIX Corporation". Activity: pushed 2026. Idea: study only through published papers; do not read into the code.
- **[SAM](https://github.com/s-macke/SAM)** (C) and **[sam](https://github.com/discordier/sam)** (JavaScript) -
  reverse-engineered Software Automatic Mouth. Licence: none; both READMEs call it abandonware that cannot be put
  under an open licence. Activity: pushed 2024. Idea: none to take beyond the lesson that tiny rule tables suffice
  for intelligibility. A Rust port exists: [samiam](https://github.com/06chaynes/samiam) (MIT OR Apache-2.0, 2026).
- **[MBROLA](https://github.com/numediart/MBROLA)** - diphone concatenation. Licence: AGPL-3.0; the
  [voices](https://github.com/numediart/MBROLA-voices) carry their own terms ("synthesizing speech with and only
  with MBROLA"). Language: C. Activity: pushed 2025. Idea: a plain phoneme, duration and pitch-point list as the
  interchange format between front end and synthesizer.
- **[Festival](https://github.com/festvox/festival)** and **[Flite](https://github.com/festvox/flite)** - general
  TTS framework and its small C runtime. Licence: permissive BSD/X11-style (Edinburgh, CMU). Activity: pushed 2026
  and 2024. Idea: the utterance structure (relations over items) as a uniform container for every pipeline stage.
- **[RHVoice](https://github.com/RHVoice/RHVoice)** - statistical parametric (HMM, built on HTS) synthesizer with
  Russian and other languages. Licence: LGPL-2.1-or-later for the library, GPL-3-or-later when built with MAGE;
  several voices are non-commercial ([licence notes](https://github.com/RHVoice/RHVoice/blob/master/doc/en/License.md)).
  Language: C++. Activity: pushed 2026. NN: no (HMM). Idea: its Russian text processing (stress, letter-to-sound)
  shows what a rule front end must cover.
- **HTS and hts_engine** - HMM-based synthesis ([project site](https://hts.sp.nitech.ac.jp)); the run-time
  [hts_engine API](https://hts-engine.sourceforge.net) is under the Modified BSD licence, version 1.10 (December 2015).
  Licence of the HTS training patch: (unverified). NN: no (HMM). Idea: generate smooth parameter trajectories from
  static plus dynamic feature statistics instead of interpolating targets linearly.
- **Votrax SC-01A emulation in [MAME](https://github.com/mamedev/mame)** - a circuit-level simulation
  ([votrax.cpp](https://github.com/mamedev/mame/blob/master/src/devices/sound/votrax.cpp), file header BSD-3-Clause).
  Language: C++. Idea: validate a synthesizer against a hardware reference at the signal level.
- **[meSpeak.js](https://masswerk.at/mespeak/)** - eSpeak compiled to JavaScript. Licence: GPL v3 (per search
  summary of the page). Idea: none new; shows the browser-delivery path taken a decade ago.
- **[MaryTTS](https://github.com/marytts/marytts)** - modular Java TTS (the README's default example is an HSMM voice). Licence:
  LGPL v3. Activity: pushed 2025. Idea: an inspectable intermediate document after each processing module.
- **[NV Speech Player](https://github.com/nvaccess/nvSpeechPlayer)** - "a Klatt-based speech synthesis engine".
  Licence: GPL v2. Language: C++. Activity: unmaintained (last commit 2021). Idea: frame queue with parameter
  interpolation between frames for click-free transitions.
- **[Echogarden](https://github.com/echogarden-project/echogarden)** - a speech toolset (synthesis, recognition,
  alignment). Licence: MIT source; GPL libraries such as eSpeak NG are downloaded only when needed. Activity: last
  commit 2026. NN: yes for recognition (Whisper) and most voices; its DTW alignment modes are algorithmic. Idea:
  alignment against a synthesised reference with multi-pass DTW.

## C. Non-neural speech recognition and alignment

- **[Kaldi](https://github.com/kaldi-asr/kaldi)** - the standard toolkit; its GMM-HMM recipes are network-free.
  Licence: Apache-2.0. Language: C++. Activity: pushed 2025. Vision part: recognition. Idea: weighted finite-state
  transducers to compose lexicon, grammar and acoustic scores - reusable with any acoustic scorer.
- **[PocketSphinx](https://github.com/cmusphinx/pocketsphinx)** and **[Sphinx4](https://github.com/cmusphinx/sphinx4)** -
  GMM-HMM recognisers. Licence: BSD-style. Language: C and Java. Activity: pushed 2026 and 2020. Idea: keyword
  spotting and grammar-constrained decoding as low-cost first products.
- **[pocketsphinx.js](https://github.com/syl22-00/pocketsphinx.js)** - PocketSphinx in the browser. Licence: MIT.
  Language: JavaScript/WebAssembly. Activity: pushed 2020. Idea: evidence that non-neural recognition runs in a
  web worker; recogniser in a worker with message passing.
- **[Julius](https://github.com/julius-speech/julius)** and **[JuliusJS](https://github.com/zzmp/juliusjs)** -
  two-pass large-vocabulary decoder and its browser build. Licence: BSD-3-Clause and MIT (modifications). Activity:
  pushed 2025 and 2016. Idea: the README's "2-pass strategy" - a fast first pass, then rescoring.
- **HTK** - the Hidden Markov Model Toolkit. Licence: registration required and no redistribution; a mirror shows the
  end-user licence text ([htk_3_4_1](https://github.com/ibillxia/htk_3_4_1)). The official licence page was seen in
  search results but its server did not answer our link check. Idea: none in code; the HTK Book concepts only.
- **[Montreal Forced Aligner](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner)** - forced alignment
  using Kaldi. Licence: MIT. Language: Python. Activity: pushed 2026. Vision part: recognition (alignment). Idea:
  alignment as the first reverse step: with known text, find timing, then fit articulation per segment.
- **[Gentle](https://github.com/strob/gentle)** - "robust yet lenient forced-aligner built on Kaldi". Licence: MIT.
  Activity: pushed 2026. Whether its acoustic model is neural: (unverified).
- **[aeneas](https://github.com/readbeyond/aeneas)** - aligns text and audio by synthesising the text with a TTS
  engine (eSpeak by default) and aligning MFCCs of real and synthetic audio with Sakoe-Chiba band DTW
  ([how it works](https://github.com/readbeyond/aeneas/blob/master/wiki/HOWITWORKS.md)). Licence: AGPL-3.0. Language:
  Python/C. Activity: pushed 2026. NN: no. Vision part: recognition (alignment) by synthesis. Idea: the simplest
  working "run the synthesizer and compare" system; the same loop works with a physical synthesizer as the reference.
- **Other aligners** - [Prosodylab-Aligner](https://github.com/prosodylab/Prosodylab-Aligner) (MIT, last commit
  2020), [FAVE](https://github.com/JoFrhwld/FAVE) (GPL-3, last commit 2024), and the curated list
  [forced-alignment-tools](https://github.com/pettarin/forced-alignment-tools) (CC BY 4.0, 2026).
- **Landmark and phonetic-feature recognisers** - SpeechMark, a MATLAB landmark detector in the Stevens tradition
  ([Interspeech 2012](https://www.isca-archive.org/interspeech_2012/boyce12_interspeech.html)); Juneja and
  Espy-Wilson's probabilistic landmark framework using manner features (syllabic, sonorant, continuant)
  ([thesis record](https://drum.lib.umd.edu/items/a4be15d3-4882-4855-9eee-6b9a37c49e0f/full)); the 2004 Johns
  Hopkins workshop report on landmark-based recognition
  ([PDF](https://ttic.edu/livescu/papers/hasegawa-johnson_etal_ICASSP05.pdf), seen in search results); and the
  [Auto-Landmark](https://arxiv.org/pdf/2409.07969) toolkit and dataset (arXiv 2409.07969). Licences: (unverified).
  Idea: detect abrupt acoustic events (closures, releases, voicing onsets) first; they map directly to articulatory
  gestures and segment the signal for inversion.
- **Classic DTW template recognition** - isolated words matched to stored templates by
  [dynamic time warping](https://en.wikipedia.org/wiki/Dynamic_time_warping). We did not find a maintained
  open-source project to cite. Idea: synthesise the templates instead of recording them.
- **Neural recognisers, for contrast only** - [Allosaurus](https://github.com/xinjli/allosaurus) (GPL-3.0, a
  pretrained universal phone recogniser for more than 2000 languages, pushed 2024),
  [Vosk](https://github.com/alphacep/vosk-api) (Apache-2.0, 2026) and
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0). Allosaurus shows the target output (audio to
  IPA phones, then language-specific mapping) that the vision wants to reach without a network.

## D. Analysis-by-synthesis and simulation in reverse

- **Articulatory copy synthesis with a genetic algorithm** (Gao, Stone and Birkholz, Interspeech 2019,
  [abstract](https://www.isca-archive.org/interspeech_2019/gao19e_interspeech.html),
  [PDF](https://www.vocaltractlab.de/publications/gao-2019-interspeech.pdf)) - a rule-based initial gestural score is
  refined by a genetic algorithm that minimises a cosine distance between acoustic features; regularisation raised
  perceptual similarity and the genetic algorithm beat coordinate descent. NN: no. No released code found. Idea:
  start from the rule-based plan for the known text and optimise only deviations, with a regulariser that keeps
  gestures plausible.
- **Neural copy synthesis, for contrast** (Gao, Birkholz and Li, 2024) - a search summary reports word accuracies of
  73.88% (German), 52.92% (English) and 52.41% (Mandarin) when a commercial recogniser transcribes the
  copy-synthesised speech (not opened, unverified). It shows how far copy synthesis is from natural intelligibility.
- **Related VocalTractLab studies** - error metrics for optimising articulatory vowel synthesis
  ([Gerazov et al. 2024](https://www.vocaltractlab.de/publications/gerazov-2024-specom.pdf)), principal components
  to shrink the motor parameter space ([Krug et al. 2022](https://www.vocaltractlab.de/publications/krug-2022-essv.pdf))
  and analysis-by-synthesis of Thai vowel targets
  ([Prom-on et al. 2014](https://vocaltractlab.de/publications/prom-on-2014-cocosda.pdf)). Idea: the choice of
  spectral distance and a reduced parameter basis decide whether the optimisation converges.
- **Vowel inversion with the Maeda model** (Panchapagesan and Alwan, JASA 2011,
  [full text](https://pmc.ncbi.nlm.nih.gov/articles/pmid/21476670)) - analysis-by-synthesis with a codebook that
  initialises a continuous optimisation, with regularisation and continuity terms. NN: no. Idea: a codebook lookup
  gives several starting points, which is the standard answer to the non-uniqueness of the inverse problem.
- **Inversion codebooks** - Ouni and Laprie's hypercube codebook
  ([Eurospeech 2001](https://www.isca-archive.org/eurospeech_2001/ouni01_eurospeech.pdf)) and cepstral inversion by
  Busset and Laprie ([HAL record](https://hal.archives-ouvertes.fr/hal-00836808)); the Schroeter and Sondhi 1994
  review of vocal-tract shape estimation (seen in search results; its link failed our check). Idea: sample the
  articulatory space adaptively, denser where the acoustic mapping is non-linear.
- **Analysis-by-synthesis recognition, the original proposal** - Halle and Stevens, "Speech recognition: a model
  and a program for research", IRE Transactions on Information Theory 8(2), 1962, DOI 10.1109/TIT.1962.1057686
  (bibliographic record seen in search results). It proposes recognising speech by internally generating candidates
  and comparing them with the input. No software. Idea: this is the theoretical basis of the "reverse" mode.
- **Analysis-by-synthesis features for recognition** (Al Bawab, Raj and Stern, ICASSP 2008, DOI
  10.1109/ICASSP.2008.4518577, [listing](https://sciweavers.org/node/76713)) - a codebook of articulatory
  configurations drives a physiologically motivated synthesizer; the distortion between synthesised and real speech
  becomes the feature vector for a GMM phoneme classifier, which improved results when combined with MFCC scores. A
  [follow-up](https://qscience.com/content/papers/10.5339/qfarf.2012.AESNP6) reports a 10.9% relative phone error
  reduction over an MFCC baseline (search summary). NN: no. No released code found. Idea: the closest published
  design to the vision - use per-codeword synthesis distortion as the acoustic score of a conventional decoder.
- **Gradient-based inversion** - vocal-tract-grad, VocalTrax and the two 2026 papers in group A.
- **Auditory feedback in talking robots** - Sawada's robot in group A (neural mapping).
- **One model for both directions** - we found no released project that uses a single physical or articulatory
  model for both text-to-speech and speech-to-text. The nearest are aeneas (alignment only, formant reference),
  Al Bawab et al. (features only, paper) and Echogarden (one toolkit, but separate and mostly neural engines).

## E. Voice analysis toolkits

- **[Praat](https://github.com/praat/praat.github.io)** and **[Parselmouth](https://github.com/YannickJadoul/Parselmouth)** -
  the reference phonetics toolkit and its Python interface. Licence: GPL-3.0-or-later. Language: C/C++ and Python.
  Activity: both pushed 2026. Vision part: inversion (measurement). Idea: use Praat numbers (F0, formants, HNR) as
  the external yardstick in tests, called as a separate tool. Helper scripts:
  [PraatScripts](https://github.com/drfeinberg/PraatScripts) (MIT, 2021).
- **[WORLD](https://github.com/mmorise/World)** - vocoder that splits speech into F0, spectral envelope and
  aperiodicity. Licence: modified BSD. Language: C++. Activity: pushed 2026. Rust port:
  [world-rs](https://github.com/JamesFysh/world-rs) (BSD-3-Clause, 2026). Idea: the three-stream decomposition is a
  ready target representation for fitting a physical model.
- **[legacy STRAIGHT](https://github.com/HidekiKawahara/legacy_STRAIGHT)** - Licence: Apache-2.0. Language: MATLAB.
  Activity: pushed 2018. Idea: pitch-adaptive spectral smoothing to remove harmonic structure before comparison.
- **[REAPER](https://github.com/google/REAPER)** - pitch and glottal closure instant tracker. Licence: Apache-2.0.
  Language: C++. Activity: archived (pushed 2021). Idea: epoch detection gives pitch-synchronous frames.
- **[COVAREP](https://github.com/covarep/covarep)** - glottal source and voice-quality algorithms. Licence: the
  repository "does not have a single license" (per-file terms). Language: MATLAB/Octave. Activity: pushed 2020.
  Idea: inverse filtering and glottal-model fitting to estimate the source before fitting the tract.
- **[openSMILE](https://github.com/audeering/opensmile)** - feature extractor. Licence: audEERING research licence,
  non-commercial use only - not open source. Language: C++. Activity: pushed 2026. Idea: only its published feature
  sets as a checklist.
- **[SPTK](https://github.com/sp-nitech/SPTK)** - speech signal processing commands (mel-cepstra, LPC, pitch).
  Licence: Apache-2.0. Language: C++. Activity: pushed 2026. Idea: small composable command-line tools.
- **[aubio](https://github.com/aubio/aubio)** (GPL-3.0, C, pushed 2026), **[Essentia](https://github.com/MTG/essentia)**
  (AGPL-3.0, C++, pushed 2026) and **[librosa](https://github.com/librosa/librosa)** (ISC, Python, pushed 2026) -
  general audio analysis; their signal-processing parts are network-free.
- **[VoiceSauce](https://phonetics.ucla.edu/voicesauce)** - MATLAB voice measures (H1-H2, CPP, HNR and others),
  v1.37 of June 2020; the page states no licence. **[opensauce-python](https://github.com/voicesauce/opensauce-python)**
  is Apache-2.0 (last commit 2019). Idea: harmonic-amplitude differences as compact voice-quality descriptors.
- **Others** - [pYIN](https://github.com/c4dm/pyin) (GPL v2, 2020), [DisVoice](https://github.com/jcvasquezc/DisVoice)
  (MIT, 2025), [Surfboard](https://github.com/novoic/surfboard) (GPL-3, 2020).
- **Rust building blocks** - [RustFFT](https://github.com/ejmahler/RustFFT) (MIT OR Apache-2.0, 2026),
  [realfft](https://github.com/HEnquist/realfft) (MIT, 2026),
  [pitch-detection](https://github.com/alesgenova/pitch-detection) (MIT/Apache-2.0, 2023),
  [pyin-rs](https://github.com/hillin/pyin-rs) (MIT, 2025),
  [linear-predictive-coding](https://github.com/oligamiq/linear-predictive-coding) (MIT OR Apache-2.0, 2025),
  [vox_box.rs](https://github.com/andrewcsmith/vox_box.rs) (no licence file, last commit 2020) and
  [Sonorant](https://github.com/therebelrobot/sonorant) (Unlicense, 2026) - a local-first voice analysis tool whose
  Rust core (LPC, YIN, cepstrum, formants) runs as WebAssembly in a worker fed by an AudioWorklet. Sonorant is the
  only public-domain analysis core we found and uses the same worker architecture as the vision.

## F. IPA and phonology resources

- **[PHOIBLE](https://github.com/phoible/dev)** ([site](https://phoible.org/)) - phoneme inventories of the world's
  languages. Licence: data CC BY 4.0, code MIT. Activity: pushed 2026. Idea: check per-language phoneme coverage
  against inventories; attribution is required.
- **[PanPhon](https://github.com/dmort27/panphon)** - IPA segments to articulatory feature vectors. Licence: MIT.
  Activity: pushed 2025. Idea: feature vectors give a distance between phones for scoring recognition output.
- **[Epitran](https://github.com/dmort27/epitran)** - rule-based grapheme-to-IPA for many languages. Licence: MIT.
  Activity: pushed 2026. Idea: mapping tables plus pre- and post-processing rules per language.
- **[WikiPron](https://github.com/CUNY-CL/wikipron)** - mines pronunciations from Wiktionary. Licence: Apache-2.0
  for the tool; licence of the mined data (unverified here). Activity: pushed 2026.
- **[CMUdict](https://github.com/cmusphinx/cmudict)** - English pronouncing dictionary. Licence: BSD-style.
  Activity: pushed 2025. **[ipa-dict](https://github.com/open-dict-data/ipa-dict)** - IPA word lists for many
  languages. Licence: MIT (repository); per-language source terms (unverified). Activity: pushed 2026.
- **[Phonemizer](https://github.com/bootphon/phonemizer)** - wrapper around eSpeak and other back ends. Licence:
  GPL-3.0. Activity: pushed 2026. **[gruut](https://github.com/rhasspy/gruut)** - tokeniser and phonemiser. Licence:
  MIT. Activity: last commit 2024.
- **[Unicode CLDR](https://github.com/unicode-org/cldr)** - locale data, number spell-out and transliteration
  rules. Licence: Unicode License V3. Activity: pushed 2026. Idea: rule-based number formatting data for text
  normalisation.
- **[CLTS](https://github.com/cldf-clts/clts)** - cross-linguistic transcription systems. Licence: CC BY 4.0.
  Activity: last commit 2026. Idea: a canonical naming of sounds to reconcile transcription conventions.
- **Grapheme-to-phoneme tools** - [Phonetisaurus](https://github.com/AdolfVonKleist/Phonetisaurus) (BSD-3-Clause,
  WFST, 2024), [Sequitur G2P](https://github.com/sequitur-g2p/sequitur-g2p) (GPL v2, 2025),
  [Pynini](https://github.com/kylebgorman/pynini) (Apache-2.0, 2025) and
  [python-pinyin](https://github.com/mozillazg/python-pinyin) (MIT, 2026, Chinese characters to pinyin).

## Summary table

| Project                                      | Group | Licence               | Language        | Part of vision covered   | Idea to take                   |
| -------------------------------------------- | ----- | --------------------- | --------------- | ------------------------ | ------------------------------ |
| VocalTractLab                                | A     | GPL-3.0               | C++             | synthesis, expressive    | gestural score tiers           |
| VocalTractLabBackend                         | A     | GPL-3.0               | C++             | engine                   | minimal GUI-free API           |
| VocalTractLab-Python                         | A     | GPL-3.0               | Python          | tooling                  | batch synthesis helpers        |
| VocalTractLab3D                              | A     | GPL (per guide)       | C++             | 3D acoustics             | multimodal cross-check         |
| TargetOptimizer                              | A     | GPL-3.0               | C++             | prosody inversion        | fit pitch targets              |
| Microprosody                                 | A     | GPL-3.0               | Python          | expressive               | explicit F0 deflections        |
| PAULE                                        | A     | GPL-3.0               | Python          | inversion (NN)           | plan-correct loop              |
| articubench                                  | A     | GPL-3.0               | Python          | evaluation               | fixed benchmark tasks          |
| create_vtl_corpus                            | A     | GPL-3                 | Python          | tooling                  | synthetic paired corpora       |
| Pink Trombone                                | A     | MIT (mirror)          | JavaScript      | synthesis                | two-number tongue control      |
| zakaton/Pink-Trombone                        | A     | GPL-3.0               | JavaScript      | synthesis                | automatable parameters         |
| pink-trombone-mod                            | A     | MIT                   | TypeScript      | synthesis                | module boundaries              |
| lostmsu/pink-trombone                        | A     | MIT                   | Rust            | engine                   | direct Rust port               |
| synthie-trombone                             | A     | EUPL-1.2              | Rust/WASM       | engine, synthesis        | worklet architecture           |
| pink-trombone-cpp                            | A     | MIT                   | C++             | synthesis                | -                              |
| pynkTrombone                                 | A     | none                  | Python          | synthesis                | -                              |
| vocal-tract-grad                             | A, D  | none                  | Python          | inversion, voice copy    | transfer-function loss         |
| VocalTrax                                    | A, D  | MIT                   | Python (JAX)    | inversion, voice copy    | batched candidates             |
| Differentiable KL (DAFx 2026)                | A, D  | paper                 | -               | inversion                | spline tract, fitted damping   |
| Differentiable tube simulator (NeurIPS 2026) | A, D  | paper (NN)            | -               | inversion                | frequency-domain forward model |
| gnuspeech                                    | A     | GPL-3.0-or-later      | C++             | synthesis, front end     | rule-driven tube TTS           |
| Praat articulatory synthesis                 | A     | GPL-3.0-or-later      | C/C++           | synthesis                | muscles and mass-spring walls  |
| TADA                                         | A     | non-commercial        | MATLAB          | planning                 | coupled-oscillator timing      |
| VocalTractModels (Maeda)                     | A     | Apache-2.0            | C/C++           | synthesis, inversion     | seven-parameter basis          |
| DIVA / GODIVA                                | A     | not stated            | MATLAB          | control (NN)             | target regions, feedback       |
| TorchDIVA                                    | A     | none                  | Python          | control (NN)             | -                              |
| TubeTalker                                   | A     | no code               | -               | synthesis                | modes plus constriction events |
| TubeN                                        | A     | MIT                   | Python          | validation               | printable tube check           |
| ArtiSynth                                    | A     | BSD-2-Clause          | Java            | biomechanics             | muscle-driven shapes           |
| k-Wave                                       | A     | LGPL-3.0              | MATLAB          | reference solver         | numerical cross-check          |
| openEMS                                      | A     | GPL-3.0               | C++             | reference solver         | -                              |
| STK                                          | A     | MIT-style             | C++             | engine                   | uniform `tick` units           |
| Sawada talking robot                         | A, D  | hardware (NN)         | -               | feedback learning        | microphone in the loop         |
| klattsch-rs                                  | A, B  | MIT                   | Rust/WASM       | engine                   | realtime-safe process          |
| klatt (crate)                                | A, B  | MIT OR Apache-2.0     | Rust            | engine                   | -                              |
| svara                                        | A, B  | GPL-3.0-only          | Rust/Cyrius     | expressive               | effort continuum, tones        |
| fundsp                                       | A     | MIT OR Apache-2.0     | Rust            | engine                   | DSP graph notation             |
| eSpeak NG                                    | B     | GPL-3.0               | C               | front end, synthesis     | compact rule files             |
| espeak-ng-rs                                 | B     | GPL-3.0-or-later      | Rust            | front end                | -                              |
| klatt-syn                                    | B     | MIT                   | TypeScript      | baseline                 | A/B reference                  |
| tdklatt                                      | B     | MIT                   | Python          | baseline                 | -                              |
| DECtalk archive                              | B     | proprietary           | C               | synthesis                | papers only                    |
| SAM                                          | B     | none (abandonware)    | C / JavaScript  | synthesis                | -                              |
| samiam                                       | B     | MIT OR Apache-2.0     | Rust            | synthesis                | -                              |
| MBROLA                                       | B     | AGPL-3.0              | C               | synthesis                | phoneme-duration-pitch format  |
| Festival                                     | B     | BSD/X11-style         | C++             | front end                | utterance structure            |
| Flite                                        | B     | BSD-style             | C               | front end                | small runtime                  |
| RHVoice                                      | B     | LGPL-2.1+ / GPL-3+    | C++             | front end (HMM)          | Russian text rules             |
| HTS / hts_engine                             | B     | Modified BSD (engine) | C               | synthesis (HMM)          | trajectory generation          |
| Votrax in MAME                               | B     | BSD-3-Clause (file)   | C++             | synthesis                | signal-level validation        |
| meSpeak.js                                   | B     | GPL v3                | JavaScript      | synthesis                | -                              |
| MaryTTS                                      | B     | LGPL v3               | Java            | front end                | inspectable stages             |
| NV Speech Player                             | B     | GPL v2                | C++             | synthesis                | frame interpolation            |
| Echogarden                                   | B, C  | MIT (+GPL parts)      | TypeScript      | alignment (NN elsewhere) | multi-pass DTW                 |
| Kaldi                                        | C     | Apache-2.0            | C++             | recognition              | WFST decoding graph            |
| PocketSphinx                                 | C     | BSD-style             | C               | recognition              | grammar decoding               |
| Sphinx4                                      | C     | BSD-style             | Java            | recognition              | -                              |
| pocketsphinx.js                              | C     | MIT                   | JavaScript/WASM | recognition, engine      | recogniser in a worker         |
| Julius                                       | C     | BSD-3-Clause          | C               | recognition              | two-pass search                |
| JuliusJS                                     | C     | MIT (mods)            | JavaScript      | recognition              | -                              |
| HTK                                          | C     | restricted            | C               | recognition              | -                              |
| Montreal Forced Aligner                      | C     | MIT                   | Python          | alignment                | align first, then fit          |
| Gentle                                       | C     | MIT                   | Python          | alignment                | lenient alignment              |
| aeneas                                       | C, D  | AGPL-3.0              | Python/C        | alignment by synthesis   | synthesise and DTW             |
| Prosodylab-Aligner                           | C     | MIT                   | Python          | alignment                | -                              |
| FAVE                                         | C     | GPL-3                 | Python          | alignment, formants      | -                              |
| SpeechMark / landmark systems                | C     | unverified            | MATLAB          | recognition              | landmarks as gesture events    |
| Auto-Landmark                                | C     | unverified            | -               | recognition              | landmark dataset               |
| Allosaurus                                   | C     | GPL-3.0 (NN)          | Python          | recognition              | audio to IPA target            |
| Vosk / sherpa-onnx                           | C     | Apache-2.0 (NN)       | C++             | recognition              | -                              |
| GA copy synthesis (Gao 2019)                 | D     | paper                 | -               | voice copy               | rule-based start, regulariser  |
| Maeda vowel inversion (2011)                 | D     | paper                 | -               | inversion                | codebook initialisation        |
| Inversion codebooks (Ouni, Laprie)           | D     | paper                 | -               | inversion                | adaptive sampling              |
| Halle and Stevens (1962)                     | D     | paper                 | -               | recognition              | hypothesise and compare        |
| Analysis-by-synthesis features (2008)        | D     | paper                 | -               | recognition              | distortion as score            |
| Praat / Parselmouth                          | E     | GPL-3.0-or-later      | C++/Python      | measurement              | external yardstick             |
| WORLD                                        | E     | modified BSD          | C++             | measurement              | three-stream target            |
| world-rs                                     | E     | BSD-3-Clause          | Rust            | measurement              | -                              |
| legacy STRAIGHT                              | E     | Apache-2.0            | MATLAB          | measurement              | adaptive smoothing             |
| REAPER                                       | E     | Apache-2.0            | C++             | measurement              | epochs                         |
| COVAREP                                      | E     | mixed per file        | MATLAB          | measurement              | glottal inverse filtering      |
| openSMILE                                    | E     | non-commercial        | C++             | measurement              | feature checklist              |
| SPTK                                         | E     | Apache-2.0            | C++             | measurement              | composable tools               |
| aubio                                        | E     | GPL-3.0               | C               | measurement              | -                              |
| Essentia                                     | E     | AGPL-3.0              | C++             | measurement              | -                              |
| librosa                                      | E     | ISC                   | Python          | measurement              | -                              |
| VoiceSauce                                   | E     | not stated            | MATLAB          | measurement              | harmonic differences           |
| opensauce-python                             | E     | Apache-2.0            | Python          | measurement              | -                              |
| pYIN                                         | E     | GPL v2                | C++             | measurement              | probabilistic pitch            |
| RustFFT / realfft                            | E     | MIT (OR Apache-2.0)   | Rust            | engine                   | FFT in the worker              |
| pitch-detection / pyin-rs                    | E     | MIT (/Apache-2.0)     | Rust            | engine                   | pitch in Rust                  |
| linear-predictive-coding                     | E     | MIT OR Apache-2.0     | Rust            | engine                   | LPC in Rust                    |
| Sonorant                                     | E     | Unlicense             | Rust/WASM       | measurement, engine      | analysis core in a worker      |
| PHOIBLE                                      | F     | CC BY 4.0 data        | data            | front end                | inventory coverage             |
| PanPhon                                      | F     | MIT                   | Python          | front end, scoring       | feature distance               |
| Epitran                                      | F     | MIT                   | Python          | front end                | per-language maps              |
| WikiPron                                     | F     | Apache-2.0 (tool)     | Python          | front end                | pronunciation mining           |
| CMUdict                                      | F     | BSD-style             | data            | front end                | English lexicon                |
| ipa-dict                                     | F     | MIT                   | data            | front end                | IPA word lists                 |
| Phonemizer                                   | F     | GPL-3.0               | Python          | front end                | -                              |
| gruut                                        | F     | MIT                   | Python          | front end                | -                              |
| Unicode CLDR                                 | F     | Unicode-3.0           | data            | front end                | number spell-out rules         |
| CLTS                                         | F     | CC BY 4.0             | data            | front end                | canonical sound names          |
| Phonetisaurus                                | F     | BSD-3-Clause          | C++             | front end                | WFST G2P                       |
| Sequitur G2P                                 | F     | GPL v2                | Python/C++      | front end                | -                              |
| Pynini                                       | F     | Apache-2.0            | Python/C++      | front end                | rewrite-rule grammars          |
| python-pinyin                                | F     | MIT                   | Python          | front end                | Chinese readings               |

## Gaps: what no surveyed project does

The statements below are limited to what we searched and opened in November 2026; they are not proofs of absence.

- **One model, both directions.** We found no released project that uses the same physical or articulatory model
  for text-to-speech and for speech-to-text. The idea is old (Halle and Stevens 1962) and was tested as a feature
  extractor (Al Bawab, Raj and Stern 2008), but we found papers only, no software. aeneas proves the
  "synthesise and compare" loop in production, but only for alignment and with a formant synthesizer.
- **Network-free voice copying under a permissive licence.** The non-neural copy-synthesis work we found is either
  a paper without code (genetic algorithm, 2019), code without a licence (vocal-tract-grad), GPL-bound to
  VocalTractLab, or dependent on a neural component (VocalTrax installs CREPE; the NeurIPS 2026 simulator uses a
  network for geometry). We found no permissively licensed tool that fits a physical voice model to a recording
  without any network.
- **Multilingual text front end on a physical model.** Among the articulatory synthesizers surveyed, gnuspeech
  (English) and VocalTractLab (gestural scores) are the only ones with a path from text or phonemes; we found no
  articulatory project that documents English, Russian, Hindi and Chinese together. Multilingual coverage exists
  only in formant or statistical systems (eSpeak NG, RHVoice).
- **3D wave simulation driven from text in a browser.** The 3D acoustic projects we found are desktop research
  tools (VocalTractLab3D) or papers without public code (3D FDTD studies). The browser projects surveyed use 1D
  waveguides (Pink Trombone and ports) or formant synthesis.
- **A Rust/WASM engine that is both synthesizer and analyser.** Rust projects cover one side each: synthie-trombone
  and klattsch-rs synthesise; Sonorant, pitch-detection and the LPC crates analyse. We found none that couples a
  physical synthesizer with an inversion loop in one worker.
- **Public-domain building blocks are rare.** Of everything surveyed, only Sonorant is under the Unlicense. The
  strongest articulatory code (VocalTractLab, gnuspeech, Praat) is GPL, so ideas must be reimplemented from papers.
- **Evidence of state-of-the-art quality without networks.** We found no listening-test result showing a
  network-free physical synthesizer matching neural TTS. VocalTrax reports persistent quality challenges, and
  copy-synthesised speech scored 52-74% word accuracy in the one figure we saw (unverified). This is the largest
  open risk in the vision, not a gap that others have merely overlooked.
- **Expressive modes on a physical model.** svara documents tones and a whisper-to-shout continuum for a formant
  synthesizer; among the physical simulators surveyed we did not see a documented coverage list of expressive
  modes (whisper, creak, emotion, tone). This claim rests on READMEs and manuals only.

## What could not be verified

- Licence of the HTS training toolkit, CASY, HLsyn, UCL VTDemo, openCFS, SpeechMark and Auto-Landmark.
- The GPL statement for VocalTractLab3D and VocalTractLab 2.4, and the GPL v3 statement for meSpeak.js, come from
  search summaries of the linked documents, not from a licence file.
- Whether Gentle's acoustic model is neural; whether k-Wave or openEMS has a published vocal tract study.
- The 2024 copy-synthesis word accuracies, the 10.9% phone error reduction and the 70-times parallelisation figure
  come from search summaries or abstracts, not from full texts.
- Pages that were seen in search results but did not answer our link check are cited without a link: the HTK
  licence page, the TubeTalker demonstration page, the Schroeter and Sondhi review and the Halle and Stevens record.
- Licences of the data mined by WikiPron and bundled in ipa-dict; TubeN's GUI and STL export (search summary only).
- Statements marked as ideas for Festival (utterance structure), Kaldi (WFST graphs), TADA (coupled oscillators),
  MBROLA (phoneme-duration-pitch input) and CLDR (number spell-out) rest on general knowledge of those systems, not
  on a page fetched for this survey.
