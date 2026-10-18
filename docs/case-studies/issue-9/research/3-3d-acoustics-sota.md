## 3. State of the art of 3D acoustic simulation of the vocal tract

_Method note: numbers below are quoted only from pages or PDFs I actually fetched. Where I read only an abstract or a bibliographic record, the text says "(abstract)". Items marked "unverified" or "not found" are open questions, not facts._

### 3.1 Where 1D stops being enough

- **Above about 4–5 kHz, geometry matters.** Arnela, Dabbaghchian, Blandin, Guasch, Engwall, Van Hirtum & Pelorson (JASA 140(3):1707–1718, 2016) compared six simplified geometries for [ɑ], [i] and [u]. They combined realistic, elliptical and circular cross-sections with bent or straight midlines. Below about 4–5 kHz, bending and cross-section shape have only a weak effect. Above that, bent tracts with realistic cross-sections are needed to reproduce higher-order mode propagation. They used FEM, cross-checked against a 3D multimodal method and a 1D frequency-domain model (abstract; [doi:10.1121/1.4962488](https://pubs.aip.org/asa/jasa/article/140/3/1707/915950)).
- **Lips matter even below 4 kHz.** Arnela et al. (JASA 139(5), 2016) used time-domain FEM and 3D-printed replicas of MRI-derived tracts. They found lips should be modelled even below 4 kHz, not only at high frequencies (abstract via [URL repository](https://dau.url.edu/handle/20.500.14342/5728); DOI 10.1121/1.4950698).
- **Side cavities: piriform fossae dominate.** Takemoto, Mokhtari & Kitamura (JASA 128(6):3724–3738, 2010; [doi:10.1121/1.3502470](https://pubs.aip.org/asa/jasa/article/128/6/3724/917617)) ran 3D FDTD on MRI-based tracts of five Japanese vowels (abstract):
  - FDTD transfer functions agreed with measurements on physical replicas up to about 10 kHz.
  - Piriform fossae, epiglottic valleculae and inter-dental spaces all cause spectral dips.
  - The piriform fossae cause the largest change, and their dip frequencies are nearly stable across vowels.
  - The valleculae have a nearly negligible effect, and their dips vary by vowel.
  - Inter-dental spaces give very small dips below 2.5 kHz for high and mid vowels.
  - Transverse oral resonances give small dips above 4 kHz for low vowels.
- **Takemoto's grid.** Mohapatra et al. (2022) report that Takemoto's model ran at 1000 kHz with a fourth-order spatial stencil ([PDF](https://www.vocaltractlab.de/publications/mohapatra-2022-interspeech.pdf)). The 2010 voxel size itself is **unverified**: I could not open the full text.
- **Validity of 1D for one subject.** Takemoto et al. (Interspeech 2014) found 1D and 3D transfer functions agree up to about 7 kHz when the piriform fossae are included, ignoring small dips. A deep dip near 8 kHz from a transverse pharyngeal mode marks the 1D limit for that subject ([ISCA](https://www.isca-archive.org/interspeech_2014/takemoto14_interspeech.html)). Their 3D run used a Gaussian pulse response simulated over 50 ms ([PDF](https://www.isca-archive.org/interspeech_2014/takemoto14_interspeech.pdf)).
- **The VocalTractLab3D guide's summary of the same picture** ([user guide](https://www.vocaltractlab.de/download-vocaltractlab/user_guide_vtl3d.pdf)):
  - 3D effects are "rather limited up to about 3 kHz".
  - From 3 kHz on they become more substantial.
  - Above 4–5 kHz, transverse resonances add zeros and extra peaks.

### 3.2 Method families

**FEM (Arnela, Guasch et al.)**

- **Impedance computation (2013).** Arnela & Guasch adapted the two-microphone transfer-function method to FEM to get radiation and input impedances of elliptical-section tracts. Note the publication year is 2013 (JASA 133(6):4197–4209), not 2014. Placing the virtual microphones appropriately partly extends the method past the plane-wave limit ([arXiv:1302.4382](https://arxiv.org/abs/1302.4382)).
- **Diphthongs.** Later work synthesised [ɑi] and [ɑu] with a dynamic 3D FEM. The tract is built by interpolating MRI cross-sections (Arnela, Dabbaghchian, Guasch, Engwall, IEEE/ACM TASLP 27(12), 2019, doi:10.1109/TASLP.2019.2942439; abstract via [La Salle](https://blogs.salleurl.edu/en/node/19198)).
- **Cost.** FEM is very expensive. Gully et al. (2018) note that the vocal tract models of Arnela et al. (2016, lips paper) "require 70–80 hours of computation time for 20 ms of output" ([accepted PDF](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)).

**Czech FEM (Vampola, Horáček, Švec)**

- 1D vs 3D FE models of the Czech vowel /a/ (Vampola & Horáček 2005).
- MRI-to-FE-mesh models (Dedouch et al. 2001).
- Coupled vocal-fold + vocal-tract FE models (Švancara et al. 2011; Hájek et al. 2020).
- I only saw listings for these, so they are cited as abstracts ([search listing, Engineering Mechanics 2005](https://engmechx.it.cas.cz/im/proceedings/show_p/2005/325); [MAVEBA 2001](https://www.isca-archive.org/maveba_2001/dedouch01_maveba.html)). No grid or timing numbers were verified.

**FDTD (Takemoto; Mohapatra/Fels/Birkholz)**

- **Mohapatra, Fleischer, Zappi, Birkholz & Fels (Interspeech 2022)** ([PDF](https://www.vocaltractlab.de/publications/mohapatra-2022-interspeech.pdf)):
  - Staggered-grid 3D FDTD with a second-order stencil.
  - Δs ≈ 0.92 mm, described as "the largest value that preserves the geometrical details", found empirically.
  - Time step set by the CFL condition Δt ≤ Δs/(√3c), so Δt = 1.51 µs, i.e. fs = 661.5 kHz.
  - Compared against 3D FEM with Δs = 3 mm and Δt = 0.005 ms.
  - Formants matched FEM for most vowels. The worst errors were for /u/ and /o/, attributed to narrow lip constrictions on the orthogonal grid.
  - Code: [Debasishray19/fdtd-vocaltract-model](https://github.com/Debasishray19/fdtd-vocaltract-model) (MIT, per GitHub API).
- **2.5D FDTD.** This variant adds tube depth from the area function to a 2D solver (Mohapatra, Zappi, Fels, Interspeech 2019, [arXiv:1909.09585](https://arxiv.org/pdf/1909.09585); comparison study [arXiv:2102.04588](https://arxiv.org/abs/2102.04588), abstract). At low resolution its output is comparable to 2D FDTD and to 3D FEM. Code: [VocalSim-2p5D-FDTD](https://github.com/Debasishray19) (MIT, per GitHub API).

**Digital waveguide mesh (York: Mullen, Speed, Gully, Murphy, Howard)**

- **2D DWM (Mullen, Howard & Murphy, IEEE TASLP 15(2):577–585, 2007).** Introduced real-time dynamic articulation in a 2D mesh, via widthwise mapping and later impedance mapping (abstract; [White Rose](https://eprints.whiterose.ac.uk/id/eprint/3710/)).
- **3D DWM, simple shapes (Speed, Murphy & Howard, IEEE TASLP 21(2):449–455, 2013).** Cylindrical tract analogues were reproduced up to 10 kHz with small errors. Accuracy fell for more complex shapes (abstract; [Royal Holloway](https://pure.royalholloway.ac.uk/en/publications/three-dimensional-digital-waveguide-mesh-simulation-of-cylindrica)).
- **3D DWM, MRI geometries (Speed et al., TASLP 22(2):453–464, 2014).** Doi 10.1109/TASLP.2013.2294579 ([record](https://pure.royalholloway.ac.uk/en/publications/modeling-the-vocal-tract-transfer-function-using-a-3d-digital-wav)).
- **Speed's PhD thesis** ([PDF](https://etheses.whiterose.ac.uk/id/eprint/2800/1/Speed_Thesis_Corrected.pdf)):
  - A cuboid benchmark at 960 kHz used a 0.614 mm spatial step, 882,245 air nodes and 8000 steps, taking about 30 min.
  - The thesis estimates that a dense grid of about 4.3×10⁹ nodes at 192 kHz would take about 920 h per simulated second on a CPU.
- **Dynamic 3D DWM for diphthongs (Gully, Daffern & Murphy, IEEE/ACM TASLP 26(2):243–255, 2018)** ([PDF](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)):
  - Impedance-mapped 3D DWM.
  - MRI resampled from 2 mm isotropic images.
  - fs = 400 kHz, about 1.52 mm spacing. The authors show 192 kHz grids are still too sparse.
  - Simulated band 0–20 kHz.
  - A serial MATLAB run takes about 13 h per second of audio. Parallel MATLAB on an NVIDIA 1070 GPU takes about 3 h per second.

**Multimodal method / VocalTractLab3D (Blandin, Birkholz et al.)**

- **Interspeech 2021 comparison** ([PDF](https://vocaltractlab.de/publications/blandin-2021-interspeech.pdf)):
  - FEM used tetrahedra of about 3 mm, Δt = 2×10⁻⁶ s, and a 50 ms run.
  - FEM took about 30 h on an i7-6700. A truncated-domain FEM took about 10 h for 1000 frequencies.
  - The multimodal method took on average 40 min for 1000 frequencies on a Xeon W-2145.
  - VocalTractLab's transmission-line model (TLM) runs in real time.
  - Mean resonance error relative to FEM was about 2% for TLM and 1.2% for the multimodal method, over the first four resonances.
- **IEEE Access 10:69922–69938 (2022).** Note this paper is in IEEE Access, not JASA. It combines the multimodal method with 2D FEM for transverse modes, so it handles curvature. It reaches about 1% resonance-frequency difference from full FEM at about one-tenth of the cost (abstract; [URL record](https://merit.url.edu/en/publications/efficient-3d-acoustic-simulation-of-the-vocal-tract-by-combining--4/)).
- **VocalTractLab3D 1.0.2** ([guide](https://www.vocaltractlab.de/download-vocaltractlab/user_guide_vtl3d.pdf)):
  - Frequency domain only.
  - Accurate defaults take "of the order of one hour" per 1000-frequency transfer function. Fast defaults take a few minutes but are "inaccurate".
  - It cannot model lip shape, piriform/nasal branches, head diffraction, or time-domain synthesis.

**Real-time GPU attempts (2D only)**

- Zappi, Vasudevan, Allen, Raghuvanshi & Fels (171st ASA meeting / POMA, doi:10.1121/2.0000395). Their GPU (OpenGL) 2D FDTD runs in real time "under specific conditions", with compute times "comparable with those from 1D systems". They also state that detailed 3D models need "several minutes to synthesize a few milliseconds" ([MSR page](https://www.microsoft.com/en-us/research/?p=546369), abstract). Some listings date it 2016 in JASA; the sources disagree on the year.
- **No published real-time 3D vocal-tract solver, and no WebGL/WebGPU vocal-tract FDTD demo, turned up in my searches** ([searches summarised; e.g. MSR](https://www.microsoft.com/en-us/research/?p=546369)). This is a negative finding, not proof that none exists.

**Validation data and measurement**

- **Dresden Vocal Tract Dataset** (Birkholz, Kürbis, Stone, Häsner, Blandin, Fleischer, _Sci. Data_ 7:255, 2020) ([PMC7406497](https://pmc.ncbi.nlm.nih.gov/articles/PMC7406497/)):
  - 44 MRI tract shapes: 22 sounds × 2 speakers.
  - FEniCS Helmholtz FEM with maximum mean element size 2.99 mm, 0–10 kHz, about 11 elements per wavelength at 10 kHz.
  - Up to 9 h per model on 12 cores of a Xeon Gold 6148.
  - Licence: the article is CC BY 4.0; every data item on figshare is **CC0** ([figshare API](https://api.figshare.com/v2/articles/11897187)); data on figshare and [vocaltractlab.de/dvtd.zip](https://www.vocaltractlab.de/dvtd.zip). See Section 1.1.
- **Measuring printed tracts.** Fleischer, Mainka, Kürbis & Birkholz (PLoS ONE 13(3):e0193708, 2018) show how to obtain the exact volume-velocity transfer function of 3D-printed tracts by external excitation at the lips (abstract; [PMC5854283](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5854283/)).

**Differentiable 1D (recent)**

- Chen, Lee & Sitzmann (NeurIPS 2026 poster) present a frequency-domain tube simulator. They describe it as "70x more GPU-parallelizable" than time-domain finite differences, and use it to invert speech back to vocal tract geometry ([NeurIPS](https://neurips.cc/virtual/2026/poster/151084), abstract).

### 3.3 Solver comparison table

| Work                      | Method                                           | Spatial step                     | fs / Δt                               | Reported compute                              | Band                            | Source                                                                                                                                                 |
| ------------------------- | ------------------------------------------------ | -------------------------------- | ------------------------------------- | --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Takemoto et al. 2010      | 3D FDTD, MRI voxels, 4th-order                   | unverified                       | 1000 kHz (as cited by Mohapatra 2022) | not found                                     | agrees with replicas to ~10 kHz | [JASA](https://pubs.aip.org/asa/jasa/article/128/6/3724/917617), [Mohapatra](https://www.vocaltractlab.de/publications/mohapatra-2022-interspeech.pdf) |
| Mohapatra et al. 2022     | 3D FDTD (staggered, 2nd-order), simplified tubes | ≈0.92 mm                         | 661.5 kHz                             | not stated                                    | VTTFs to ~10 kHz (plots)        | [PDF](https://www.vocaltractlab.de/publications/mohapatra-2022-interspeech.pdf)                                                                        |
| Same paper, reference     | 3D FEM                                           | 3 mm                             | Δt = 5 µs (200 kHz)                   | not stated                                    | —                               | same                                                                                                                                                   |
| Blandin et al. 2021       | 3D FEM, time domain                              | ~3 mm inside, 4–5 mm outside     | Δt = 2 µs (500 kHz)                   | ~30 h per 50 ms (i7-6700)                     | to 10 kHz, 1 Hz resolution      | [PDF](https://vocaltractlab.de/publications/blandin-2021-interspeech.pdf)                                                                              |
| Same paper                | Multimodal method                                | ~1.2 mm average                  | frequency domain                      | ~40 min per 1000 freqs (Xeon W-2145)          | to 10 kHz                       | same                                                                                                                                                   |
| Same paper                | 1D TLM (VTL)                                     | —                                | —                                     | real time                                     | first 4 resonances valid        | same                                                                                                                                                   |
| Blandin et al. 2022       | Multimodal + 2D FEM                              | —                                | frequency domain                      | ~10× cheaper than FEM at ~1% error (abstract) | —                               | [record](https://merit.url.edu/en/publications/efficient-3d-acoustic-simulation-of-the-vocal-tract-by-combining--4/)                                   |
| VTL3D 1.0.2               | Multimodal                                       | —                                | frequency domain                      | ~1 h per 1000 freqs (accurate preset)         | —                               | [guide](https://www.vocaltractlab.de/download-vocaltractlab/user_guide_vtl3d.pdf)                                                                      |
| Arnela et al. 2016 (lips) | 3D time-domain FEM                               | not seen                         | not seen                              | 70–80 h per 20 ms (as cited by Gully 2018)    | —                               | [Gully PDF](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)                                                                               |
| Gully et al. 2018         | Dynamic 3D DWM                                   | ≈1.52 mm                         | 400 kHz                               | ~13 h/s serial MATLAB; ~3 h/s on GTX 1070     | 0–20 kHz                        | same                                                                                                                                                   |
| Speed thesis              | 3D DWM (cuboid benchmark)                        | 0.614 mm                         | 960 kHz                               | ~30 min for 8000 steps                        | —                               | [thesis](https://etheses.whiterose.ac.uk/id/eprint/2800/1/Speed_Thesis_Corrected.pdf)                                                                  |
| DVTD 2020                 | FEM Helmholtz (FEniCS)                           | ≤2.99 mm mean                    | frequency domain, 0.96 Hz steps       | ≤9 h per model (12 cores)                     | 0–10 kHz                        | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7406497/)                                                                                               |
| Zappi et al. 2017         | 2D FDTD on GPU                                   | 3 resolutions (values not given) | not given                             | real time "under specific conditions"         | —                               | [MSR](https://www.microsoft.com/en-us/research/?p=546369)                                                                                              |

The pattern across published 3D time-domain work: grids of about 0.6–1.5 mm, sample rates of 400–1000 kHz, and run times from hours per second of audio (DWM on a GPU) to tens of hours per 50 ms (FEM).

A derived figure, not quoted from any paper: with the CFL limit used by Mohapatra et al. and c = 350 m/s, a 2 mm grid needs fs ≥ about 303 kHz, and a 1 mm grid needs about 606 kHz. Real-time 3D in a browser therefore means heavy oversampling relative to 44.1/48 kHz output.

### 3.4 Open-source and competing projects (licences checked)

| Project                                                             | What it is                                                                         | Licence (as checked)                                                                                                                                                                 | Source                                                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| VocalTractLab 2.3 / 2.4                                             | 3D articulatory geometry + 1D TLM synthesiser                                      | GPL ("open source under the GNU General Public License" since 2.3)                                                                                                                   | [download page](https://www.vocaltractlab.de/index.php?page=vocaltractlab-download)                                                              |
| TUD-STKS/VocalTractLab-dev, VocalTractLabBackend-dev                | Development repo and C/C++ API                                                     | GPL-3.0 (GitHub API)                                                                                                                                                                 | [repo](https://github.com/TUD-STKS/VocalTractLab-dev), [backend](https://github.com/TUD-STKS/VocalTractLabBackend-dev)                           |
| VocalTractLab-Python (`vocaltractlab` on PyPI)                      | Python text-to-speech wrapper                                                      | GPL-3.0                                                                                                                                                                              | [repo](https://github.com/paul-krug/VocalTractLab-Python)                                                                                        |
| VocalTractLab3D 1.0.2                                               | Multimodal 3D acoustics GUI (C++, Windows/Linux)                                   | GPL, per user guide; ZIP download, no GitHub repo found                                                                                                                              | [guide](https://www.vocaltractlab.de/download-vocaltractlab/user_guide_vtl3d.pdf)                                                                |
| Pink Trombone (Neil Thapen, v1.1, 2017)                             | Browser JS, 1D Kelly-Lochbaum style tract                                          | MIT (header in page source: "Copyright 2017 Neil Thapen" + MIT text). Note the forks differ: zakaton/Pink-Trombone is GPL-3.0; chdh/pink-trombone-mod and evykassirer mirror are MIT | [dood.al](https://dood.al/pinktrombone/), [zakaton](https://github.com/zakaton/Pink-Trombone), [chdh](https://github.com/chdh/pink-trombone-mod) |
| Praat articulatory synthesis (Boersma 1998)                         | Muscle-driven articulatory synthesiser                                             | Source GPL v2+ or v3+; the whole of Praat is GPL v3+                                                                                                                                 | [README](https://github.com/praat/praat.github.io), [manual](https://www.praat.org/manual/Articulatory_synthesis.html)                           |
| gnuspeech                                                           | Tube resonance (waveguide) model, Hill / Manzara, Distinctive Region Model control | GPL v3 or later                                                                                                                                                                      | [Savannah](https://savannah.gnu.org/projects/gnuspeech), [gnu.org](https://www.gnu.org/software/gnuspeech/)                                      |
| Maeda VTCALCS (MATLAB port, BU Guenther Lab); UCL VTDemo            | Maeda articulatory model                                                           | **Licence not found**; the BU page returned HTTP 502 when fetched                                                                                                                    | [BU](https://sites.bu.edu/guentherlab/software/vtcalcs-for-matlab/), [VTDemo](https://www.phon.ucl.ac.uk/resource/vtdemo)                        |
| ArtiSynth                                                           | Biomechanical modelling (Java)                                                     | BSD-2-Clause (LICENSE file)                                                                                                                                                          | [repo](https://github.com/artisynth/artisynth_core)                                                                                              |
| fdtd-vocaltract-model; VocalSim-2p5D-FDTD; sound-stream (Mohapatra) | 3D FDTD / 2.5D FDTD (MATLAB) and real-time control interface                       | MIT                                                                                                                                                                                  | [GitHub](https://github.com/Debasishray19/fdtd-vocaltract-model)                                                                                 |
| k-Wave / k-wave-python                                              | Pseudospectral acoustic toolbox, GPU binaries                                      | LGPL-3.0                                                                                                                                                                             | [k-Wave](https://github.com/ucl-bug/k-wave), [k-wave-python](https://github.com/waltsims/k-wave-python)                                          |
| DVTD                                                                | MRI tract meshes + FEM transfer functions                                          | Data CC0 on figshare ([API](https://api.figshare.com/v2/articles/11897187)); article CC BY 4.0; scripts repo has no SPDX licence detected                                            | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7406497/), [GitHub](https://github.com/TUD-STKS/DVTD)                                             |
| York 3DVTTF data (Speed)                                            | MRI, impulse responses, EGG (192 kHz WAV)                                          | No licence stated, only "© 2012 Matt Speed"                                                                                                                                          | [site](https://www-users.york.ac.uk/~dtm3/3DVTTF/egg_data.html)                                                                                  |

**Not checked or not found:** a separate "JASON" project, a public "Dynamic Vocal Tract" software release by Arai, and Kröger's synthesiser licence. I did not verify any of these, so treat them as unknown.

### 3.5 Takeaways for this project

1. **What a 3D solver buys, relative to 1D Kelly-Lochbaum.** Mainly spectrum above about 4–5 kHz: realistic cross-sections, bending, piriform fossae and lips ([Arnela 2016](https://pubs.aip.org/asa/jasa/article/140/3/1707/915950), [Takemoto 2010](https://pubs.aip.org/asa/jasa/article/128/6/3724/917617)). Lips matter even below 4 kHz ([lips paper](https://dau.url.edu/handle/20.500.14342/5728)).
2. **Coarse voxels distort formants.** Published voxel FDTD and DWM work needed about 0.6–1.5 mm grids. Narrow constrictions (/u/, /o/) are where coarse grids fail first ([Mohapatra 2022](https://www.vocaltractlab.de/publications/mohapatra-2022-interspeech.pdf), [Gully 2018](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)). A browser solver with coarser voxels should expect formant shifts, and could correct for them with impedance mapping as Gully et al. did.
3. **Real time is open territory.** No surveyed 3D solver is real time. The fastest dynamic 3D result found is about 3 h of GPU time per second of audio ([Gully 2018](https://eprints.whiterose.ac.uk/126358/1/paper_accepted.pdf)). The realistic options are either offline 3D rendering, or a 1D/2D/2.5D real-time path validated against 3D references such as DVTD or VTL3D.
4. **Licence fit.** Reusing code from VocalTractLab, VTL3D, gnuspeech, Praat or the zakaton Pink Trombone fork would impose GPL obligations. The original Pink Trombone, the Mohapatra FDTD code, and ArtiSynth are permissive (MIT / BSD-2). k-Wave is LGPL-3.0, and the DVTD data is CC0 on figshare (Section 1.1).
