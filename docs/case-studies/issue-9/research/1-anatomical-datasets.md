## 1. Anatomical reference datasets

Conventions used in this section:

- Sizes are exact byte counts from the figshare/Zenodo APIs or from HTTP `Content-Length` headers I fetched on 2026-10-18.
- Licences are copied from the landing page or the API `license` field.
- "Inferred" marks facts I measured myself in downloaded files. These are not stated by the dataset authors.

### 1.1 Birkholz et al. 2020: Dresden Vocal Tract Dataset (DVTD), the most important dataset

**Paper.** Birkholz, P., Kürbis, S., Stone, S., Häsner, P., Blandin, R., Fleischer, M. "Printable 3D vocal tract shapes from MRI data and their acoustic and aerodynamic properties." _Scientific Data_ 7, 255 (2020). doi:10.1038/s41597-020-00597-w. Full text: <https://pmc.ncbi.nlm.nih.gov/articles/PMC7406497/>. The article is licensed CC BY 4.0 (same page).

**Licence of the data: CC0.** The figshare API reports `"license": {"name": "CC0"}` for every item in the collection, including the full archive (article 11897187) and every example file: <https://api.figshare.com/v2/articles/11897187>. Collection landing page: <https://springernature.figshare.com/collections/Printable_3D_vocal_tract_shapes_from_MRI_data_and_their_acoustic_and_aerodynamic_properties/4869732>.

