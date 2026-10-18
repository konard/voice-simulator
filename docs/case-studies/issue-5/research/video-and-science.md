# The referenced video and key scientific literature

## The video: https://youtu.be/HmSYnOvEueo

### What we could access

- YouTube oEmbed
  (https://www.youtube.com/oembed?url=https://youtu.be/HmSYnOvEueo&format=json)
  and noembed
  (https://noembed.com/embed?url=https://www.youtube.com/watch?v=HmSYnOvEueo)
  return:
  - Title: **"Utterance robot finally got the same voice as humans"**
  - Uploader: **ikinamo** (https://www.youtube.com/@ikinamo)
  - Thumbnail: https://i.ytimg.com/vi/HmSYnOvEueo/hqdefault.jpg
- The watch page, description and transcript were **not accessible** from our
  environment, so we did not watch the video itself.

### Identification (inferred, partially unverified)

The title and the uploader match DigInfo TV's 2011 coverage of
**Prof. Hideyuki Sawada's talking robot** (Kagawa University).

- TechCrunch, "Video: Japanese Robot Talks Like A Human" (Serkan Toto, 13 Jul
  2011, https://techcrunch.com/?p=388557), embeds `HmSYnOvEueo` as the "much
  better" DigInfo video. It describes:
  - an air compressor as lungs
  - pressure and control valves
  - 8 motors that shape a resonance tube acting as the throat
  - artificial vocal cords
  - a silicone tongue and lips
  - a microphone plus computer processing
- IEEE Spectrum, "Freaky Robot Mouth Learns to Sing" (Evan Ackerman, 13 Jul
  2011,
  https://spectrum.ieee.org/automaton/robotics/medical-robots/freaky-robot-mouth-learns-to-sing),
  says the robot was shown at Robotech 2011. It has:
  - air-pump lungs
  - 8 artificial vocal folds
  - a silicone tongue
  - a nasal chamber that opens and closes
  - a microphone so it listens to itself and becomes more intelligible
- **Unverified:** that the ikinamo upload is byte-identical to the DigInfo
  video. The attribution rests on the TechCrunch embed.

### The science behind it

Sawada, Kitani & Hayashi 2008, "A Robotic Voice Simulator and the Interactive
Training for Hearing-Impaired People", J. Biomed. Biotechnol. 2008:768232,
doi 10.1155/2008/768232 (https://pmc.ncbi.nlm.nih.gov/articles/PMC2279150):

- Mechanics:
  - A silicone resonance tube about 180 mm long and 36 mm in diameter (about
    10.2 cm²).
  - Deformed by 8 servo positions, plus a sliding valve for the nasal branch
    (9 motors).
- Source:
  - Two-layer silicone vocal cords.
  - Pitch is set by cord tension through a learned motor-to-F0 map.
- Nasal cavity: a plaster cast of about 60 cm³.
- Learning (SONN):
  - A self-organising map on a 25×25 grid takes 10th-order LPC cepstrum
    features of the robot's own voice.
  - A 3-layer perceptron then maps sound features to motor commands.
  - Vowel F1/F2 matched human targets after learning.
- Application:
  - Hearing-impaired users see the robot's articulation for their own
    utterance and get corrective feedback.
  - In a trial with 6 subjects, 5 improved.

### Ideas we can learn from the video

1. **Close the loop with listening.** The robot improves by analysing its own
   output with LPC cepstra and adjusting its motors. Our equivalent is
   analysis-by-synthesis: synthesise, analyse (formants, LPC cepstrum),
   compare with a target, and adjust parameters. This one mechanism serves
   both voice matching from WAV and automatic tuning of vowel targets.
2. **Few control degrees of freedom are enough.** Eight constriction controls
   plus a nasal valve produce intelligible vowels. This matches the
   8-region DRM of Gnuspeech (see `competitors.md`) and supports a compact
   control layer for fitting.
3. **Show articulation as feedback.** The robot is used to teach articulation.
   Our three.js head can show the tongue, teeth and lips for each highlighted
   syllable, so highlighting and the 3D view should share one timing track.
4. **The physical tube is a 1D-ish acoustic object.** An 18 cm × 3.6 cm tube
   is well described by a 1D area function below its first transverse mode.
   The cut-on is about `1.84 c / (π d)`, roughly 5.6 kHz for d = 3.6 cm
   (standard circular-duct theory; our calculation). The 3D effects that
   matter are side branches (nose) and the source.

## Key papers (one-line takeaways)

| #   | Paper                                                                                                                                                                                                 | Takeaway for us                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Story 2005, "A parametric model of the vocal tract area function for vowel and consonant simulation", JASA 117(5):3231; https://sites.arizona.edu/sapl/files/2023/10/story_jasa2005-1.pdf             | Neutral area function + 2 eigenmodes + consonant shaping function give a compact, speaker-scalable control space.                                                |
| 2   | Story 2011 (TubeTalker airway modulation model); https://sites.arizona.edu/sapl/files/2023/10/Story-2011_0-1.pdf                                                                                      | Superimpose fast glottal, slower articulatory and nasal modulations on one neutral tract.                                                                        |
| 3   | Birkholz 2013, "Modeling consonant-vowel coarticulation for articulatory speech synthesis", PLoS ONE 8(4):e60603 (cited in the VTL 2.4 manual)                                                        | Interpolate consonant targets between /aCa/, /iCi/ and /uCu/ prototypes for natural coarticulation.                                                              |
| 4   | Birkholz et al. 2007, "Simulation of losses due to turbulence in the time-varying vocal system", IEEE TASLP 15(4):1218-1226; https://scinapse.io/papers/2143877646                                    | Distribute constriction pressure losses to avoid clicks when constrictions move.                                                                                 |
| 5   | Takemoto, Mokhtari & Kitamura 2010, 3D FDTD acoustic analysis of the vocal tract in vowels, JASA 128(6):3724-3738; https://www.konan-u.ac.jp/hp/kitlab/pub                                            | 3D FDTD on MRI tracts reproduces measured transfer functions, including side-branch dips (abstract details **unverified**).                                      |
| 6   | Takemoto et al. 2014, 1D versus 3D comparison, Interspeech; https://www.isca-archive.org/interspeech_2014/takemoto14_interspeech.html                                                                 | 1D is adequate up to about 7 kHz for the subject studied; a transverse pharynx mode creates a dip near 8 kHz.                                                    |
| 7   | Arnela & Guasch 2014, "Two-dimensional vocal tracts with three-dimensional behavior...", JASA 135(1):369-379, doi 10.1121/1.4837221; https://dau.url.edu/handle/20.500.14342/5726                     | Tuning the profile, wall impedance, source and radiation of a 2D model reproduces 3D output at much lower cost.                                                  |
| 8   | Arnela, Guasch et al. on the influence of vocal tract geometry; https://dau.url.edu/handle/20.500.14342/5729                                                                                          | Below about 4-5 kHz, bending and cross-section shape barely matter; above that, realistic 3D geometry does.                                                      |
| 9   | Freixes, Arnela et al. 2019, Appl. Sci. 9:4535; https://www.doi.org/10.3390/app9214535                                                                                                                | Higher-order modes are perceptually relevant for tense voice (low Rd) and high F0, so 3D pays off for female and pressed voices.                                 |
| 10  | Speed, Murphy & Howard 2014, 3D digital waveguide mesh of the vocal tract, IEEE/ACM TASLP 22(2):453-464; https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf                                  | A 3D DWM from MRI gives more realistic high-frequency spectra than 1D; data at https://www-users.york.ac.uk/~dtm3/3DVTTF/mri_data.html.                          |
| 11  | Blandin et al. 2021 (VocalTractLab3D, multimodal method), Interspeech; https://vocaltractlab.de/publications/blandin-2021-interspeech.pdf                                                             | About 1% resonance error versus FEM at about 10x lower cost by propagating transverse modes along the centreline.                                                |
| 12  | Mohapatra et al. 2022, 3D FDTD of simplified vocal tract shapes, Interspeech; https://www.vocaltractlab.de/publications/mohapatra-2022-interspeech.pdf                                                | Simplified geometry has negligible effect below 5 kHz; open MATLAB code: https://github.com/Debasishray19/fdtd-vocaltract-model.                                 |
| 13  | Zappi, Vasudevan, Allen, Raghuvanshi & Fels 2016, real-time 2D wave propagation on GPU (ASA 171st meeting); https://www.microsoft.com/en-us/research/?p=546369                                        | A GPU 2D FDTD with a two-mass glottis runs at near-1D cost. Full 3D still takes minutes per few ms of audio.                                                     |
| 14  | Kitamura lab, GPGPU 3D FDTD for the vocal tract (ASJ 2011, Japanese); https://www.konan-u.ac.jp/hp/kitlab/pub/asj201103_gpu.pdf                                                                       | GPU 3D FDTD speed-ups reported (roughly 30x in the poster, **baseline unverified**).                                                                             |
| 15  | Kowalczyk & van Walstijn 2011, "Room acoustics simulation using 3-D compact explicit FDTD schemes", IEEE TASLP 19(1):34-46, doi 10.1109/TASL.2010.2045179; https://cris.fau.de/publications/122961564 | Interpolated compact schemes beat the standard Yee/DWM in isotropy and bandwidth, and handle frequency-dependent walls as digital filters with proven stability. |
| 16  | Allen & Berkley 1979, image method, JASA 65:943-950; https://jontalle.web.engr.illinois.edu/Public/AllenBerkley79.pdf                                                                                 | Shoebox room impulse responses for the head-in-a-box reverb, cheaply.                                                                                            |
| 17  | Traser et al. 2017, teeth in 3D vocal tract models, JSLHR 60:2379-2393; https://pubs.asha.org/doi/abs/10.1044/2017_JSLHR-S-16-0395                                                                    | Teeth add pole-zero pairs and should be modelled.                                                                                                                |
| 18  | Titze 1984, glottal area/flow parameterisation, JASA 75(2):570-580; https://iro.uiowa.edu/esploro/outputs/journalArticle/Parameterization-of-the-glottal-area-glottal/9984719572302771                | Abduction, shape, phase and load quotients form a physical alternative to LF.                                                                                    |
| 19  | Lammert & Narayanan 2015, VTL from formants, PLoS ONE 10(7):e0132193; https://pmc.ncbi.nlm.nih.gov/articles/PMC4503663/                                                                               | Weight higher formants to estimate VTL (about 1.3 cm RMSE on real speech).                                                                                       |

The LF model and the Rd parameter (Fant 1995, STL-QPSR) are covered in
`anatomy-and-acoustics.md`. The primary paper was not fetched.

## Performance: same waveform, less time

Our solver (`src/acoustics/fdtd3d.js`) works as follows:

- It is a staggered-grid FDTD on a sparse voxel set.
- Its Courant number is 0.5, so `dt = 0.5 dx / c` with `c = 35000 cm/s`.
- The tiers in `src/perf/lod.js` use `dx = 1 cm` ("high") and `dx = 0.6 cm`
  ("ultra").

From that, the following points follow. They are standard numerics unless a
source is given.

- Bandwidth limit:
  - With the usual rule of thumb of about 10 cells per wavelength **(rule of
    thumb, unverified source)**, `dx = 1 cm` resolves up to about
    `c / (10 dx) = 3.5 kHz`, and `dx = 0.6 cm` up to about 5.8 kHz.
  - A tract about 3 cm wide gets only 3-5 cells across, so transverse modes
    (which start around 5-8 kHz) are not resolved.
  - The 3D tier therefore currently adds mostly radiation and bend effects,
    not the high-frequency effects that justify 3D (papers 6, 8, 9).
  - For true high-frequency gains, `dx` must be about 0.2-0.3 cm.
- Cost scaling:
  - Halving `dx` multiplies cells by 8 and steps by 2: **16x the work**.
  - Sparse storage (only air voxels plus a radiation shell) is essential; we
    already do this.
- Work-saving ideas that keep the result bit-identical:
  - Precompute per-link and per-cell coefficients (fill fractions, loss
    factors, boundary admittances) whenever the articulation changes, not
    every step. Update them at control rate (for example every 1-2 ms) with
    linear interpolation of the fill fraction.
  - Structure-of-arrays `Float32Array` storage plus neighbour index arrays,
    and branch-free inner loops by splitting boundary links into separate
    lists. The kernel experiments in `experiments/issue-5-fdtd-kernels.mjs`
    and `experiments/wasm/` explore this.
  - WASM SIMD (4 lanes) for the update loops. Workers with domain
    decomposition along the tract, exchanging one halo layer per step
    (`SharedArrayBuffer` needs cross-origin isolation).
  - Output sample-rate conversion done once at the end, not per sample.
- Ideas that change the result slightly but cut cost a lot:
  - Hybrid: 1D waveguide for the glottis-to-pharynx part, 3D only for the
    oral cavity, teeth, lips and radiation. Below 4-5 kHz, geometry matters
    little (paper 8).
  - Interpolated compact schemes (paper 15) allow coarser grids for the same
    isotropy.
  - Multi-rate or adaptive time stepping: a coarse grid in the far field and
    a fine grid in the mouth, or a larger `dt` where only low frequencies
    matter **(more complex; would need its own stability analysis)**.
  - GPU (WebGPU compute) is promising given papers 13 and 14, but we found
    no WebGPU vocal tract implementation to compare against.
- Fast "can this hardware handle it?" probe (early termination):
  1. Build the voxel model, then time `N` steps (for example 200 steps,
     about 3 ms of audio) after a short warm-up.
  2. Extrapolate: `realtimeFactor = (stepTime × stepsPerSecond)`. If the
     projected render time for the utterance exceeds the user's budget (or
     realtime for live playback), stop immediately. Propose the next lower
     tier, or 1D, with a predicted time.
  3. During a full render, keep checking progress every ~50 ms of
     simulated audio. If the measured rate is 1.5x worse than projected,
     abort early with partial audio and an explanation, instead of freezing
     for minutes.
  4. Cache the measured steps per second per tier in `localStorage`, keyed by
     user agent and core count, so later sessions start at the right tier.
     `src/perf/benchmark.js` and the `LodGovernor` in `src/perf/lod.js` are
     the places to wire this in.

## Recommendations from the literature

1. Keep 1D (with side branches) as the default. It is accurate below about
   4-5 kHz (papers 6, 8, 12).
2. Make the 3D tier worth its cost:
   - smaller `dx` in the oral cavity and teeth region
   - hybrid 1D/3D coupling
   - teeth and a sibilant obstacle source
3. Add the probe-and-abort benchmark before any 3D render. Show predicted
   time per tier.
4. Use analysis-by-synthesis, the "robot listens to itself" idea, for voice
   matching and for automatic calibration of vowel targets against
   Hillenbrand 1995 data.
