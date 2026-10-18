# Anatomy and acoustics for a more realistic simulator

This file collects anatomical dimensions and acoustic modelling facts with
sources, and ends with concrete numbers for our presets and solvers. Values
marked **(unverified)** were not confirmed against a primary source.

## Vocal tract length (VTL) by sex and age

- Vorperian et al. 2009 (JASA 125(3):1666-1678,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2669667):
  - VTL grows from about 7-8 cm in infants to about 15 cm in adult females
    and about 17-18 cm in adult males.
  - The pharynx grows more than the oral cavity in males after puberty.
- Fitch & Giedd 1999 (JASA 106:1511-1522,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2824129):
  - MRI of 129 subjects aged 2-25.
  - VTL correlates with body height.
  - The sex difference appears at puberty.
- Pharynx-to-oral ratio:
  - Fant described a larger pharynx/mouth length ratio in males.
  - An MRI case study found the female pharynx about 37% shorter while oral
    lengths were closer
    (https://nanolithography.spiedigitallibrary.org/conference-proceedings-of-spie/3033/0000/Volumetric-image-based-comparison-of-male-and-female-vocal-tract/10.1117/12.274050.full).
- Barreda 2023, "There is no female vocal tract"
  (https://santiagobarreda.com/cvfiles/2023_Barreda_There%20is%20no%20female%20vocal%20tract.pdf):
  - Argues that formant differences between sexes are mostly a size
    difference plus speaker-specific variation.
  - Rejects a categorically different "female shape".
  - Implication: uniform scaling is a good first approximation, and
    non-uniform pharynx scaling is a refinement.

## Formant data for presets

- Hillenbrand et al. 1995 (JASA 97(5):3099-3111, doi 10.1121/1.411872):
  - Measured 45 men, 48 women and 46 children on 12 American English vowels.
  - The data is open: https://github.com/santiagobarreda/hillenbrand_et_al_1995
  - Use it to validate the (F1, F2) output of our male/female/child presets.
- Formants scale roughly inversely with VTL (quarter-wave tube:
  `F_n = (2n - 1) c / (4 L)`).
  - An 18 cm to 15 cm change predicts about +20%.
  - Measured female/male formant ratios are typically 15-20% and vary by vowel
    and formant **(the 15-20% range comes from the issue brief and common
    textbook figures; we did not verify it for every formant)**.

## Oral cavity, palate, teeth, tongue, lips

| Structure                     | Typical value                           | Source                                                                                                             |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tongue volume, overall        | 79.5 ± 14.2 cm³                         | Liégeois 2010, https://academic.oup.com/ejo/article/32/4/381/514557                                                |
| Tongue volume, male           | 89.9 ± 11.5 cm³                         | same                                                                                                               |
| Tongue volume, female         | 68.9 ± 7.0 cm³                          | same                                                                                                               |
| Tongue volume (older MRI)     | 71-79 cm³                               | Lauder & Muhl 1991, https://read.qxmd.com/read/1928821/estimation-of-tongue-volume-from-magnetic-resonance-imaging |
| Upper central incisor crown   | ~9.9-10.4 mm long, ~8.5 mm wide         | https://synapse.koreamed.org/articles/1054420, https://banglajol.info/index.php/UpDCJ/article/view/13954           |
| Intercanine width (maxilla)   | ~32-34 mm                               | https://pafmj.org/PAFMJ/article/download/1812/1563                                                                 |
| Intermolar width (maxilla)    | ~45-49 mm; 49.2 mm male, 47.6 mm female | https://jbumdc.bahria.edu.pk/index.php/ojs/article/download/497/771/1334                                           |
| Palatal vault at first molars | ~41.5 mm wide, ~20 mm deep              | https://ojs.uomosul.edu.iq/index.php/rden/article/download/35097/34897                                             |
| Anterior palatal vault        | ~32 mm wide, ~13 mm deep                | same                                                                                                               |
| Palate depth by sex           | ~17.4 mm male, ~15.7 mm female          | Jordanian sample **(unverified URL)**                                                                              |

- Males have wider, shorter palates in an ancestry/sex study
  (https://iro.uiowa.edu/esploro/outputs/journalArticle/The-Influence-of-Sex-and-Ancestry/9984353934402771).
- Lips: lip protrusion and aperture are the strongest controls of F2 for
  rounded vowels. Maeda's model has separate lip height and protrusion
  factors (https://www.isca-archive.org/eurospeech_1989/maeda89_eurospeech.html).

### Teeth acoustics

- Traser et al. 2017 (JSLHR 60:2379-2393,
  https://pubs.asha.org/doi/abs/10.1044/2017_JSLHR-S-16-0395):
  - Teeth add pole-zero pairs, mainly in tracts with side cavities between
    the teeth and lips/cheeks.
  - The authors recommend including teeth in 3D models.
- Shadle's obstacle mechanism for sibilants:
  - A jet hitting the incisors produces much stronger noise than a free jet
    (https://www.ioa.org.uk/system/files/publications/CH%20SHADLE%20MODELS%20OF%20TURBULENT%20NOISE%20SOURCES%20IN%20THE%20VOCAL%20TRACT.pdf).
  - Mechanical models built from MRI show teeth increase noise depending on
    tongue shape
    (https://researchers.mq.edu.au/en/publications/mechanical-models-of-fricatives-based-on-mri-derived-vocal-tract-/).
- /s/ spectra:
  - Main peak around 5 kHz (lower for larger tracts).
  - Tongue grooving adds energy above 8 kHz
    (https://www.phonetik.uni-muenchen.de/~hoole/pdf/brunneretal_clp_2011.pdf).
- Implication: model sibilant noise as a dipole source located at the teeth
  (obstacle) rather than at the constriction. Its amplitude should scale with
  jet velocity and with the distance from the constriction to the teeth.

## Side cavities

- Nasal cavity:
  - The Sawada robot uses a 60 cm³ plaster nasal cavity
    (https://pmc.ncbi.nlm.nih.gov/articles/PMC2279150).
  - VTL models the nasal tract as a branch with velum coupling (VTL 2.4
    manual, https://vocaltractlab.de/download-vocaltractlab/VTL2.4-manual.pdf).
- Paranasal sinuses:
  - VTL attaches 4 Helmholtz resonators to the nasal tract, after Dang & Honda
    (VTL 2.4 manual).
  - Vampola et al. studied nasal and paranasal cavities with FE
    (https://engmechy.it.cas.cz/im/proceedings/show_p/2017/1018).
- Piriform fossae:
  - Takemoto et al. (JASA 2013) showed they behave as a coupled pair of side
    branches producing spectral dips (https://www.konan-u.ac.jp/hp/kitlab/pub).
  - Delvaux & Howard 2014 report a trough at 4-5 kHz
    (https://eprints.whiterose.ac.uk/79850/1/PlosOne_DelvauxHoward_2014.pdf).
  - Tuned 2D tracts with piriform fossae reproduce F4
    (https://merit.url.edu/en/publications/tuned-two-dimensional-vocal-tracts-with-piriform-fossae-for-the-f-4/).
- Vallecula and interdental spaces:
  - Small side cavities that add minor pole-zero pairs above about 4 kHz
    **(no primary numbers verified)**.
  - In a voxel model they appear automatically if the geometry includes them.
- Higher-order modes:
  - A transverse pharynx mode creates a dip near 8 kHz.
  - For the subject studied, 1D was valid up to about 7 kHz (Takemoto et al.,
    Interspeech 2014,
    https://www.isca-archive.org/interspeech_2014/takemoto14_interspeech.html).

## MRI area function and 3D datasets

| Dataset                        | Content                                                     | Link                                                                                                    |
| ------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Story, Titze & Hoffman 1996    | 18 area functions (12 vowels, 3 nasals, 3 plosives), 1 male | https://experts.arizona.edu/en/publications/vocal-tract-area-functions-from-magnetic-resonance-imaging/ |
| Story 2008                     | 2002 versus 1994 area functions of the same speaker         | https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017                                                        |
| York 3D VTTF                   | MRI volumes used for 3D DWM                                 | https://www-users.york.ac.uk/~dtm3/3DVTTF/mri_data.html                                                 |
| YorVoice female area functions | volumetric female data                                      | https://catalogue.yorvoice.york.ac.uk/catalogue/NWW4IRY6                                                |
| Dresden Vocal Tract Dataset    | printable 3D tracts from MRI                                | https://github.com/TUD-STKS/DVTD                                                                        |
| Traser et al. 2017             | 3D tract models with/without teeth                          | https://figshare.com/articles/Teeth_in_3D_vocal_tract_models_Traser_et_al_2017_/5386771                 |
| Hillenbrand 1995               | formants of 139 speakers                                    | https://github.com/santiagobarreda/hillenbrand_et_al_1995                                               |

Before bundling any dataset, check its licence.

## Glottal source

- LF model and Rd:
  - Rd is a single shape parameter from a regression of the LF R-parameters
    (Ra, Rk, Rg).
  - Its main range is about 0.3-2.7, from tense to breathy (summaries of Fant
    1995: https://www.isca-archive.org/interspeech_2023/wang23ra_interspeech.pdf,
    https://hal.archives-ouvertes.fr/hal-00865343).
  - The original Fant 1995 STL-QPSR paper was not fetched **(unverified
    first-hand)**.
  - The regression we use is the one in Pink Trombone
    (https://dood.al/pinktrombone/), already present in
    `src/acoustics/glottis.js`, where Rd is clamped to 0.5-2.7.
- Rd is nearly identical to the normalised amplitude quotient (NAQ)
  (https://www.isca-archive.org/interspeech_2023/wang23ra_interspeech.pdf).
- Titze 1984 (JASA 75(2):570-580, doi 10.1121/1.390530,
  https://iro.uiowa.edu/esploro/outputs/journalArticle/Parameterization-of-the-glottal-area-glottal/9984719572302771):
  - Parameterises glottal area and flow with abduction, shape, phase and load
    quotients.
  - Useful if we later move to a physical glottal area model.
- Self-oscillating models in VTL (VTL 2.4 manual):
  - Triangular glottis (Birkholz et al. 2011).
  - Geometric glottis 2019 and 2025.
- Losses at constrictions:
  - Birkholz et al. 2007 (IEEE TASLP 15(4):1218-1226,
    https://scinapse.io/papers/2143877646) distribute turbulence pressure loss
    to avoid discontinuities in moving constrictions.

## Male versus female voice

| Feature                               | Male                             | Female                         | Source                                                                                                                                                                               |
| ------------------------------------- | -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Speaking F0 range                     | ~85-155 Hz (often quoted to 180) | ~165-255 Hz                    | Baken 1987 via https://auditory.org/mhonarc/2000/msg00400.html; https://en.wikipedia.org/wiki/Voice_frequency                                                                        |
| Mean speaking F0 (Australian English) | 115 ± 21 Hz                      | 199 ± 28 Hz                    | Leung et al. 2022 (via search summary, **unverified first-hand**)                                                                                                                    |
| VTL                                   | ~17-18 cm                        | ~15 cm                         | Vorperian 2009                                                                                                                                                                       |
| Glottal closure                       | more complete                    | often posterior gap, breathier | Hanson & Chuang, https://auditory.org/asamtgs/asa96haw/2pSC/2pSC8.html                                                                                                               |
| Spectral tilt (H1-A3)                 | ~11 dB lower than female         | steeper roll-off               | same                                                                                                                                                                                 |
| H1-H2 (open quotient correlate)       | lower                            | higher                         | Hanson 1997 JASA 101:466-481; https://ocw.mit.edu/courses/6-542j-laboratory-on-the-physiology-acoustics-and-perception-of-speech-fall-2005/9a410aa5de0a94d085b680f35b0d5954_lab5.pdf |

The issue reports that our voice currently sounds male. Raising F0 alone
produces a "high-pitched man". A convincing female preset needs all of the
following:

- a shorter tract, with the shortening concentrated in the pharynx
- a higher Rd (laxer pulse, larger open quotient)
- more aspiration noise
- a steeper spectral tilt

This matches Klatt & Klatt 1990 (JASA 87:820-857) and Hanson 1997.

## Radiation, wall losses and head diffraction

- Lip radiation:
  - Classically a piston in an infinite baffle, with Bessel/Struve radiation
    impedance (https://arxiv.org/pdf/2004.14948).
  - In 1D models this is approximated by a high-pass (first-difference)
    filter plus a lip reflection coefficient. Pink Trombone uses -0.85.
- Yielding walls:
  - Wall impedance shows complex mechanical behaviour below about 150 Hz
    (Ishizaka et al. 1975, as summarised in the Fleischer et al. article
    below; **the source of this summary is unverified**).
  - Wall impedance depends on frequency and vowel and affects formant
    bandwidths (Fleischer et al.,
    https://link.springer.com/article/10.1007/s10237-014-0632-2).
  - Yielding walls raise F1 slightly and widen low-formant bandwidths.
  - In 1D, add a per-section mass-spring-damper shunt or a simple loss
    coefficient.
  - In 3D FDTD, use a locally reacting boundary impedance.
- Head diffraction:
  - The head acts as a baffle. Beyond the piston model, 3D simulations that
    radiate into free field capture it (Arnela & Guasch 2017; see
    `video-and-science.md`).
  - Treating the head as a sphere is a common approximation **(not verified
    here)**.

## Microphone, distance and room

- Distance:
  - In free field, direct sound falls by 6 dB per doubling of distance
    (inverse-square law).
  - Near-field proximity effects and lip radiation directivity matter below
    about 30 cm **(textbook physics, not sourced here)**.
- Image source method:
  - Allen & Berkley 1979 (JASA 65:943-950, doi 10.1121/1.382599,
    https://jontalle.web.engr.illinois.edu/Public/AllenBerkley79.pdf) is the
    standard for shoebox rooms.
  - Its cost grows roughly cubically with reverberation length
    (https://arxiv.org/pdf/1106.1199).
  - Reference implementation: https://github.com/ehabets/RIR-Generator
- Sabine:
  - `RT60 = 0.161 V / A` (V in m³, A in m² sabins).
  - Use it to pick wall absorption for a target RT60 **(standard formula, not
    sourced from a fetched page)**.
- FDTD rooms with frequency-dependent walls:
  - Kowalczyk & van Walstijn 2011 (IEEE TASLP 19(1):34-46, doi
    10.1109/TASL.2010.2045179,
    https://cris.fau.de/publications/122961564) model wall impedance as a
    digital filter in a locally reacting surface with a stability proof.
  - Related QUB work: https://pure.qub.ac.uk/en/publications/modelling-frequency-dependent-boundaries-as-digital-impedance-fil/
- Absorbing boundaries for an open (anechoic) domain:
  - Perfectly matched layers (PML) are used in acoustic FDTD
    (https://hal.univ-lorraine.fr/hal-01914838).
  - Cheaper first-order Mur/Engquist-Majda conditions also work but reflect
    more at grazing angles **(standard numerics, not sourced here)**.

## Recommendations with concrete numbers

1. Speaker presets:

   | Preset        | VTL        | Pharynx scale | Oral scale | F0 mean    | F0 range   | Rd      | Aspiration | Tilt                    |
   | ------------- | ---------- | ------------- | ---------- | ---------- | ---------- | ------- | ---------- | ----------------------- |
   | Adult male    | 17.5 cm    | 1.00          | 1.00       | 115 Hz     | 85-155 Hz  | 1.0-1.2 | low        | baseline                |
   | Adult female  | 14.5-15 cm | ~0.80         | ~0.92      | 200 Hz     | 165-255 Hz | 1.4-1.8 | +6 dB      | -6 dB extra above 2 kHz |
   | Child (~8 yr) | 12-13 cm   | ~0.70         | ~0.80      | 250-280 Hz | 200-350 Hz | 1.5-2.0 | moderate   | steep                   |
   - The pharynx/oral split is a modelling choice based on the shorter female
     pharynx cited above **(exact factors are our estimate)**.
   - Randomise within roughly ±1 SD:
     - F0 ±25 Hz
     - VTL ±0.7 cm
     - Rd ±0.2

2. Validate presets against Hillenbrand 1995 (F1, F2) per vowel. Target a
   mean absolute error below 10% on the corner vowels /i a u/.
3. Teeth geometry (3D model):
   - Upper incisors about 10 mm × 8.5 mm.
   - Arch about 33 mm at the canines and about 47 mm at the molars.
   - Palate about 16-20 mm deep at the molars.
   - Put the sibilant noise source at the incisor edge.
4. Tongue mesh volume of about 90 cm³ (male) or 69 cm³ (female), preserved
   while deforming.
5. Side branches in 1D:
   - Piriform fossae: two short side tubes, about 2 cm, tuned to a dip at
     4-5 kHz.
   - Sinuses: Helmholtz resonators on the nose branch.
6. Sample rate 48 kHz (as in VTL).
   - 1D covers up to about 5 kHz accurately.
   - Enable 3D FDTD only when the user chooses "high precision".
7. Room:
   - Box around the head with image-source reverb (orders 0-N), or an FDTD
     boundary admittance per wall.
   - RT60 presets: anechoic 0 s, booth 0.15 s, living room 0.4-0.5 s, hall
     1.5 s.
   - Absorption from Sabine.
8. Microphone:
   - Position in head coordinates, default 30 cm on axis.
   - Apply `1/r` gain and a delay of `r / c` with `c = 343 m/s`.