- Caveat: the mirror page on vocaltractlab.de shows only "Copyright (c) 2025 Peter Birkholz" and names no licence (<https://www.vocaltractlab.de/>).
- The authors' GitHub repository has no LICENSE file.
- The figshare deposit is the canonical, citable source with an explicit CC0 grant, so download from figshare (or verify the md5 against it).

**Subjects** (paper, PMC7406497):

| Speaker | Sex    | Age  | Height | Notes          |
| ------- | ------ | ---- | ------ | -------------- |
| s1      | male   | 39 y | 1.85 m |                |
| s2      | female | 32 y | 1.64 m | trained singer |

Each speaker has 22 German sounds:

| Group                  | Sounds (index, IPA, file label)                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8 tense vowels         | 01 aː `bahn-tense-a`, 02 eː `beet-tense-e`, 03 iː `tiere-tense-i`, 04 oː `boote-tense-o`, 05 uː `bude-tense-u`, 06 ɛː `laehmung-tense-ae`, 07 øː `hoehle-tense-oe`, 08 yː `guete-tense-y` |
| 6 sustained consonants | 09 l `los-l`, 10 f `fahrt-f`, 11 s `bass-s`, 12 ʃ `schoen-sh`, 13 ç `ich-c`, 14 x `ach-x`                                                                                                 |
| 8 lax vowels           | 15 a `bass-lax-a`, 16 ɛ `bett-lax-ae`, 17 ɪ `mit-lax-i`, 18 ɔ `offen-lax-o`, 19 ʊ `butter-lax-u`, 20 ʏ `muetter-lax-y`, 21 œ `goetter-lax-oe`, 22 ə `ehe-schwa`                           |

File names follow `s{1,2}-NN-<label>-…` (verified in the zip central directory of `dvtd.zip`, see below).

**Acquisition and processing** (paper, PMC7406497):

- MRI: Siemens 3T TIM Trio, `fl3d-vibe` sequence, voxel size 1.2 × 1.2 × 1.8 mm, 44 slices, matrix 192 × 192, FOV 230 mm, about 14 s per sustained sound.
- Upsampling to 0.25 mm in 3D Slicer, then segmentation in ITK-SNAP. **The nasal cavity is excluded** (velum closed for all sounds).
- Teeth were added from plaster casts laser-scanned with a NextEngine scanner.
- Meshes were smoothed in MeshLab while keeping the teeth, uvula and epiglottis. They were cut open at the glottis and lips in Blender.
- **No area functions and no centrelines are distributed.** The paper also does not define a coordinate frame.

**Acoustic ground truth** (paper, PMC7406497):

|                    | Calculated VVTF (`vvtf-calculated.txt`) | Measured VVTF (`vvtf-measured.txt`)   |
| ------------------ | --------------------------------------- | ------------------------------------- |
| Method             | FEM in FEniCS                           | 3D-printed models                     |
| Excitation / range | 0–10000 Hz in steps of 0.961304 Hz      | sweep 100–10000 Hz, sampled at 96 kHz |
| Settings           | c = 345 m/s, ρ = 1.18 kg/m³             |                                       |
| Cost               | up to about 9 h per model on 12 cores   |                                       |

VVTF stands for the transfer function from volume velocity at the glottis to volume velocity at the lips.

- Measured and calculated resonance frequencies differ by a mean of **0.9 % (s1) and 0.8 % (s2)**. The worst case is **6.0 %** (fR1 of /ʃ/, s1).
- The deposit also includes aerodynamic noise recordings at 500–3000 mW blowing power, plus "model-sound" and "reference-sound" WAVs.
- Listening test: tense vowels synthesised through the models were recognised at **68.3 % (s1)** and **57.0 % (s2)**. The natural recordings scored 78.6 % and 77.4 %.

**Files per sound** (from the central directory of the full zip; 2923 entries in total, of which 1936 are `.ima` MRI slices):

- `mri/*.ima`
- `-inner-surface.stl` and `-inner-surface-closed.stl`
- `-fem.msh` (Gmsh)
- `-printable-model.stl`, `-printable-left-half.stl`, `-printable-right-half.stl`
- `-vvtf-measured.txt`, `-vvtf-calculated.txt`
- `-sweep-primary.wav`, `-sweep-reference.wav`
- `-noise-{500..3000}mW.wav`, `-noise-psd.txt`, `-noise-metadata.txt`
- `-model-sound.wav`, `-reference-sound.wav`

Other files: `s1-mandible.stl` (2500034 B), `s1-maxialla.stl` (sic, 2500084 B), `s2-mandible.stl` (2807384 B), `s2-maxilla.stl` (2750684 B). The `misc/` folder holds `trachea.stl` (780784 B), `bronchial_horn.stl` (1238584 B), `display_data.py`/`.m`, the FEniCS scripts and `combined_plots.pdf`.

#### 1.1.1 Direct no-login downloads (best files for unit tests)

`https://ndownloader.figshare.com/files/<id>` returns a 302 redirect to a signed S3 URL and needs no login (verified with `curl -L`). The sizes and md5 values below come from the figshare API (`https://api.figshare.com/v2/collections/4869732/articles`, then each article's `files[]`).

Example sound s1-01 /aː/ (speaker 1):

| File                                                     | Bytes      | Direct URL                                        | md5                              |
| -------------------------------------------------------- | ---------- | ------------------------------------------------- | -------------------------------- |
| s1-01-bahn-tense-a-inner-surface.stl                     | 2124134    | <https://ndownloader.figshare.com/files/22708202> | 1ade32457fa16e7bd42781f853adacd6 |
| s1-01-bahn-tense-a-inner-surface-closed.stl              | 3000084    | <https://ndownloader.figshare.com/files/22708205> | 95b5ea663f161da99dbc667686f543df |
| s1-01-bahn-tense-a-printable-model.stl                   | 2528034    | <https://ndownloader.figshare.com/files/22708211> | 3d8d9016fa7497c66b79bdd4d048827b |
| s1-01-bahn-tense-a-printable-left-half.stl               | 1355984    | <https://ndownloader.figshare.com/files/22708238> | 79d2f7241d59dd39defc2bf0ebe69abb |
| s1-01-bahn-tense-a-printable-right-half.stl              | 1435984    | <https://ndownloader.figshare.com/files/22708196> | 7aff1d2cc022838a2107a40939b23289 |
| s1-01-bahn-tense-a-vvtf-calculated.txt                   | 101708     | <https://ndownloader.figshare.com/files/22708223> | 3129166edcb95f21377dd006d49662f3 |
| s1-01-bahn-tense-a-vvtf-measured.txt                     | 424345     | <https://ndownloader.figshare.com/files/22708244> | c5356cb7a39b7b273c212c26bca2407e |
| s1-01-bahn-tense-a-model-sound.wav                       | 134444     | <https://ndownloader.figshare.com/files/22708229> | (see API)                        |
| s1-01-bahn-tense-a-reference-sound.wav                   | 123524     | <https://ndownloader.figshare.com/files/22708217> | (see API)                        |
| s1-01-bahn-tense-a.zip (the whole /aː/ folder incl. MRI) | 24814457   | <https://ndownloader.figshare.com/files/22725218> | (see API)                        |
| **dvtd.zip** (complete dataset, article 11897187)        | 1129467424 | <https://ndownloader.figshare.com/files/22817429> | 02d159b107c9dd129744fc005e0f91d7 |

Mirror of the full archive: <https://www.vocaltractlab.de/dvtd.zip>. It has the same size (1129467424 B), `Last-Modified` 2020-08-07, and **supports `Accept-Ranges: bytes`**. I extracted single members from it with HTTP Range requests on the zip central directory, so a CI job can fetch one 0.3–2 MB STL without downloading 1.1 GB. The uncompressed total is 1951905259 B.

Caveat: the `vvtf-calculated.txt` inside `dvtd.zip` (317223 B for s1-01) is not the same file as the standalone figshare example (101708 B). The first is the full-resolution 0.961304 Hz grid with a `# freq_Hz magnitude phase_rad` header. The resonance peaks agree (see the table below).

**Inner-surface STL sizes inside dvtd.zip (bytes).** Speaker 2's meshes are 3–6 times smaller, which makes them the best candidates for test fixtures.

- s1: 01 2124134, 02 719834, 03 2092984, 04 831934, 05 2355834, 06 2026084, 07 2148584, 08 2363784, 09 2124534, 10 2091934, 11 2384984, 12 2100834, 13 2027084, 14 2120534, 15 2233184, 16 2043184, 17 2050734, 18 2232584, 19 1984334, 20 2187234, 21 1861734, 22 2023884.
- s2: 01 666584, 02 454134, 03 596334, 04 2011184, 05 1426734, 06 806434, 07 770934, 08 724534, 09 813634, 10 648884, 11 409034, 12 563134, 13 363234, 14 457084, 15 515534, 16 614734, 17 527434, 18 331984, 19 431834, 20 350034, 21 359534, 22 362434.
- The `-closed` variants are about 3.0 MB each (60000 triangles).

#### 1.1.2 Inferred mesh conventions (my measurements, not documented by the authors)

Measured with a small binary-STL parser on s1-01, s1-03 and s2-01:

- Binary STL with the header "Exported from Blender-2.78". Units are **millimetres** (s1-01 extent is 71.5 × 109.2 × 107.9 mm, which is anatomically plausible).
- s1-01 inner surface has 42481 triangles.
- Axes appear consistent: **+z is superior** (the glottis opening is the lowest point), **+y is anterior** (the lip opening is at maximum y), and x is left-right.
- **Origins differ between files.** Examples:
  - s1-01 has bbox [-29.0, -67.7, -100.6] to [42.5, 41.6, 7.4].
  - s2-01 has z running from 0 to 80.6.
  - s1-03 has y running from 17.7 to 128.9.
  - Tests must therefore normalise each mesh, for example by translating the glottis-cut centroid to the origin, and must not assume a shared frame.
- `-inner-surface.stl` is open at the glottis and lips. `-inner-surface-closed.stl` is capped, so it is watertight and suitable for inside/outside voxelisation of an FDTD grid.

**Resonance peaks from the VVTF files** (simple local-maximum picking below 5 kHz on the full-resolution files in `dvtd.zip`; my analysis). These are good regression targets for a voxeliser plus FDTD pipeline: voxelise `inner-surface-closed.stl`, excite at the glottis cut, and compare.

| Sound      | Calculated (FEM) peaks, Hz        | Measured (3D print) peaks, Hz     |
| ---------- | --------------------------------- | --------------------------------- |
| s1-01 /aː/ | 514, 1104, 2304, 3255, 3526, 4319 | 517, 1114, 2314, 3263, 3520, 4262 |
| s1-03 /iː/ | 192, 1793, 2611, 3161, 4175       | 187, 1803, 2615, 3183             |
| s1-05 /uː/ | 197, 661, …                       | 194, 655, …                       |
| s2-01 /aː/ | 758, 1392, 3149, 4063, 4434       | 751, 1414, 3153, …                |
| s2-03 /iː/ | 224, 2501, 3514, 4172, 4482       | 217, 2502, 3505, 4182             |
| s2-05 /uː/ | 333, 856, 3926, 4502, 4687        | 335, 869, 3945, 4667              |

Notes on reading the table:

- The lowest peak of /iː/ and /uː/ (about 190–330 Hz) is the first VVTF resonance under closed-glottis, rigid-wall conditions. It should not be confused with a speech F1 measured from audio.
- My peak picker also returned some spurious or split peaks in the measured data (e.g. 797 Hz for s1-01 measured, and a cluster around 3.47–3.52 kHz for s2-01). I removed these from the table, so treat the table as indicative. The paper's own resonance tables are authoritative.

#### 1.1.3 Suitability for this project

**Strengths:**

- The best available match. It has a CC0 licence, small individual files, watertight meshes, and FEM and measured transfer functions for exactly the "geometry → FDTD → resonances" test this simulator needs.
- It covers one male and one female speaker.

**Limitations:**

- German sounds only.
- No nasal cavity.
- No area functions. The 1D Kelly-Lochbaum path needs its own centreline and cross-section extraction from the STL; Section 7 lists meshing tools that can do this.
- Static (sustained) shapes only.

### 1.2 USC 75-Speaker Speech MRI Database (Lim et al. 2021)

**Paper.** Lim, Y. et al. "A multispeaker dataset of raw and reconstructed speech production real-time MRI video and 3D volumetric images." _Scientific Data_ 8, 187 (2021). doi:10.1038/s41597-021-00976-x. Full text: <https://pmc.ncbi.nlm.nih.gov/articles/PMC8292336/>. Project page: <https://sail.usc.edu/span/75speakers/>.

**Licence.** Data are **CC BY 4.0** (figshare article 13725546: <https://api.figshare.com/v2/articles/13725546>). The accompanying code is MIT (paper).

**Contents** (paper):

- 75 subjects (40 female, 35 male), aged 18–59.
- RT-MRI at 2.4 mm resolution and 83.28 fps.
- 3D volumetric scans of 33 sustained items (13 vowels, 14 consonants, 6 postures) at **1.5625 mm isotropic**, matrix 160 × 160 × 80, 7 s each, stored as MATLAB `.mat`.
- T2-weighted anatomical scans at 0.5859 mm in-plane resolution with 3 mm slices, in DICOM.

**Files** (figshare API; URLs have the form `https://ndownloader.figshare.com/files/<id>`):

| File                          | Bytes                       |
| ----------------------------- | --------------------------- |
| dataset.zip                   | 570679833692 (about 571 GB) |
| dataset_3d_only.zip           | 92592570427 (about 93 GB)   |
| dataset_2drt_video_only.zip   | 2552272426                  |
| dataset_t2w_only.zip          | 2484024876                  |
| example_for_sub001.zip        | 7365130376                  |
| metafile_public_20210129.json | 543035                      |
| Subjects.xlsx                 | 90278                       |
| Stimuli.pptx                  | 955087                      |

**Suitability.**

- The best source for many-speaker statistics, including female speakers.
- Far too large for tests, and volumes, not meshes, so segmentation is needed.
- The only small files are the metadata (`Subjects.xlsx`, `metafile_public_20210129.json`).

### 1.3 Aalto University Finnish vowel MRI ("DICOM, STL and sound")

- Landing page: <http://speech.math.aalto.fi/data.html>. Licence **CC BY-NC-SA 3.0** (stated on the page and in the included LICENSE file).
- **The NonCommercial clause makes it unsuitable for bundling** in a project that may be used commercially. Use it only as a private reference.
- `dixit-subject1-0.2.zip` (26093164 B) contains eight vowel surfaces `surface/vowel_{a,ae,e,i,o,oe,u,y}.stl` of 7.2–9.1 MB each, plus DICOM, WAV, README and LICENSE (central directory read by HTTP Range request).
- `dixit-subject2-0.1.zip` is 924906197 B.
- The speaker is a 30-year-old male.
- References: Aalto et al. 2014, _Applied Acoustics_, doi:10.1016/j.apacoust.2014.03.003; Palo et al. 2012 (listed on the same page).

### 1.4 Fleischer et al. 2022: vocal tract geometry for voice-efficiency study (Zenodo)

- Record: <https://zenodo.org/records/7228353>, **CC BY 4.0**.
- A single zip of 365.6 MB (md5 6b53652639d89b8fa903b856ca38b57b).
- It contains vocal tract STL files split into glottis, wall and lips, plus sub-volumes (epilaryngeal tube ET, hypopharynx HPl/HPu, oropharynx OPf/OPr, SP, VV) and FEniCS simulation scripts (record page).
- Suitability: useful for testing region-wise wall boundary conditions. It is too large for a unit-test fixture.

### 1.5 French real-time and 3D MRI (Isaieva et al. 2021)

- Paper: _Scientific Data_ 8, 258 (2021), doi:10.1038/s41597-021-01041-3, <https://pmc.ncbi.nlm.nih.gov/articles/PMC8486854/>.
- Data: figshare collection 5270387, **CC0**.
- Ten French speakers, RT-MRI at 20 ms per frame, plus static 3D MRI.
- There are ten per-speaker articles of about 2.48 GB each. Example: article 14822673, `P1.zip`, 2483633334 B (<https://api.figshare.com/v2/articles/14822673>).
- Suitability: CC0, but volumes only and large.

### 1.6 USC-TIMIT

- Landing page <https://sail.usc.edu/span/usc-timit/> states the corpus has been on Zenodo since May 2026: <https://zenodo.org/records/19422914>, **CC BY 4.0**.
- A single `USC-TIMIT.zip` of 8500806073 B.
- Contents: RT-MRI of 5 male and 5 female speakers, EMA for 4 of them, and 460 sentences (landing page).
- Suitability: dynamic articulation data for learning control (see Section 4). No 3D meshes.

### 1.7 mngu0

- <https://homepages.inf.ed.ac.uk/korin/site/research/mngu0/>.
- Requires registration by email. Described as "free for research use", with no named licence.
- A single male speaker with EMA, MRI and audio. The MRI subset is described in Steiner et al. 2012, JASA (cited on the page).
- Not usable as a redistributable fixture.

### 1.8 ATR MRI database of Japanese vowel production

- Distributed commercially through ATR-Promotions, with no public download.
- Sources: Kitamura et al., _Acoust. Sci. & Tech._ 30(4), 2009, <https://www.jstage.jst.go.jp/article/ast/30/4/30_4_288/_article>; Hatano et al., Interspeech 2012, <https://www.isca-archive.org/interspeech_2012/hatano12_interspeech.html>.
- Not usable here.

### 1.9 KTH / EUNISON geometries

- The 3D vocal tract geometries used in the EUNISON FEM work have no public download that I could find. One example is the diphthong study by Arnela et al., _IEEE/ACM TASLP_ 2019, doi:10.1109/TASLP.2019.2942439.
- Uncertain: they may be available from the authors on request.

### 1.10 Area-function tables (1D)

**Story 2008.** Story, B. H. "Comparison of magnetic resonance imaging-based vocal tract area functions obtained from the same speaker in 1994 and 2002." _JASA_ 123(1), 327–335. doi:10.1121/1.2805683. NIH manuscript: <https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/>.

- One adult male (37 y in 2002), the same speaker as Story, Titze & Hoffman 1996 (doi:10.1121/1.415960, 18 shapes).
- Table I gives **44 cross-sectional areas per vowel for 11 American-English vowels**, each with its own section length Δ (e.g. /i/ 0.384 cm, /ɑ/ 0.388 cm, /u/ 0.445 cm).
- Vocal tract lengths from that paper (cm):

  | Vowel    | i     | ɪ     | e     | ɛ     | æ     | ʌ     | ɑ     | ɔ     | o     | ʊ     | u     |
  | -------- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- |
  | VTL (cm) | 16.90 | 16.55 | 16.98 | 17.30 | 16.11 | 17.14 | 17.09 | 17.40 | 18.33 | 19.34 | 19.59 |

- Natural-speech formants from Table II (F1/F2/F3, Hz):

  | Vowel | F1  | F2   | F3   |
  | ----- | --- | ---- | ---- |
  | i     | 295 | 1923 | 2797 |
  | æ     | 765 | 1724 | 2501 |
  | ɑ     | 715 | 1180 | 2691 |
  | u     | 430 | 917  | 2087 |

- **Uncertainty:** I read the area values through an automated page extraction. Re-transcribe them by hand from the PMC table before using them as test vectors. Some leading /æ/ values looked doubtful.
- A female speaker's area functions: Story 1998, doi:10.1121/1.423298 (abstract only checked).
- Related NIH manuscripts: <https://pmc.ncbi.nlm.nih.gov/articles/PMC2677276/>, <https://pmc.ncbi.nlm.nih.gov/articles/PMC2677261/>.
- Area functions are numeric facts, but the published tables are copyrighted presentations. Cite the paper when deriving test vectors.

### 1.11 VocalTractLab speaker files (GPL-3.0: reference only)

- VocalTractLab became open source under the GNU GPL with version 2.3 ("Since version 2.3, VTL is open source under the GNU General Public License", <https://www.vocaltractlab.de/index.php?page=vocaltractlab-download>). Current downloads are VTL2.4.zip (5 Dec 2025) and VTL3D_1.0.2.zip (29 Sep 2022), from the same page.
- GitHub: <https://github.com/TUD-STKS/VocalTractLabBackend-dev> and <https://github.com/TUD-STKS/VocalTractLab-dev>. GitHub's API reports **GPL-3.0** for both.
- The speaker file `JD3.speaker` (91067 B) is at <https://raw.githubusercontent.com/TUD-STKS/VocalTractLabBackend-dev/main/resources/JD3.speaker>.
  - It is XML with an anatomy section (palate points p0–p8, jaw, lips, tongue, velum, pharynx, larynx) and 94 named shapes (SAMPA vowels plus consonants in vowel contexts), together with glottis model parameters.
  - Values found in the file:

    | Parameter                     | Value                           |
    | ----------------------------- | ------------------------------- |
    | Piriform fossa                | length 2.5 cm, volume 1.5 cm³   |
    | Subglottal cavity length      | 23 cm                           |
    | Nasal cavity length           | 11.4 cm                         |
    | Maximum nasal port area       | 2.0 cm²                         |
    | Uvula width/height/depth      | 0.7/0.9/0.7 cm                  |
    | Epiglottis width/height/depth | 0.5/1.6/1.4                     |
    | Tongue body radius            | 1.8 cm                          |
    | Hyoid vertical range          | -6.0 to -3.5 cm (neutral -4.75) |
    | Pharynx upper/lower depth     | 3.8/3.4                         |

- **Because the files are GPL-3.0, do not copy shapes or parameters into a non-GPL code base.** Use them only to check plausibility, and cite them.
- The older 2.1b API package ships `JD2.speaker` and an experimental 1-year-old child speaker (download page). Licence of that older package: uncertain.

### 1.12 General anatomy models and images

**BodyParts3D** (DBCLS, Japan).

- Licence page <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html> (updated 2025-02-27) now says **CC BY 4.0**, with the required credit "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International".
- Older README files said CC BY-SA 2.1 JP. Follow the current page and record the date.
- Download page: <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>. Example file: <https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip> (142903898 B, OBJ meshes).
- Suitability: good low-poly sources for the jaw, teeth, tongue, hyoid and larynx cartilages used in visualisation. It contains no airway lumen geometry for acoustics.

**Z-Anatomy.**

- <https://github.com/Z-Anatomy/Models-of-human-anatomy>. The README states **CC BY-SA 4.0**; the GitHub API reports `NOASSERTION`.
- `Z-Anatomy.zip` is 86734957 B: a Blender template derived from BodyParts3D.
- ShareAlike would apply to derived meshes.

**Visible Human Project (NLM).**

- <https://www.nlm.nih.gov/research/visible/getting_data.html>: "As of July 2019, the NLM Data License has been replaced by Terms and Conditions". No registration is needed.
- Terms: <https://www.nlm.nih.gov/databases/download/terms_and_conditions.html>. Credit "Courtesy of the U.S. National Library of Medicine" and do not imply endorsement. Public-domain status is not stated, so it is uncertain.
- Male dataset: 1.0 mm slices, 0.33 mm pixels, 1871 slices. The female dataset uses 0.33 mm slices and is about 40 GB (same page).
- Additional head (72-year-old male): <https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/>.
  - Cryosection TIFFs: 1477 slices at 0.147 mm, 1056 × 1528 px. MRI (PD/T1/T2) and CT are also included.
  - Sagittal JPEG reconstructions (836 files), e.g. `cryo/jpeg/fullSize/sagittal/0500.01.jpg` (240396 B). Quarter-size versions are about 21 KB, e.g. `cryo/jpeg/quarterSize/sagittal/0130.04.jpg`.
  - A useful mid-sagittal reference for drawing a 2D tract outline.

**Gray's Anatomy (1918) figures on Wikimedia Commons,** all tagged Public domain on their file pages:

| Figure   | Content                                                                                                                           | Direct URL                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Gray994  | "Sagittal section of nose, mouth, pharynx, and larynx", 600 × 861 px, 114871 B. **The canonical mid-sagittal vocal tract figure** | <https://upload.wikimedia.org/wikipedia/commons/7/7c/Gray994.png>  |
| Gray953  | sagittal larynx and trachea                                                                                                       | <https://upload.wikimedia.org/wikipedia/commons/b/ba/Gray953.png>  |
| Gray954  | coronal larynx                                                                                                                    | <https://upload.wikimedia.org/wikipedia/commons/8/81/Gray954.png>  |
| Gray955  | entrance to larynx from behind                                                                                                    | <https://upload.wikimedia.org/wikipedia/commons/6/62/Gray955.png>  |
| Gray1014 | mouth cavity                                                                                                                      | <https://upload.wikimedia.org/wikipedia/commons/6/6e/Gray1014.png> |
| Gray1019 | extrinsic tongue muscles                                                                                                          | <https://upload.wikimedia.org/wikipedia/commons/c/c6/Gray1019.png> |
| Gray1020 | coronal tongue                                                                                                                    | <https://upload.wikimedia.org/wikipedia/commons/d/d8/Gray1020.png> |
| Gray1028 | palate muscles from behind                                                                                                        | <https://upload.wikimedia.org/wikipedia/commons/c/c7/Gray1028.png> |
| Gray1003 | permanent teeth                                                                                                                   | <https://upload.wikimedia.org/wikipedia/commons/6/6c/Gray1003.png> |
| Gray855  | lateral wall of nasal cavity                                                                                                      | <https://upload.wikimedia.org/wikipedia/commons/8/87/Gray855.png>  |

Note: Gray1046 is _not_ a vocal tract figure (it shows the stomach).

### 1.13 Summary: which dataset for which purpose

| Purpose                                   | Recommended source                                                                                                          | Licence                  | Size             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------- |
| Unit-test mesh fixture (3D FDTD)          | DVTD s2 inner-surface(-closed) STL, e.g. s2-18 (331984 B) or s2-13 (363234 B); or s1-01 via figshare file 22708202/22708205 | CC0                      | 0.3–3 MB         |
| Resonance regression targets              | DVTD `vvtf-calculated.txt` / `vvtf-measured.txt`                                                                            | CC0                      | 0.1–0.4 MB       |
| Male vs female geometry comparison        | DVTD s1 vs s2                                                                                                               | CC0                      | as above         |
| 1D area-function test vectors             | Story 2008 Table I (re-transcribe)                                                                                          | paper; cite              | n/a              |
| Many-speaker statistics                   | USC 75-speaker                                                                                                              | CC BY 4.0                | 2.5 GB to 571 GB |
| Visualisation meshes (jaw, teeth, larynx) | BodyParts3D                                                                                                                 | CC BY 4.0                | 143 MB           |
| 2D outline reference                      | Gray994                                                                                                                     | Public domain            | 115 KB           |
| Plausibility checks                       | VTL JD3.speaker                                                                                                             | GPL-3.0 (reference only) | 91 KB            |
