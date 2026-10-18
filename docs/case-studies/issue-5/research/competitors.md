# Competitors and prior art

This survey covers articulatory, formant, concatenative and neural speech
synthesizers relevant to issue #5. Each entry gives what the project is, its
licence, its key technical ideas, a link, and the best idea to reimplement in
our own codebase. We reimplement ideas only and copy no code, so licences
(GPL, AGPL) do not leak into this repository.

Facts are cited inline. Claims we could not confirm against a primary source
are marked **(unverified)**.

## Summary table

| Project                            | Kind                          | Licence                  | Best idea for us                                                  |
| ---------------------------------- | ----------------------------- | ------------------------ | ----------------------------------------------------------------- |
| Pink Trombone                      | 1D Kelly-Lochbaum, browser    | MIT                      | LF glottis with a single Rd knob, 44 segments, 2 steps per sample |
| Modular forks (chdh, yonatanrozin) | TS / AudioWorklet ports       | MIT                      | Glottis and tract as separate AudioWorklet processors             |
| zakaton/Pink-Trombone              | programmable web component    | GPL-3.0                  | Phoneme-to-constriction scripting API                             |
| vvolhejn/samuel                    | learned Pink Trombone control | GPL-3.0                  | Train a controller to imitate speech                              |
| vocal-tract-grad                   | differentiable waveguide      | see repo                 | Gradient-based voice matching                                     |
| VocalTractLab 2.x                  | 3D geometry + 1D acoustics    | GPL-3.0                  | Gestural score, sinuses, piriform fossae, teeth                   |
| VocalTractLab3D                    | multimodal method             | GPL (unverified)         | Higher-order modes at ~10x less cost than FEM                     |
| Praat articulatory                 | mass-spring tube model        | GPL-2.0+                 | Speaker/Artword split                                             |
| Gnuspeech TRM                      | 8-region DRM waveguide        | GPL                      | Distinctive Region Model controls                                 |
| Maeda model                        | 7-parameter PCA               | academic                 | Low-dimensional articulatory control                              |
| Story / TubeTalker                 | area function + eigenmodes    | academic                 | Neutral tract + 2 modes + consonant shaping                       |
| eSpeak NG                          | formant synth + rules         | GPL-3.0                  | Punctuation tunes, accent files                                   |
| Klatt / KLSYN88                    | cascade/parallel formant      | academic                 | Voice-quality parameters                                          |
| MBROLA                             | diphone concatenation         | AGPL-3.0                 | Phoneme + duration + pitch-target input format                    |
| Festival                           | TTS framework                 | X11-style                | Utterance structure (items and relations)                         |
| Piper / VITS                       | neural TTS                    | MIT, then GPL-3.0        | espeak phonemes as the frontend                                   |
| Coqui XTTS v2                      | neural cloning                | CPML (non-commercial)    | 6 s reference cloning (out of scope)                              |
| RVC                                | neural voice conversion       | MIT                      | Retrieval of nearest feature frames                               |
| ArtiSynth                          | biomechanics (FEM tongue)     | open source (unverified) | Muscle-driven tongue for LOD 3                                    |
| 3D FDTD / FEM / DWM research       | numerical acoustics           | papers                   | Sparse voxel FDTD, 1D below 4-5 kHz                               |
| Sawada talking robot               | physical robot                | n/a                      | Listen-and-adapt loop (see video file)                            |

## Pink Trombone

