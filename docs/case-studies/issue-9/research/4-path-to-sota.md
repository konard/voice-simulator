## 4. Beating neural TTS / path to SOTA

Scope note: every number below appeared on a page I fetched. Where I only saw an abstract, metadata, or a search snippet, I say so. "Not verified" means I could not confirm the claim.

### 4.1 Where neural TTS stands (the bar to beat)

| System                                        | Size / data                                                                   | Reported metrics (test set)                                                                                                                | Source                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NaturalSpeech 3 (Microsoft)                   | 1B params, 200K h                                                             | LibriSpeech test-clean: WER 1.81, Sim-O 0.67, UTMOS 4.30, SMOS 4.01, CMOS 0.00 (reference). Ground truth: WER 1.94, UTMOS 4.14, CMOS +0.08 | [arXiv:2403.03100](https://arxiv.org/html/2403.03100v3)                                                                                                                                      |
| VALL-E (reproduced, as reported in NS3 paper) | trained on 60K h ([arXiv:2301.02111](https://arxiv.org/abs/2301.02111))       | WER 6.11, Sim-O 0.47, UTMOS 3.68, CMOS -0.60                                                                                               | [arXiv:2403.03100](https://arxiv.org/html/2403.03100v3)                                                                                                                                      |
| StyleTTS 2 (as reported in NS3 paper)         | n/a                                                                           | WER 2.49, UTMOS 3.94, CMOS -0.21                                                                                                           | [arXiv:2403.03100](https://arxiv.org/html/2403.03100v3)                                                                                                                                      |
| F5-TTS (32 NFE)                               | 336M, 100K h                                                                  | LibriSpeech-PC test-clean: WER 2.42, SIM-o 0.66, UTMOS 3.90, RTF 0.31 (RTX 3090). Ground truth: WER 2.23, UTMOS 4.09                       | [arXiv:2410.06885](https://arxiv.org/html/2410.06885)                                                                                                                                        |
| Kokoro-82M                                    | 82M, "a few hundred hours", Apache-2.0 weights, StyleTTS 2 + ISTFTNet, 24 kHz | No MOS/UTMOS numbers on the model card. EVAL.md only has leaderboard screenshots                                                           | [HF model card](https://huggingface.co/hexgrad/Kokoro-82M), [EVAL.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/EVAL.md)                                                           |
| Piper                                         | VITS-based voices exported to ONNX; espeak-ng phonemizer                      | No metrics found. The original repo is archived and MIT; development moved to a GPL-3.0 repo                                               | [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl), [training doc](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/TRAINING.md), [rhasspy/piper](https://github.com/rhasspy/piper) |

Licence caveat: F5-TTS code is MIT, but its pre-trained models are CC-BY-NC because they were trained on Emilia ([F5-TTS README](https://github.com/SWivid/F5-TTS)).

What matters most for this project is that **Kokoro already runs 100% locally in the browser** via `kokoro-js`/Transformers.js, on WASM or WebGPU with q8/q4 quantisation ([kokoro.js README](https://github.com/hexgrad/kokoro/tree/main/kokoro.js)). So the in-browser bar is not "neural TTS needs a server". A browser-native neural model of fewer than 100M parameters is the realistic competitor.

Large-model scores are now at or above the recordings on automatic metrics: NS3's UTMOS is 0.16 above ground truth ([arXiv:2403.03100](https://arxiv.org/html/2403.03100v3)). A physics simulator will not beat that on naturalness in the near term. Its realistic edge is interpretability, controllability and size.

### 4.2 Where articulatory / physical synthesis stands

**Classic rule-driven articulatory TTS (VocalTractLab).** Krug, Stone and Birkholz compared VTL's German phoneme-to-speech against neural, concatenative, HMM, unit-selection and diphone systems. Intelligibility was measured by ASR and naturalness was rated by 50 listeners. VTL was "on par" with non-commercial systems but "clearly outperformed" by the commercial ones ([SSW 2021, doi:10.21437/SSW.2021-18](https://www.isca-archive.org/ssw_2021/krug21_ssw.html)). The abstract page gives no numbers. This is the closest published analogue to this project's current pipeline.

**Learned control of a physical synthesizer (Birkholz group).**

- Gao, Birkholz and Li train CRNNs on VTL-generated articulatory/acoustic pairs to invert real speech into VTL control trajectories ([IEEE/ACM TASLP 32:1845-1858, 2024, doi:10.1109/TASLP.2024.3372874](<https://fis.tu-dresden.de/portal/en/publications/articulatory-copy-synthesis-based-on-the-speech-synthesizer-vocaltractlab-and-convolutional-recurrent-neural-networks(582a3537-03ec-4a50-9175-5af6411b73e2).html>)).
  - Speaker-dependent German: parameter correlation 0.983.
  - Speaker-independent copy synthesis, scored by Google STT recognition rate: German 73.88%, English 52.92%, Mandarin 52.41%.
  - So with good control, the physical model still loses about half the words outside its home language and speaker.
- Krug et al. propose a self-supervised fix for the "control problem". Motor trajectories from random synthetic speech are linked to natural audio or phoneme sequences through speaker-independent VQ-VAE latents, and the method is meant to work with any synthesizer ([Interspeech 2023, doi:10.21437/Interspeech.2023-2173](https://www.isca-archive.org/interspeech_2023/krug23_interspeech.html)). The abstract gives no numbers.
- VTL speech used as ASR data augmentation sometimes "significantly" helped phoneme recognition and sometimes hurt it. The authors link the outcome to how natural each phoneme sounds ([Interspeech 2022](https://www.isca-archive.org/interspeech_2022/krug22_interspeech.html)).
- A 2025 ICASSP paper, "Precisely Controllable Neural Speech Synthesis" (Krug, Wagner, Birkholz, Stich), exists according to DBLP. I could not verify its method or whether it uses VTL ([DBLP](https://dblp.uni-trier.de/pid/265/6571.html)).

**Differentiable physical simulators (fit the physics to real audio by gradient descent).**

- Südholt, Cámara, Xu and Reiss backpropagate through a waveguide (Kelly-Lochbaum-style) vocal tract and the articulatory-to-area mapping of **Pink Trombone**, using inverse filtering. They estimate glottal source parameters and area functions from recorded vowels. In a subjective test this beat evolutionary optimisers and a neural parameter predictor ([DAFx 2023, arXiv:2307.04702](https://arxiv.org/abs/2307.04702)). It is the most directly reusable result for a JS Kelly-Lochbaum engine.
- VocalTrax (MIT) inverts audio to articulatory parameters by optimising an "accelerated vocal tract model". It reports better out-of-domain reconstruction but "persistent challenges in matching natural voice quality". The page does not name the underlying model ([NeurIPS 2024 Audio Imagination workshop](https://vocaltrax.media.mit.edu), [code](https://github.com/PapayaResearch/vocaltrax)).
- Chen and Sitzmann, "A Differentiable Simulator for Human Vocal Learning": analytic gradients from tract geometry to sound, for both forward and inverse modelling. The abstract has no numbers ([NeurIPS 2025 workshop](https://neurips.cc/virtual/2025/131410)).
- Chen, Lee and Sitzmann, "Reconstructing the Vocal Tract with Differentiable Acoustic Simulation" ([NeurIPS 2026 poster](https://neurips.cc/virtual/2026/poster/151084)). This is the most relevant recent work for the 1D-vs-FDTD question here. It contributes:
  - a frequency-domain tube formulation described as "70x more GPU parallelizable than finite differences in time";
  - a differentiable turbulence model for consonants;
  - a neural parameterisation of the geometry that speeds convergence and avoids local minima;
  - self-supervised autoencoding of tract shapes across 11 languages.

  I saw only the abstract summary.

**Neural "articulatory vocoders" (articulation in, neural waveform out).**

- Wu, Watanabe, Goldstein, Black and Anumanchipalli: time-domain synthesis from EMA. EMA-to-speech WER 18.5%, reported as 11.6% better than prior work ([Interspeech 2022, arXiv:2209.06337](https://arxiv.org/abs/2209.06337)).
- Liu et al.: a DDSP harmonic-plus-noise articulatory vocoder with learned LTV-FIR noise filters and a multi-resolution adversarial loss. Inputs are EMA, F0 and loudness, output is 16 kHz ([arXiv:2409.02451](https://arxiv.org/html/2409.02451v1)).
  - On MNGU0: WER 6.67%, MOS 3.74, against HiFi-CAR's WER 8.31 and MOS 3.58.
  - 4.9x faster on CPU (0.037 s per 1 s of audio on an M1).
  - A 0.4M-parameter variant gives comparable quality. The default model is 9.0M; the abstract cites about 9M for the SOTA baseline, while its table lists HiFi-CAR at 13.5M.
- **SPARC / "Articulatory Encodec"**, Cho, Wu, Prabhune, Agarwal, Anumanchipalli ([IEEE JSTSP 18(8), 2024, arXiv:2406.12998](https://arxiv.org/html/2406.12998v4)).
  - Inputs: 12 EMA channels plus pitch and loudness at 50 Hz, and a 64-dimensional speaker embedding.
  - Architecture: HiFi-GAN with FiLM conditioning, 16 kHz output, trained on 555 h of LibriTTS-R.
  - Resynthesis on LibriTTS-R: WER 5.43 (GT 4.22), MOS 3.82 (GT 4.01), UTMOS 4.12 (GT 4.10).
  - Resynthesis on VCTK: WER 3.73, MOS 3.67 (GT 3.65).
  - Zero-shot voice conversion: speaker similarity 0.879.
  - Code: `pip install speech-articulatory-coding`, with `en`, `multi` and `en+` checkpoints ([repo](https://github.com/Berkeley-Speech-Group/Speech-Articulatory-Coding)).
  - Licence (uncertain): `setup.py` declares MIT, but the repo has no LICENSE file (GitHub detects none), and the checkpoint licence is not stated. Check before redistributing weights.

  This shows that a **12-dimensional articulatory control space is enough for near-recording-quality speech**, provided the articulation-to-waveform step is learned.

- ArtSpeech (Wang, Wang, Li, Huang): adaptive TTS built on articulatory representations, describing voice tone and prosody ([ACM MM 2024, doi:10.1145/3664647.3681097](https://unpaywall.org/10.1145%2F3664647.3681097)). I saw only the abstract and no numbers.
- I did not find a published text-to-EMA model feeding SPARC end to end (not verified either way).

**Hybrid physical/DSP + neural source-filter models.**

- NSF (Wang, Takaki, Yamagishi): sine-based excitation into a neural filter. At least 100x faster than autoregressive WaveNet with quality "close to" it. Ablations show both the sine source and spectral losses are essential ([arXiv:1810.11946](https://arxiv.org/abs/1810.11946)).
- DDSP (Engel et al.): differentiable oscillators and filters trained end to end. High fidelity "without large autoregressive models or adversarial losses", with interpretable controls ([arXiv:2001.04643](https://arxiv.org/abs/2001.04643)). A review covers DDSP for speech, including the Südholt work ([arXiv:2308.15422](https://arxiv.org/pdf/2308.15422)).
- GOLF (Yu and Fazekas): a glottal-flow wavetable source plus differentiable LPC/IIR vocal tract. Competitive with SOTA singing vocoders, with fewer parameters, less training memory and "an order of magnitude faster" inference ([ISMIR 2023, arXiv:2306.17252](https://arxiv.org/abs/2306.17252)). A journal version appeared in TISMIR (doi:10.5334/tismir.210); I saw it only via search metadata.
- HiFi-Glot: a neural vocoder generates the glottal excitation and differentiable resonant filters impose formants. It claims better quality than Praat with competitive formant-control accuracy ([arXiv:2409.14823](https://arxiv.org/abs/2409.14823)).
- Neural formant synthesis maps formants and other phonetic parameters to mels for HiFi-GAN ([arXiv:2306.01957](https://arxiv.org/abs/2306.01957)).
- I could not verify a "GlottGAN" paper, so I have not cited one.

### 4.3 Evaluation metrics (definitions)

- **MOS**: listeners rate each sample on a 1-5 Absolute Category Rating scale and the scores are averaged. The standard is ITU-T P.800 ([P.800](https://www.itu.int/rec/T-REC-P.800-199608-I)); the fetched page did not list the ACR/CCR sub-methods.
- **CMOS**: listeners rate a sample against a reference on a -3 to +3 scale, and the mean difference is reported ([F5-TTS §eval](https://arxiv.org/html/2410.06885)). **SMOS** is a 1-5 rating of speaker similarity (same source).
- **MCD (mel cepstral distortion)**: a distance between mel-frequency cepstra of synthetic and reference speech, introduced by Kubichek in 1993 ([doi:10.1109/PACRIM.1993.407206](https://ieeexplore.ieee.org/document/407206)). It needs time-aligned references (usually by DTW) and is the natural loss and metric for fitting a simulator to a recording.
- **Formant error**: the absolute or relative deviation of estimated F1-F3 from targets. HiFi-Glot uses formant-control accuracy as an evaluation axis ([arXiv:2409.14823](https://arxiv.org/abs/2409.14823)). There is no single standard; report it in Hz or %.
- **PESQ**: intrusive (reference-based) quality model for narrow-band telephony, ITU-T P.862 (2001). It was **deleted on 5 Jan 2024 in favour of P.863 (POLQA)** ([ITU P.862](https://www.itu.int/rec/T-REC-P.862)). It is a poor fit for TTS, which has no sample-aligned reference.
- **STOI**: intrusive intelligibility measure based on short-time (about 386 ms) envelope correlation ([Taal et al., IEEE TASLP 2011, doi:10.1109/TASL.2011.2114881](https://sps.ewi.tudelft.nl/pubs/Taal2011_1.pdf)).
- **UTMOS**: a non-intrusive MOS predictor built as an ensemble of fine-tuned SSL "strong learners" and "weak learners". It had top scores on several VoiceMOS 2022 metrics ([Saeki et al., arXiv:2204.02152](https://arxiv.org/abs/2204.02152)). It is the de facto automatic naturalness score in the tables above.
- **DNSMOS**: a non-intrusive perceptual metric designed for noise suppressors ([Reddy et al., arXiv:2010.15258](https://arxiv.org/abs/2010.15258)). It was not designed for TTS.
- **WER via ASR**: transcribe with Whisper-large-v3 and compute word error rate against the input text ([F5-TTS](https://arxiv.org/html/2410.06885); Whisper was trained on 680K h, [arXiv:2212.04356](https://arxiv.org/abs/2212.04356)). The VTL work used Google STT recognition rate instead ([Gao et al. 2024](<https://fis.tu-dresden.de/portal/en/publications/articulatory-copy-synthesis-based-on-the-speech-synthesizer-vocaltractlab-and-convolutional-recurrent-neural-networks(582a3537-03ec-4a50-9175-5af6411b73e2).html>)).
- **Speaker similarity (SIM-o)**: cosine similarity of WavLM-large speaker-verification embeddings between synthetic and real speech ([F5-TTS](https://arxiv.org/html/2410.06885)).

A minimal, comparable benchmark for this project would be: Whisper WER, UTMOS, and (for copy synthesis) MCD and F0 RMSE against the same LibriSpeech-PC / LibriTTS-R sentences used above. Kokoro run in the browser on those sentences is the local baseline.

### 4.4 What could make a physics simulator competitive (synthesis)

- **Learn the control and keep the physics.** The biggest gap is in control, not in the acoustics:
  - VTL with hand rules is "on par" with academic TTS ([Krug 2021](https://www.isca-archive.org/ssw_2021/krug21_ssw.html)).
  - With learned inversion it reaches 0.983 parameter correlation speaker-dependently, but only about 53-74% recognition across speakers ([Gao 2024](<https://fis.tu-dresden.de/portal/en/publications/articulatory-copy-synthesis-based-on-the-speech-synthesizer-vocaltractlab-and-convolutional-recurrent-neural-networks(582a3537-03ec-4a50-9175-5af6411b73e2).html>)).
  - Replacing rule-based IPA→articulation with a sequence model trained on inverted real speech is the highest-leverage change ([Krug 2023](https://www.isca-archive.org/interspeech_2023/krug23_interspeech.html)).
- **Make the 1D Kelly-Lochbaum path differentiable and fit it to real recordings.**
  - Gradient descent through the waveguide and the articulatory→area mapping already beats black-box search on Pink Trombone ([Südholt 2023](https://arxiv.org/abs/2307.04702)).
  - Frequency-domain formulations plus a neural geometry prior scale this to consonants and many languages ([Chen et al. 2026](https://neurips.cc/virtual/2026/poster/151084)).
  - Use MCD, spectral losses and formant losses.
  - 3D FDTD is the wrong place to optimise. It is better used offline to produce training data and validate 1D models (my inference, not tested).
- **Use real articulatory trajectories as targets.** SPARC's 12-channel EMA space plus pitch and loudness reaches MOS 3.82 against 4.01 for ground truth ([Cho 2024](https://arxiv.org/html/2406.12998v4)). Its analysis model can supply pseudo-EMA for any audio. The task is then to learn a mapping from EMA to this project's articulatory parameters and drive the simulator with it.
- **Add a small neural post-filter or residual.** NSF, GOLF, HiFi-Glot and DDSP all keep an interpretable source-filter core and learn only what the physics gets wrong ([NSF](https://arxiv.org/abs/1810.11946), [GOLF](https://arxiv.org/abs/2306.17252), [HiFi-Glot](https://arxiv.org/abs/2409.14823), [DDSP](https://arxiv.org/abs/2001.04643)). A DDSP articulatory vocoder works with 0.4M parameters ([Liu 2024](https://arxiv.org/html/2409.02451v1)), which is cheap enough for an AudioWorklet or WebGPU.
- **Fix the glottal source.** The NSF ablations show the excitation is essential ([arXiv:1810.11946](https://arxiv.org/abs/1810.11946)). Glottal-flow wavetables fitted by gradient descent (GOLF) and jointly estimated source and tract parameters (Südholt) are both ways to do this. Aspiration and turbulence also need a model ([Chen 2026 turbulence model](https://neurips.cc/virtual/2026/poster/151084)).
- **Get prosody from data.** All the competitive systems take F0 and loudness or duration from learned predictors. A rule-based F0 contour will cap MOS no matter how good the tract is (inference from the input sets of SPARC and Liu et al.).
- **Compete on a different axis.** The realistic win is not to out-UTMOS NaturalSpeech 3 (4.30). It is a model of about 1M parameters running in a browser that is fully interpretable and controllable: articulation editing, accent-preserving voice change ([SPARC VC](https://arxiv.org/html/2406.12998v4)), and teaching or visualisation. Its intelligibility should be benchmarked against Kokoro in the browser with Whisper WER and UTMOS.
