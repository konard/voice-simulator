# Articulatory and Physical Voice Synthesis: Prior Art

Research notes for issue #1 ("Initial prototype"), focused on existing
articulatory / physical-model voice synthesizers that simulate sound waves in
the shape of the vocal tract instead of playing recordings. Every factual claim
links to its source. Numbers marked "derived" are our own arithmetic based on
cited constants.

## Key physical constants

| Quantity                                 | Value                                         | Source                                                                                                                             |
| ---------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Adult male vocal tract length            | about 17 cm (0.17 m)                          | [Coleman, Oxford: tube models](https://www.phon.ox.ac.uk/jcoleman/tube_models.htm)                                                 |
| Adult female vocal tract length          | about 15 cm (0.15 m)                          | [Coleman, Oxford: tube models](https://www.phon.ox.ac.uk/jcoleman/tube_models.htm)                                                 |
| Speed of sound used inside the tract     | c = 350 m/s                                   | [Mohapatra, Zappi, Fels 2019, arXiv 1909.09585](https://arxiv.org/html/1909.09585)                                                 |
| Quarter-wave resonator formants          | F_n = (2n - 1) c / 4L                         | [Coleman, Oxford](https://www.phon.ox.ac.uk/jcoleman/tube_models.htm), [Wikipedia: Formant](https://en.wikipedia.org/wiki/Formant) |
| Neutral male formants (L = 0.17 m)       | about 500, 1500, 2500 Hz                      | [Coleman, Oxford](https://www.phon.ox.ac.uk/jcoleman/tube_models.htm)                                                              |
| Neutral female formants (L = 0.15 m)     | 567, 1700, 2833, 3967 Hz                      | [Coleman, Oxford](https://www.phon.ox.ac.uk/jcoleman/tube_models.htm)                                                              |
| Story MRI male tract (44 sections)       | 16.11-19.59 cm, section length 0.366-0.445 cm | [Story 2008, JASA 123(1), PMC2377017](https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/)                                           |
| TubeTalker section length at 44.1 kHz    | 0.396825 cm, 44 sections, 17.46 cm total      | [Story 2013, PMC3596841](https://pmc.ncbi.nlm.nih.gov/articles/PMC3596841/)                                                        |
| 2D FDTD CFL condition                    | dt <= ds / (sqrt(2) c)                        | [arXiv 1909.09585](https://arxiv.org/html/1909.09585)                                                                              |
| DWM / FDTD spatial step at Courant limit | l = c sqrt(D) / fs (D = 3 in 3D)              | [Gully, Daffern, Murphy 2018 (accepted MS)](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)                           |

Notes:

- Vocal tract length should be a parameter of the proportion editor rather
  than a constant (our recommendation). The two values above are typical
  defaults.
- Our own check: TubeTalker's section length implies c = 2 x 0.396825 cm x
  44100 Hz = 35000 cm/s = 350 m/s (derived). In other words, one section is
  the distance sound travels in half a sample period. A tract of N sections
  therefore needs fs = N c / (2 L) to keep a fixed physical length, so
  changing the length either changes the sample rate or requires fractional
  delays (derived).
- The 3D stability limit c dt / dx <= 1 / sqrt(3) follows from the formula
  above with D = 3 (Gully et al. state the DWM is equivalent to an FDTD scheme
  at the Courant limit). Peer-reviewed stability analysis of 3D compact explicit schemes:
  [Kowalczyk and van Walstijn 2011](https://cris.fau.de/publications/122961564).

## Pink Trombone (Neil Thapen, 2017)

Source: the single-file HTML/JS app at
[dood.al/pinktrombone](https://dood.al/pinktrombone/) (view-source; header
comment says "version 1.1, March 2017 by Neil Thapen").

- License: MIT-style permission notice, "Copyright 2017 Neil Thapen"
  ([source header](https://dood.al/pinktrombone/)).
- Bibliography in the header: J. O. Smith "Physical Audio Signal Processing",
  Story 2005 parametric area-function model (JASA 117.5), Lu and Smith 2000
  glottal source (ICMC), Mullen 2006 2D DWM thesis
  ([source header](https://dood.al/pinktrombone/)).

### Tract (Kelly-Lochbaum 1D waveguide)

All values below are quoted from the `Tract` object in the source.

- `n: 44` sections; `bladeStart: 10`, `tipStart: 32`, `lipStart: 39`.
- Initial diameters: 0.6 for i < 7, 1.1 for i < 12, otherwise 1.5 (arbitrary
  units, roughly cm).
- Area per section `A[i] = diameter[i]^2` ("ignoring PI etc.").
- Reflection coefficient at junction i:
  `r[i] = (A[i-1] - A[i]) / (A[i-1] + A[i])`, with `0.999` substituted when
  `A[i] == 0` (full closure).
- Scattering per junction: `w = r * (R[i-1] + L[i])`,
  `junctionOutputR[i] = R[i-1] - w`, `junctionOutputL[i] = L[i] + w`.
- Boundary reflections: `glottalReflection: 0.75`, `lipReflection: -0.85`.
- Per-step damping: travelling waves multiplied by `0.999` each step (the
  `fade` field is 1.0 and used for the nose).
- The tract `runStep` is called twice per output sample ("Tract runs at twice
  the sample rate"), with the reflection coefficients linearly interpolated
  across the 512-sample block (`lambda`). Output is
  `(lipOutput + noseOutput)` summed over both sub-steps times `0.125`.
- Articulator slew: `movementSpeed: 15` ("cm per second"); diameters move
  toward targets with `Math.moveTowards`, slower (0.6x) near the glottis.
- Plosive release: when a closure (diameter <= 0) opens and the velum is
  closed, a transient is injected: `lifeTime 0.2`, `strength 0.3`,
  `exponent 200` (amplitude `strength * 2^(-exponent * t)`).

### Nasal branch

- `noseLength = floor(28 * n / 44) = 28`, `noseStart = n - noseLength + 1 =
17` (derived from the formulas in the source).
- Nose diameter profile: `d = 2 * i / noseLength`; diameter
  `0.4 + 1.6 d` for d < 1, else `0.5 + 1.5 (2 - d)`, clamped to 1.9.
- Velum: `noseDiameter[0]` follows `velumTarget` (0.01 closed, 0.4 open).
- Three-way junction at `noseStart` uses
  `sum = A[noseStart] + A[noseStart+1] + noseA[0]` and per-port coefficients
  `(2 * A_port - sum) / sum` for left, right and nose ports.
- Nose output end uses the same `lipReflection` (-0.85).

### Tongue parameterization

From the `TractUI` object in the source:

- Default `tongueIndex: 12.9`, `tongueDiameter: 2.43`; control ring
  `innerTongueControlRadius: 2.05`, `outerTongueControlRadius: 3.5`.
- Index bounds: `bladeStart + 2` to `tipStart - 3` (12 to 29).
- Rest shape for `i` in `[bladeStart, lipStart)`:
  `t = 1.1 * PI * (tongueIndex - i) / (tipStart - bladeStart)`;
  `fixed = 2 + (tongueDiameter - 2) / 1.5`;
  `curve = (1.5 - fixed + gridOffset) * cos(t)` with `gridOffset: 1.7`;
  `restDiameter[i] = 1.5 - curve` (with 0.8 / 0.94 tapering at the ends).
- Extra constrictions (tongue tip, lips) are applied as a raised-cosine dip of
  width 10 sections (index < 25), 5 (index >= tipStart), interpolated
  between; `diameter - 0.3` is the constriction depth.

### Glottis (LF model, Rd parameterization)

- Default `UIFrequency: 140` Hz, `UITenseness: 0.6`, vibrato 0.005 at 6 Hz
  plus simplex-noise wobble.
- `Rd = 3 * (1 - tenseness)`, clamped to `[0.5, 2.7]`; then
  `Ra = -0.01 + 0.048 Rd`, `Rk = 0.224 + 0.118 Rd`,
  `Rg = (Rk/4)(0.5 + 1.2 Rk) / (0.11 Rd - Ra (0.5 + 1.2 Rk))`, giving
  `Tp = 1/(2 Rg)`, `Te = Tp (1 + Rk)`, `Ta = Ra` (normalized period = 1).
- Aspiration noise: white noise through a bandpass biquad at 500 Hz, Q 0.5;
  fricative noise: bandpass at 1000 Hz, Q 0.5; noise is modulated by the
  glottal cycle.
- Audio uses the deprecated `ScriptProcessorNode` with a 512-sample block.

## VocalTractLab (Peter Birkholz)

- License: "VTL 2.4 is distributed as free and open source software under the
  GNU General Public License (GPL)"
  ([VTL 2.4 manual](https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf));
  "open-source software under the GNU GPL (since version 2.3)"
  ([about page](https://www.vocaltractlab.de/index.php?page=vocaltractlab-about)).
  The GitHub repos
  [TUD-STKS/VocalTractLab-dev](https://github.com/TUD-STKS/VocalTractLab-dev)
  and
  [TUD-STKS/VocalTractLabBackend-dev](https://github.com/TUD-STKS/VocalTractLabBackend-dev)
  report GPL-3.0.
- Geometry: 3D articulator surfaces; the model "currently has 19 degrees of
  freedom (vocal tract parameters)"
  ([VTL 2.4 manual](https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf)).
- Acoustics: the 3D shape yields a centre-line area function which "is then
  transformed into a transmission line model of the vocal tract and can be
  analyzed in the frequency domain or simulated in the time domain"; the time
  domain uses "a finite-difference scheme"; trachea modelled with 23 tube
  sections; paranasal sinuses as Helmholtz resonators; 48000 Hz sampling rate
  (previously 44100 Hz)
  ([VTL 2.4 manual](https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf)).
- Glottis models: "Geometric glottis 2025" (default), "Geometric glottis 2019",
  and the self-oscillating "Triangular glottis"; the classical two-mass model
  was removed in 2.4
  ([VTL 2.4 manual](https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf)).
- Control: gestural scores; articulator motion driven by a "5th order
  critically damped" linear system
  ([VTL 2.4 manual](https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf)).
  This is a good template for smooth IPA-to-IPA transitions.
- Python wrapper on PyPI is GPL-3.0
  ([pypi: VocalTractLab](https://pypi.org/project/VocalTractLab/)).
- Implication: GPL code cannot be copied into a permissively licensed library;
  only ideas and published equations can be reused.

## Story's area-function model and TubeTalker (Brad Story)

- Vowel substrate:
  `V(x,t) = (pi/4) [Omega(x) + q1(t) phi1(x) + q2(t) phi2(x)]^2`, where
  Omega is the mean diameter function and phi1, phi2 are two "modes"
  ([Story 2013, PMC3596841](https://pmc.ncbi.nlm.nih.gov/articles/PMC3596841/)).
- Consonants: `A(x,t) = V(x,t) * prod_k C_k(x,t)` (product of constriction
  functions); 44 "tubelet" sections of 0.396825 cm (17.46 cm) at 44.1 kHz;
  acoustic coupling by a wave-reflection algorithm
  ([PMC3596841](https://pmc.ncbi.nlm.nih.gov/articles/PMC3596841/)).
- Two modes plus a mean explain 11-vowel sets for each of six speakers; mode
  shapes are highly correlated across speakers
  ([Story 2008 time-dependence of modes, PMC2310171](https://pmc.ncbi.nlm.nih.gov/articles/PMC2310171/)).
- Audio demos:
  [UA SAPL TubeTalker](https://sites.arizona.edu/sapl/research/tube-talker-speech-synthesis-demonstrations).
- Published MRI area functions (Story, Titze and Hoffman 1996; Story 2008) are
  reproduced numerically in `web-performance-and-delivery.md`.

## Other classic models

- Kelly and Lochbaum (1962): first computer simulation of the vocal tract;
  cylinders with d'Alembert travelling waves sampled per Nyquist, i.e. a
  digital waveguide "degenerated to single-sample width"
  ([JOS PASP: Singing Kelly-Lochbaum Vocal Tract](https://ccrma.stanford.edu/~jos/pasp/Singing_Kelly_Lochbaum_Vocal_Tract.html),
  [Wikipedia: Articulatory synthesis](https://en.wikipedia.org/wiki/Articulatory_synthesis)).
- Mermelstein (1973), "Articulatory model for the study of speech production";
  basis of the Haskins ASY synthesizer (Rubin, Baer, Mermelstein 1981)
  ([Wikipedia](https://en.wikipedia.org/wiki/Articulatory_synthesis)).
- Maeda (1988-1990): factor-analysis articulatory model from about 1000 frames
  of cineradiographic data of two French speakers
  ([Maeda 1989, ISCA](https://www.isca-archive.org/eurospeech_1989/maeda89_eurospeech.html));
  seven parameters (jaw, tongue body, dorsum, tip, lip protrusion, lip
  height, larynx/hyoid)
  ([Potard, Laprie, arXiv cs/0511076](https://arxiv.org/pdf/cs/0511076)).
- gnuspeech / TRM: waveguide "tube resonance model" of oral and nasal tracts
  controlled by Carre's Distinctive Region Model with eight regions; GPL; GNU
  project since 2002
  ([Wikipedia: Gnuspeech](https://en.wikipedia.org/wiki/Gnuspeech),
  [Manzara TRM write-up](https://www.gnu.org/software/gnuspeech/trm-write-up.pdf)).
- Praat articulatory synthesis (Boersma 1998): Speaker + Artword objects driven
  by muscle activities (Lungs, Interarytenoid, Masseter, OrbicularisOris,
  LevatorPalatini, ...); an [əpə] example took "about 5 minutes on a 1997
  computer" and about 1 s in 2019
  ([Praat manual](https://www.fon.hum.uva.nl/praat/manual/Articulatory_synthesis.html)).
- Engwall 3D tongue model, ArtiSynth (UBC biomechanics), Haskins CASY, DIVA
  ([Wikipedia](https://en.wikipedia.org/wiki/Articulatory_synthesis)).

## Glottal source models

- LF model: Fant, Liljencrants and Lin 1985, "A four-parameter model of glottal
  flow", STL-QPSR 4/1985 pp. 1-13; waveshape parameters Rk, Rg, Ra and
  amplitude Ee
  ([citation via ICPhS 1991 paper](https://www.coli.uni-saarland.de/Phonetics/icphs/ICPhS1991/12_ICPhS_1991_Vol_5/p12.5_442.pdf)).
  Pink Trombone's Rd-based regression is shown above.
- Rosenberg 1971 pulse: JASA 49, 583-590; parameters amplitude, opening time
  Tp and closing time Tn
  ([Praat bibliography](https://www.fon.hum.uva.nl/praat/manual/Rosenberg__1971_.html)).
  Cheapest option for a low-end level of detail.
- Ishizaka and Flanagan 1972 two-mass model: Bell System Technical Journal
  51(6), self-oscillating two stiffness-coupled masses, tract as a bilateral
  transmission line
  ([Nokia Bell Labs](https://www.nokia.com/bell-labs/publications-and-media/publications/synthesis-of-voiced-sounds-from-a-two-mass-model-of-the-vocal-chords),
  [Praat bibliography](https://www.fon.hum.uva.nl/praat/manual/Ishizaka___Flanagan__1972_.html)).
- Modified two-mass "triangular glottis" for breathy voice: Birkholz, Kroger,
  Neuschaefer-Rube, Interspeech 2011
  ([ISCA](https://www.isca-archive.org/interspeech_2011/birkholz11b_interspeech.html)).

## 2D / 3D wave-based vocal tract simulation

| Work                                                    | Method                           | Resolution / rate                    | Reported cost                                                                     | Source                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| FEM vowels cited by Gully et al. (ref. [18])            | 3D FEM                           | n/a                                  | 70-80 h of computation for 20 ms of output                                        | [Gully et al. 2018](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)                                                            |
| Gully, Daffern, Murphy 2018 (dynamic 3D DWM diphthongs) | 3D rectilinear heterogeneous DWM | 400 kHz, 1.52 mm; MRI 2 mm isotropic | about 13 h per second of audio (serial MATLAB); about 3 h/s on an NVIDIA GTX 1070 | [Gully et al. 2018](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)                                                            |
| Speed, Murphy, Howard 2014                              | 3D DWM from 3D MRI               | n/a                                  | n/a                                                                               | [Royal Holloway record](https://pure.royalholloway.ac.uk/en/publications/modeling-the-vocal-tract-transfer-function-using-a-3d-digital-wav) |
| Mullen, Howard, Murphy 2007                             | 2D DWM, impedance mapping        | n/a                                  | real-time dynamic articulation                                                    | [White Rose eprint 3710](https://eprints.whiterose.ac.uk/3710/), [York DWM page](https://www-users.york.ac.uk/~dtm3/dynamicDWM.html)        |
| Mohapatra, Zappi, Fels 2019 (2.5D FDTD)                 | 2.5D FDTD                        | 0.74 mm, dt = 1.51 us (661,500 Hz)   | 15 min 21 s for 50 ms of audio (MATLAB, i7-8700K)                                 | [arXiv 1909.09585](https://arxiv.org/html/1909.09585)                                                                                       |
| Mohapatra, Zappi, Fels 2021 (2D FDTD comparison)        | 2D / 2.5D FDTD                   | 0.74 mm, 0.28 mm, 0.18 mm grids      | about 280 s for /u/ at the coarse grid (see paper Table 4)                        | [arXiv 2102.04588](https://arxiv.org/pdf/2102.04588)                                                                                        |
| Takemoto, Mokhtari, Kitamura 2010                       | 3D FDTD on MRI vowels            | not retrieved                        | not retrieved                                                                     | JASA 128(6) 3724-3738, [Kitamura lab list](https://www.konan-u.ac.jp/hp/kitlab/pub/index_e.html)                                            |
| Arnela, Dabbaghchian, Guasch, Engwall 2019              | 3D FEM, dynamic diphthongs       | n/a                                  | n/a                                                                               | [La Salle record](https://merit.url.edu/en/publications/mri-based-vocal-tract-representations-for-the-three-dimensional-f-4/)               |
| Blandin, Arnela et al. 2022                             | multimodal + 2D FE               | n/a                                  | about 10x cheaper than full 3D FEM, ~1% resonance agreement                       | [URL repository](https://dau.url.edu/handle/20.500.14342/5738)                                                                              |

Additional facts:

- Fully 3D solvers need "several minutes to more than a day for just a few
  milliseconds of audio"
  ([arXiv 1909.09585](https://arxiv.org/html/1909.09585)).
- Gully et al. note that at 48, 96 and 192 kHz parts of the meshed tract become
  discontinuous or one cell thick; 400 kHz (1.52 mm) guarantees at least two
  scattering junctions across every constriction
  ([Gully et al. 2018](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)).
- Reducing the tract to axisymmetric tube sections "has been shown to affect
  frequencies above 4 kHz", and the 2D simulation adds "spurious,
  closely-spaced formants" above about 4 kHz
  ([Gully et al. 2018](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)).
- EUNISON (FP7 FET project 308874, started 1 March 2013, coordinated by Oriol
  Guasch, La Salle; KTH partner) aimed to simulate the whole voice organ in one
  numerical domain
  ([CORDIS](https://cordis.europa.eu/project/id/308874),
  [KTH project page](https://www.kth.se/tmh/projects/eunison-extensive-unified-domain-simulation-of-the-human-voice-1.694118)).
- Aalto University (Malinen group): 3D Helmholtz FEM vs 1D Webster horn model
  on MRI geometries; 3D is "more realistic" than Webster
  ([Kuortti et al. NSCM](https://math.aalto.fi/~jmalinen/MyPSFilesInWeb/NSCM-26_ea.pdf),
  [arXiv 1208.5963](https://arxiv.org/pdf/1208.5963)).
- We could not locate a "Speyer" 3D vocal tract FEM paper; the closest 3D FEM
  works are Vampola et al. (CT-based) and the Arnela/Guasch group
  ([ACM ZCU](https://acm.kme.zcu.cz//article/view/138/93)).

### Derived cost estimates for a browser 3D FDTD

Assumptions (derived): c = 350 m/s, 3D Courant limit, air volume of the
vocal tract about 60 cm^3 (the [ɑ] area function in Story 2008 integrates to
57.3 cm^3, [i] to 37.7 cm^3; see the area table). Radiation space outside
the lips is excluded, which in practice multiplies the cell count.

| dx (mm) | Min fs = c sqrt(3) / dx | Air cells (60 cm^3) | Cell updates per second of audio |
| ------: | ----------------------: | ------------------: | -------------------------------: |
|     1.0 |               606.2 kHz |              60,000 |                           3.6e10 |
|    1.52 |               398.8 kHz |              17,085 |                            6.8e9 |
|     2.0 |               303.1 kHz |               7,500 |                            2.3e9 |
|     3.0 |               202.1 kHz |               2,222 |                            4.5e8 |
|     5.0 |               121.2 kHz |                 480 |                            5.8e7 |
|    10.0 |                60.6 kHz |                  60 |                            3.6e6 |

Implications for the prototype:

- The narrowest Story 2008 vowel cross-sections are 0.13-0.18 cm^2 (equivalent
  diameter about 4-5 mm), so a 3D grid needs dx of about 2 mm or finer to keep
  two cells across constrictions; at 2 mm that is about 2e9 updates per audio
  second, i.e. GPU-only territory and still likely not real time with a
  radiation domain.
- Recommended LOD ladder: (1) 1D Kelly-Lochbaum, 44 sections, 2x oversampled
  (Pink Trombone cost, trivially real time); (2) 1D with more sections and
  losses; (3) 2D/2.5D FDTD on GPU; (4) offline or partial real-time 3D FDTD on
  a voxelized low-poly mesh. The 3D mesh drives the area function in all LODs.