- What it is:
  - A browser vocal tract synthesizer by Neil Thapen, version 1.1, March 2017
    (https://dood.al/pinktrombone/).
  - The source header carries the MIT licence text ("Copyright 2017 Neil
    Thapen, Permission is hereby granted...").
- Key technical ideas, all read directly from the page source:
  - Tract:
    - A Kelly-Lochbaum waveguide with `n = 44` segments.
    - Regions: blade start 10, tip start 32, lip start 39.
    - `glottalReflection = 0.75`, `lipReflection = -0.85`.
    - The tract is stepped twice per audio sample (two interpolation factors,
      `lambda1`/`lambda2`).
  - Nose: a side branch `28 * n / 44` segments long.
  - Glottis:
    - LF waveform with `Rd = 3 * (1 - tenseness)`, clamped to 0.5-2.7.
    - R-parameters: `Ra = -0.01 + 0.048 Rd` and `Rk = 0.224 + 0.118 Rd`.
    - `Rg = (Rk/4)(0.5 + 1.2 Rk) / (0.11 Rd - Ra (0.5 + 1.2 Rk))`.
    - Aspiration noise is modulated by the glottal cycle.
    - Vibrato is 6 Hz with amount 0.005, plus simplex-noise wobble.
  - The bibliography in the source cites:
    - J. O. Smith, "Physical Audio Signal Processing"
    - Story 2005 JASA 117(5):3231
    - Lu & Smith 2000 ICMC (glottal model)
    - Mullen 2006 PhD thesis (2D DWM)
- Link: https://dood.al/pinktrombone/
- Best idea to reimplement our way: our `src/acoustics/glottis.js` already
  uses the same Rd regression. Next steps:
  - Expose Rd per speaker preset instead of a single tenseness slider.
  - Keep two sub-steps per sample for the 1D tract at 44.1/48 kHz.

### Forks and derivatives

Stars and licences are from `gh search repos` in October 2026.

| Repo                                                  | Licence    | Note                                                           |
| ----------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| https://github.com/zakaton/Pink-Trombone              | GPL-3.0    | Programmable, web component, AudioWorklet, ~225 stars          |
| https://github.com/IMAGINARY/pink-trombone            | not stated | Museum exhibit build, ~176 stars                               |
| https://github.com/PaulBatchelor/voc                  | not stated | Literate CWEB C port ("Voc"), ~155 stars                       |
| https://github.com/evykassirer/pink-trombone          | MIT        | Cleaned-up source, ~129 stars                                  |
| https://github.com/chdh/pink-trombone-mod             | MIT        | Modularised TypeScript, npm `pink-trombone-mod`                |
| https://github.com/yonatanrozin/Modular-Pink-Trombone | MIT        | `GlottisProcessor`/`TractProcessor` AudioWorklets, many voices |
| https://github.com/lostmsu/pink-trombone              | MIT        | Rust port                                                      |
| https://github.com/dkadish/pynktrombone               | not stated | Python port                                                    |
| https://github.com/Geson-anko/PynkTromboneGym         | not stated | Reinforcement-learning gym environment                         |
| https://github.com/jmiskovic/voicebox                 | not stated | Reskin of the chdh fork                                        |
| https://github.com/vvolhejn/samuel                    | GPL-3.0    | Learns to drive Pink Trombone to imitate speech, ~99 stars     |

- **vvolhejn/samuel** trains a controller to mimic speech with Pink Trombone.
  - Blog: https://vvolhejn.com/blog/2026-08-17-samuel
  - Demo: https://samuel.vvolhejn.com/
  - Uses Kyutai pocket-tts as a teacher and Libri-Light data, according to its
    README.
- **Xfer Records** released a free Pink Trombone VST3/AU plugin
  (https://synthanatomy.com/2026/08/xfer-records-ports-legendary-pink-trombone-browser-speech-synth-into-a-free-plugin.html).
  - Voice/Tract/Play sections
  - 4 AHDSR envelopes and 4 LFOs
- **"Blue Trombone"** was not found on the web or GitHub **(unverified; it may
  not exist under that name)**.
- **davidmarttila/vocal-tract-grad**
  (https://github.com/davidmarttila/vocal-tract-grad) estimates Pink Trombone
  parameters by gradient descent.
  - It uses inverse filtering plus a differentiable waveguide frequency
    response.
  - The README reports it beating evolutionary and neural baselines in a
    listening test.
- Best idea to reimplement our way:
  - Run the 1D glottis and tract inside an AudioWorklet so preview playback
    never blocks the UI.
  - For voice matching (WAV upload), use a differentiable or cheap
    frequency-domain transfer function (`src/acoustics/transfer.js`) as the
    inner loop of the optimisation.

## VocalTractLab (VTL) 2.x

- What it is: Peter Birkholz's articulatory synthesizer (TU Dresden).
  - C++ with a wxWidgets GUI on Windows, plus an API DLL.
  - Manual: https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf
    (VTL 2.4, December 2025).
- Licence: GPL-3.0.
  - Repos: https://github.com/TUD-STKS/VocalTractLab-dev and
    https://github.com/TUD-STKS/VocalTractLabBackend-dev
  - Python wrapper: https://pypi.org/project/VocalTractLab/
- Key technical ideas (VTL 2.4 manual):
  - Vocal tract model:
    - A 3D geometric model with 19 degrees of freedom, adjusted to MRI.
    - Includes teeth, tongue, palate, velum and lips.
    - Ships with several speaker files.
  - Acoustic pipeline:
    - The 3D shape is converted to an "enhanced area function".
    - That feeds a branched tube model, solved in the frequency domain
      (transfer function) or in the time domain.
    - The time-domain sample rate was raised from 44.1 kHz to 48 kHz.
  - Tube system:
    - Trachea: 23 sections. Glottis: 2 small sections.
    - Nasal cavity, plus 4 paranasal sinuses as Helmholtz resonators (after
      Dang & Honda).
    - Sinus piriformis side branches.
  - Glottis models:
    - Default: "Geometric glottis 2025".
    - Also "Geometric glottis 2019" (Birkholz, Drechsel & Stone 2019).
    - Also a self-oscillating "Triangular glottis" (Birkholz, Kröger &
      Neuschaefer-Rube 2011).
    - A static jitter parameter follows Fraj et al. 2012.
  - Noise:
    - Noise source model per Birkholz 2014.
    - Glottal noise is injected about 1.5 cm downstream of the glottis.
  - Coarticulation:
    - Consonant targets are interpolated between /aCa/, /iCi/ and /uCu/
      prototypes.
    - Source: Birkholz 2013, PLoS ONE 8(4):e60603.
  - Gestural score (Browman & Goldstein articulatory phonology):
    - 8 tiers: vowel, lip, tongue tip, tongue body, velic, glottal shape, F0,
      lung pressure.
    - Each target is approached by a 5th-order critically damped linear
      system.
    - F0 uses the target approximation model (Prom-on, Xu & Thipakorn 2009).
- Teeth matter:
  - Traser et al. 2017 (JSLHR 60:2379-2393,
    https://pubs.asha.org/doi/abs/10.1044/2017_JSLHR-S-16-0395) compared 18
    3D-printed tracts with and without teeth.
  - Teeth add pole-zero pairs, mostly in tracts with side cavities. The
    authors recommend including teeth.
  - Data: https://figshare.com/articles/Teeth_in_3D_vocal_tract_models_Traser_et_al_2017_/5386771
- Related tools:
  - Dresden Vocal Tract Dataset of printable MRI shapes:
    https://github.com/TUD-STKS/DVTD
  - PAULE (https://pypi.org/project/paule) plans VTL trajectories with a
    neural model.
- Best idea to reimplement our way:
  - Replace our phone-by-phone interpolation in `src/articulation/plan.js`
    with gestural tiers. Drive each tier with a critically damped
    target-approximation filter.
  - Add sinus and piriform side branches to the 1D model.
  - Add teeth to the 3D voxel model (`src/acoustics/voxel-model.js`).

### VocalTractLab3D (Blandin)

- Uses the multimodal method with 2D FEM transverse modes.
- Reported about 1% resonance error versus 3D FEM at roughly 10x lower cost
  (https://vocaltractlab.de/publications/blandin-2021-interspeech.pdf).
- User guide: https://www.vocaltractlab.de/download-vocaltractlab/user_guide_vtl3d.pdf
- Licence: GPL like VTL **(unverified for the 3D branch)**.
- Best idea: if we need above-5 kHz accuracy without full FDTD, precompute
  transverse modes per cross-section once per shape and reuse them.

## Praat articulatory synthesis

- What it is: the `Speaker` + `Artword` objects in Praat.
  - Manual: https://www.fon.hum.uva.nl/praat/manual/Articulatory_synthesis.html
  - Physics: Boersma 1998, "Functional Phonology", chapters 2-3
    (https://www.fon.hum.uva.nl/paul/papers/funphon.pdf).
- Licence: Praat is GPL-2.0-or-later (stated in the Parselmouth docs,
  https://parselmouth.readthedocs.io/).
- Key ideas:
  - Muscle activations (`Artword`) are time functions.
  - The `Speaker` holds anatomy.
  - A mass-spring tube model solves aerodynamics and acoustics together.
- Best idea: separate anatomy (`Speaker`, our `head-config.js`) from motor
  commands (`Artword`, our plan). A voice preset can then be swapped without
  touching the utterance.

## Gnuspeech / TRM and the Distinctive Region Model

- What it is: the Tube Resonance Model, originally from Trillium Sound
  Research and now a GNU project.
  - Project: https://www.gnu.org/software/gnuspeech/
  - Background: https://en.wikipedia.org/wiki/Gnuspeech
- Licence: GPL; released on Savannah in 2002.
- Key ideas (TRM write-up, https://www.gnu.org/software/gnuspeech/trm-write-up.pdf;
  manual, https://cspages.ucalgary.ca/~hilld/papers/synthesizer/body.html):
  - A waveguide tube with **8 oropharyngeal regions of unequal length**,
    following Carré's Distinctive Region Model (DRM).
  - Each region's area change maps monotonically onto F1-F3 shifts.
  - A 5-section nasal branch.
  - Leonard Manzara wrote the TRM; David Hill wrote the manual.
- Best idea: offer a "DRM" control layer as an alternative to tongue
  parameters. Eight region areas map straight to formant moves, which makes
  voice matching to target formants far more tractable.

## Maeda's model

- Seven PCA factors from cineradiography, each in standard-deviation units:
  jaw, tongue dorsum position, tongue shape, apex, lip height, lip protrusion
  and larynx height.
- Sources:
  - https://www.isca-archive.org/eurospeech_1989/maeda89_eurospeech.html
  - https://www.coli.uni-saarland.de/Phonetics/icphs/ICPhS1991/12_ICPhS_1991_Vol_3/p12.3_038-41.pdf
  - Recent reuse: https://arxiv.org/pdf/2505.22455
- Best idea:
  - Expose a 7-slider "Maeda-like" control space in settings.
  - It is compact enough for random male/female/child presets and for
    Nelder-Mead fitting.

## Story's area-function model and TubeTalker

- Story 2005, JASA 117(5):3231
  (https://sites.arizona.edu/sapl/files/2023/10/story_jasa2005-1.pdf):
  - Defines a tiered model: a neutral area function plus two spatial
    eigenmodes as the vowel substrate.
  - A consonant shaping function (location, minimum area, range) is
    superimposed on that substrate.
  - The modes are similar across 6 speakers, while the mean shape is
    speaker-specific.
- TubeTalker, Story's airway modulation model (2011:
  https://sites.arizona.edu/sapl/files/2023/10/Story-2011_0-1.pdf;
  demos: https://sites.arizona.edu/sapl/research/tube-talker-speech-synthesis-demonstrations):
  - Glottal vibration at 100-400 Hz, slower articulatory modulation and nasal
    coupling are superimposed on the neutral tract.
- Story & Bunton 2017
  (https://sites.arizona.edu/sapl/files/2023/10/StoryBunton_SpeechComm2017-1.pdf):
  specifies consonants as directional formant changes.
- MRI area functions, Story, Titze & Hoffman 1996 (JASA 100(1):537-554):
  - 18 shapes (12 vowels, 3 nasals, 3 plosives) from one male.
  - Abstract: https://experts.arizona.edu/en/publications/vocal-tract-area-functions-from-magnetic-resonance-imaging/
- Best idea:
  - Represent each speaker as a mean area function plus shared modes.
  - Female and child voices then become a different mean (with a shorter
    pharynx) rather than a uniform scale.
  - `src/articulation/vowel-space.js` can map (F1, F2) to mode coefficients.

## eSpeak NG

- What it is: a compact rule-based formant synthesizer.
  - Can optionally use a Klatt voice or MBROLA voices.
  - Has partial SSML support.
  - Source: https://github.com/espeak-ng/espeak-ng
- Licence: GPL-3.0 (https://en.wikipedia.org/wiki/ESpeak).
- Key ideas (from `docs/intonation.md`, `docs/voices.md`, `docs/languages.md`):
  - Clause tunes are chosen by punctuation: `tunes s1 c1 q1 e1` for full
    stop, comma, question and exclamation.
  - Each clause is split into prehead / head / nucleus (last stressed
    syllable) / tail.
  - Voice files set `pitch <base> <range>` (default 82 118), per-formant
    `formant` scaling, `breath`, `flutter`, `roughness`, `tone` and `echo`.
  - Accents are separate language files: `en-us`, `en-gb-x-rp`,
    `en-gb-scotland`, and others.
- Best idea: copy the data model, not the data:
  - Clause tune tables keyed by punctuation.
  - Accent files that override phoneme mappings plus stress lengths.
  - See `linguistics-and-highlighting.md`.

## Klatt synthesizer (Klatt 1980, KLSYN88)

- Klatt 1980, "Software for a cascade/parallel formant synthesizer", JASA
  67(3):971-995 (https://www.fon.hum.uva.nl/david/ba_shs/2009/klatt-1980.pdf).
- KLSYN88 adds:
  - selectable glottal waveforms
  - extra pole-zero pairs for nasal and tracheal coupling
  - Source: https://www.coli.uni-saarland.de/Phonetics/icphs/ICPhS1991/12_ICPhS_1991_Vol_1/p12.1_028.pdf
- Klatt & Klatt 1990 (JASA 87:820-857) analysed female versus male voice
  quality: breathiness, open quotient and tilt.
- Best idea: use Klatt-style voice-quality parameters as speaker preset
  fields:
  - OQ (open quotient)
  - TL (spectral tilt)
  - AH (aspiration amplitude)
  - FL (flutter)
  - DI (diplophonia)

## MBROLA

- What it is: diphone concatenation. A frontend supplies phonemes, durations
  and pitch targets.
- Licence: AGPL-3.0 (https://github.com/numediart/MBROLA,
  https://en.wikipedia.org/wiki/MBROLA). Most voices are non-commercial.
- Best idea: the `.pho` interchange format (one phoneme per line, duration in
  ms, then pairs of percent position and F0 Hz). It is a clean, testable
  boundary between our G2P/prosody and the articulatory backend, and it gives
  timestamps for highlighting.

## Festival

- What it is: the Edinburgh CSTR speech synthesis framework, C++ with a
  SIOD Scheme interpreter.
- Licence: X11-style (https://www.cstr.ed.ac.uk/projects/festival/).
- Best idea: the utterance is stored as items linked by named relations
  (Word, Syllable, Segment, IntEvent). A word-to-syllable-to-phone tree is
  what we need for word plus syllable highlighting.

## Neural TTS: Piper, VITS, Coqui XTTS

- Piper:
  - VITS models exported to ONNX, using espeak-ng phonemes as input.
  - `rhasspy/piper` (MIT) was archived in October 2025. The successor
    `OHF-Voice/piper1-gpl` is GPL-3.0
    (https://www.promptquorum.com/power-local-llm/piper-tts-review)
    **(secondary source, partially unverified)**.
- Coqui XTTS v2:
  - Clones a voice from about 6 s of audio in 17 languages.
  - CPML non-commercial licence.
  - The company shut down around December 2023 / January 2024
    (https://bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models,
    https://analyticsindiamag.com/?p=10109988).
- Best idea: none for the physics engine. A neural model could act as a
  "teacher" to tune articulatory controls offline, as samuel does.

## RVC (Retrieval-based Voice Conversion)

- MIT licence (https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI,
  https://en.wikipedia.org/wiki/Retrieval-based_Voice_Conversion).
- Method:
  - Uses HuBERT/ContentVec content features.
  - A Faiss index retrieves the nearest training frames.
  - RMVPE is recommended for pitch.
- Best idea: for "copy a voice from WAV", store per-phone measured targets
  (formants, H1-H2, F0) from the upload. At synthesis time, retrieve the
  nearest measured target per phone instead of a global average.

## ArtiSynth

- What it is: a Java biomechanical modelling toolkit (https://artisynth.org/;
  Lloyd, Stavness & Fels 2012,
  https://people.ece.ubc.ca/stavness/papers/lloyd2012-artisynth-a-fast-interactive-biomechanical-modeling-toolkit.pdf).
- Tongue model (https://artisynth.org/Demo/BiomechanicalTongueModel):
  - FEM with 946 nodes and 740 hexahedral elements.
  - 11 muscle groups.
  - Implicit Euler integration.
- Licence: open source **(exact licence unverified)**.
- Best idea: for the highest visual LOD, model the tongue as a coarse
  volume-preserving mesh whose shape is driven by our articulatory
  parameters. Tongue volume is about 69 cm³ (female) to 90 cm³ (male); see
  `anatomy-and-acoustics.md`. A full muscle simulation is not needed.

## 3D numerical acoustics research

See `video-and-science.md` for the paper list (Takemoto 2010, Arnela &
Guasch 2014, Speed et al. 2014, Mohapatra et al. 2022, with URLs there).
Best idea: keep the 1D model for everything below about 5 kHz, use sparse 3D
FDTD only for high-frequency realism (sibilants, tense voice), and probe the
hardware first with an automatic fallback.

## Browser and small projects worth knowing

| Project                                            | Licence    | Idea                                                  |
| -------------------------------------------------- | ---------- | ----------------------------------------------------- |
| https://github.com/shun60s/Vocal-Tube-Model        | MIT        | Python 2-4 tube models with frequency response        |
| https://github.com/musikinformatik/apex-sc-dafx    | GPL-2.0    | APEX articulatory model in SuperCollider              |
| https://github.com/mxhold/vocal_tract_length       | MIT        | VTL estimate from formants via Praat                  |
| https://github.com/megseekosh/vocal_tract_vowel    | not stated | VTL from formants                                     |
| https://github.com/HidekiKawahara/SIGMUS2021Summer | CC0        | Real-time vocal tract area visualiser (Kawahara)      |
| https://github.com/minhuilu/webster-pinn-svs       | not stated | Webster-equation physics-informed network for singing |

## Takeaways for our roadmap

1. Our 1D path is already Pink-Trombone-grade. The biggest audible gains
   come from:
   - speaker-specific mean area functions
   - per-speaker Rd/OQ, aspiration and tilt
   - sinus and piriform side branches
2. Gestural tiers (VTL) and DRM regions (TRM) give better articulation
   control than per-phone targets.
3. Voice matching is solved in the literature by analysis-by-synthesis, by
   gradient through a waveguide (vocal-tract-grad) or by learned controllers
   (samuel, SONN in the Sawada robot).
4. 3D FDTD pays off mainly above 4-5 kHz and for teeth and sibilants. Treat
   it as an optional precision tier.
