# Voice matching from an uploaded recording, and audio formats

Issue #5 asks for two things here:

- A WAV upload in settings that finds the closest simulator settings and
  copies the voice.
- Multiple audio formats.

This file covers the analysis features, how to estimate them, how to fit our
parameters (analysis-by-synthesis), available libraries, and what is feasible
in pure JavaScript for decoding and encoding.

## Features to extract

| Feature                    | Maps to our parameter                  | Method                                            |
| -------------------------- | -------------------------------------- | ------------------------------------------------- |
| F0 mean, range, contour    | base pitch, pitch range, tunes         | YIN / pYIN / autocorrelation                      |
| Formants F1-F4 per vowel   | VTL, area-function mean, vowel targets | LPC (Burg or autocorrelation) + root solving      |
| Formant dispersion ΔF      | VTL                                    | Fitch 1997; Lammert & Narayanan 2015              |
| H1-H2, H1-A3               | Rd / open quotient, spectral tilt      | harmonic amplitudes, formant-corrected (H1*-H2*)  |
| HNR, jitter, shimmer       | aspiration, jitter, shimmer            | Praat-style period analysis                       |
| Speaking rate              | tempo (syllables per second)           | energy-envelope peak counting or forced alignment |
| Long-term average spectrum | tilt, brightness                       | averaged FFT                                      |

### F0 estimation

- YIN:
  - de Cheveigné & Kawahara 2002, JASA 111:1917-1930, doi 10.1121/1.1458024
    (https://www.citedrive.com/en/discovery/yin-a-fundamental-frequency-estimator-for-speech-and-music/).
  - A difference function plus cumulative mean normalisation.
  - Reported about 3x lower error than competing methods at the time.
- pYIN:
  - Mauch & Dixon, ICASSP 2014
    (https://qmro.qmul.ac.uk/xmlui/handle/123456789/6040?show=full,
    code https://code.soundsoftware.ac.uk/projects/pyin).
  - Uses a distribution over YIN thresholds to produce multiple candidates
    per frame.
  - An HMM with Viterbi decoding picks a smooth voiced/unvoiced path.
  - Also implemented in Essentia (https://essentia.upf.edu/reference/std_PitchYinProbabilistic.html)
    and librosa (`librosa.pyin`).
- CREPE:
  - Kim, Salamon, Li & Bello, ICASSP 2018 (https://arxiv.org/pdf/1802.06182).
  - A CNN on the raw waveform, equal to or better than pYIN, and more robust
    to noise.
  - The Essentia wrapper expects 16 kHz audio
    (https://essentia.upf.edu/reference/std_PitchCREPE.html).
  - Too heavy to bundle for our use.
- Recommendation: implement YIN in pure JS (about 100 lines).
  - Restrict the search range to 60-500 Hz.
  - Add a simple Viterbi/median smoothing pass: a "pYIN-lite".

### Formants

- LPC:
  - Use order `2 + fs/1000` (for example 18 at 16 kHz), after pre-emphasis
    and resampling to 10-11 kHz for males or 11-12 kHz for females.
  - These are Praat's default ceilings of 5000 Hz (male) and 5500 Hz
    (female) **(Praat convention; ceiling values unverified here)**.
- Burg's method is Praat's default for formant tracking. Parselmouth gives
  identical results because it calls Praat's C code
  (https://parselmouth.readthedocs.io/).
- Formant frequencies are the angles of complex roots of the LPC polynomial.
  Keep roots with bandwidth below 400 Hz.

### Vocal tract length from formants

- Fitch 1997 (JASA 102(2):1213-1222):
  - Introduced formant dispersion, `ΔF = (F_N - F_1) / (N - 1)`.
  - It tracks VTL and body size better than F0 does
    (https://auditory.org/asamtgs/asa97pen/4aABa/4aABa1.html).
- Uniform-tube estimate:
  - `F_n ≈ (2n - 1) c / (4 L)`.
  - Least-squares fit gives `L ≈ c / (2 ΔF)`, with `c ≈ 350 m/s` in warm,
    humid air.
- Lammert & Narayanan 2015 (PLoS ONE 10(7):e0132193,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC4503663/):
  - Weighting higher formants, which are less affected by articulation,
    gives about 0.63 cm RMSE on simulated tracts and about 1.28 cm on real
    speech (rtMRI, 5 speakers).
- Open tools:
  - https://github.com/mxhold/vocal_tract_length (MIT)
  - https://github.com/megseekosh/vocal_tract_vowel

### Voice quality

- H1-H2:
  - The amplitude difference of the first two harmonics correlates with the
    open quotient.
  - Correct it for F1 (H1*-H2*) per Hanson 1997 (JASA 101:466-481).
  - MIT lab notes:
    https://ocw.mit.edu/courses/6-542j-laboratory-on-the-physiology-acoustics-and-perception-of-speech-fall-2005/9a410aa5de0a94d085b680f35b0d5954_lab5.pdf
- H1-A3 (tilt):
  - About 11 dB lower in males than in females
    (https://auditory.org/asamtgs/asa96haw/2pSC/2pSC8.html).
- Map these to Rd:
  - Higher H1-H2 means higher Rd (laxer).
  - Steeper tilt means higher Rd plus more aspiration.
- Jitter (local, %), shimmer (local, dB) and HNR:
  - Standard Praat measures, also exposed via Parselmouth.
  - Our glottis currently uses jitter SD 0.4% and shimmer SD 3%
    (`src/acoustics/glottis.js`). Fit these from the upload.

## Fitting: analysis-by-synthesis

1. Analyse the upload:
   - F0 track and voiced segments
   - vowel-like frames (high energy, stable formants)
   - formants
   - LTAS and H1-H2
2. Closed-form initial guess:
   - VTL from ΔF
   - F0 mean/range from percentiles 5-95
   - Rd from H1-H2
   - aspiration from HNR
3. Refine by synthesising short vowels with our 1D engine and minimising
   a cost on F1-F4, H1-H2, tilt and LTAS distance.
   - Derivative-free optimisers fit well in a browser:
     - Nelder-Mead: 10-20 parameters, a few hundred evaluations.
     - CMA-ES: more robust with noisy or multimodal costs.
   - Use the fast transfer function (`src/acoustics/transfer.js`) rather than
     time-domain rendering inside the loop.
4. Gradient alternative:
   - Inverse filtering plus a differentiable waveguide frequency response
     (https://github.com/davidmarttila/vocal-tract-grad). It outperformed
     evolutionary and neural baselines in a listening test, per its README.
5. Learning alternative:
   - Train a controller (https://github.com/vvolhejn/samuel).
   - The Sawada robot learns a SOM plus perceptron map from LPC cepstrum to
     motor commands (https://pmc.ncbi.nlm.nih.gov/articles/PMC2279150).
6. Report the result as a preset diff, for example "VTL 15.2 cm, F0 205 Hz,
   Rd 1.6", so users can save it.

## Libraries

| Library             | Language   | Licence                                | Use                                                                                                                               |
| ------------------- | ---------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Parselmouth (Praat) | Python     | GPL-3.0+ (Praat itself GPL-2.0+)       | Reference values for tests, offline only; https://parselmouth.readthedocs.io/, Jadoul et al. 2018, doi 10.1016/j.wocn.2018.07.001 |
| librosa (`pyin`)    | Python     | ISC **(unverified)**                   | Offline reference                                                                                                                 |
| Meyda               | JavaScript | MIT                                    | RMS, spectral centroid, MFCC, LTAS in browser; https://meyda.js.org/, https://npmjs.com/package/meyda                             |
| essentia.js         | JS + WASM  | AGPL-3.0 (commercial licence from UPF) | pYIN, LPC, many more; licence too strong to bundle; https://essentia.upf.edu/licensing_information.html                           |
| CREPE               | Python/TF  | MIT **(unverified)**                   | Too heavy; https://arxiv.org/pdf/1802.06182                                                                                       |

Recommendation:

- Write YIN, LPC (autocorrelation with Levinson-Durbin), H1-H2 and HNR
  ourselves in pure JS. Each is small and well documented.
- Use Parselmouth only in `experiments/` to produce golden values for tests.

## Audio formats

### Current state

`src/audio/wav.js` encodes only mono 16-bit PCM WAV. `decodeWav` has these
limits:

- It reads only 16-bit samples.
- It reads `channels`/`sampleRate` at fixed offsets 22/24, assuming `fmt ` is
  the first chunk.
- It does not honour the RIFF rule that odd-sized chunks are padded to an
  even length.

Uploads with 24-bit, float, `LIST` chunks before `fmt `, or
WAVE_FORMAT_EXTENSIBLE headers will therefore decode wrongly.

### WAV (RIFF)

- `wFormatTag` values:
  - 1 = PCM (8-bit unsigned; 16/24/32-bit signed little-endian)
  - 3 = IEEE float (32/64-bit)
  - `0xFFFE` = WAVE_FORMAT_EXTENSIBLE
- WAVE_FORMAT_EXTENSIBLE:
  - Describes formats with more than 2 channels or more than 16 bits
    (https://learn.microsoft.com/en-us/windows/win32/api/mmreg/ns-mmreg-waveformatextensible).
  - `cbSize` must be at least 22.
  - `wValidBitsPerSample` may be smaller than the container
    `wBitsPerSample`; for example, 20 valid bits in a 24-bit container.
  - `dwChannelMask` maps channels to speakers.
  - A SubFormat GUID selects PCM or float.
  - For 1-2 channel 16-bit PCM, plain `WAVE_FORMAT_PCM` is expected (same
    source).
- Decoder rules:
  - Walk chunks.
  - Parse `fmt ` wherever it appears.
  - If the tag is `0xFFFE`, read the format from the SubFormat GUID.
  - Support 8/16/24/32-bit integer and 32/64-bit float.
  - Average channels down to mono.
  - Skip pad bytes.
- Encoder options:
  - 16-bit PCM (default)
  - 24-bit PCM
  - 32-bit float (tag 3, which needs a `fact` chunk per the spec
    **(unverified)**)

### AIFF / AIFF-C

- Big-endian container (`FORM`/`AIFF`) with `COMM` and `SSND` chunks.
- The sample rate is stored as an 80-bit IEEE 754 extended float
  **(well-known format detail; no fetched source confirmed it)**.
- An encoder is easy in pure JS.

### Sun AU (`.au`/`.snd`)

- Magic `.snd`.
- Header fields are 32-bit big-endian: header size, data size, encoding,
  sample rate, channels, then an info string
  (https://docs.python.org/fr/3.8/library/sunau.html).
- Encodings include:
  - 2 = 8-bit linear
  - 3 = 16-bit linear
  - 6 = 32-bit float
  - 1 = μ-law
- Trivial to encode.

### Raw PCM

- Headerless.
- Offer it as "raw float32 little-endian" or "raw int16" for researchers.

### FLAC

- libflac.js (https://github.com/mmig/libflac.js, npm `libflacjs`) is libFLAC
  compiled with Emscripten (pure JS or WASM).
  - Encoder and decoder.
  - Native FLAC and Ogg-FLAC.
- Licences:
  - libFLAC is BSD-style (https://www.npmjs.com/package/emflac).
  - The wrapper's own licence is listed as MIT only on a mirror
    (https://gitee.com/ziiwee/libflac.js) **(unverified)**.
- Alternative: a minimal FLAC encoder in pure JS.
  - Use verbatim or fixed-predictor subframes with Rice coding.
  - This is a few hundred lines and gives lossless compression of about 50%
    on speech **(our estimate)**.

### MP3

- lamejs (https://github.com/zhuker/lamejs):
  - A JS rewrite of LAME via jump3r, about 20x realtime.
  - Licence LGPL-3.0 per npm/jsDelivr (https://www.jsdelivr.com/package/npm/lamejs)
    **(LICENSE file not checked)**.
- LGPL code should be loaded as a separate, replaceable module (lazy
  `import()`), not bundled into our public-domain (Unlicense) code.

### Ogg Opus / WebM Opus / MP4 AAC

- MediaRecorder:
  - Can encode an AudioContext `MediaStreamDestination` in real time.
  - `MediaRecorder.isTypeSupported()` tells which MIME types work.
  - It is Baseline widely available (Safari 14.1+)
    (https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static).
  - Probe a candidate list:
    - `audio/webm;codecs=opus`
    - `audio/ogg;codecs=opus`
    - `audio/mp4`
  - Safari is reported to prefer `audio/mp4`
    (https://blog.openreplay.com/fr/enregistrer-audio-navigateur-web-audio-api/).
  - Drawback: it records in real time, so a 10 s clip takes 10 s.
- WebCodecs `AudioEncoder`:
  - Encodes `AudioData` faster than real time.
  - Secure context only, available in dedicated workers.
  - **Not Baseline** (limited availability)
    (https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder).
  - Probe codecs with `AudioEncoder.isConfigSupported()`.
  - It outputs raw packets. Producing a `.ogg`/`.webm` file still needs a
    muxer in JS.

### Decoding uploads

- `BaseAudioContext.decodeAudioData(arrayBuffer)`:
  - Returns a Promise.
  - Needs complete file data.
  - Resamples to the context sample rate
    (https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData).
  - Format coverage depends on the browser's codecs; MP3, WAV, Ogg and
    AAC/MP4 are common.
- Use `OfflineAudioContext` with the desired sample rate to avoid a second
  resampling step.
- In Node (CLI and tests) there is no `decodeAudioData`. Use our own
  WAV/AIFF/AU decoders and treat others as unsupported, or add an optional
  ffmpeg path.

## What is feasible in pure JS

| Format                                      | Encode in pure JS                  | Decode in pure JS     | Browser API fallback                |
| ------------------------------------------- | ---------------------------------- | --------------------- | ----------------------------------- |
| WAV PCM 8/16/24/32, float 32/64, EXTENSIBLE | yes                                | yes                   | decodeAudioData                     |
| AIFF / AIFF-C (uncompressed)                | yes                                | yes                   | decodeAudioData (browser dependent) |
| AU                                          | yes                                | yes                   | -                                   |
| Raw PCM                                     | yes                                | yes (user gives rate) | -                                   |
| FLAC                                        | yes (simple encoder) or libflac.js | libflac.js            | decodeAudioData in most browsers    |
| MP3                                         | lamejs (LGPL, lazy load)           | -                     | decodeAudioData                     |
| Opus (Ogg/WebM)                             | no (WASM needed)                   | no                    | MediaRecorder, WebCodecs            |
| AAC (MP4)                                   | no                                 | no                    | MediaRecorder (Safari), WebCodecs   |

## Recommendations

1. Rewrite `decodeWav`:
   - Walk chunks properly.
   - Support PCM 8/16/24/32, float 32/64 and EXTENSIBLE.
   - Mix down to mono.
   - Add matching encoders (16/24-bit PCM, 32-bit float).
2. Add AIFF and AU encoders and decoders as small pure-JS modules, with
   round-trip tests.
3. In the browser, accept any file via `decodeAudioData` first, then fall back
   to our decoders.
4. Export "compressed" via MediaRecorder or WebCodecs, whichever probes
   available. Load MP3 (lamejs) and FLAC (libflac.js) lazily as optional
   modules.
5. Voice matching pipeline:
   - YIN F0 with smoothing
   - LPC formants
   - ΔF-based VTL
   - H1-H2 and HNR
   - initial preset
   - Nelder-Mead on the 1D transfer function with 8-12 parameters
   - Show a preset diff.
6. Unit tests: generate vowels with known VTL/F0/Rd from our own synthesizer
   and check that the analyser recovers them within 5% (F0), 0.7 cm (VTL;
   cf. 0.63 cm RMSE in Lammert & Narayanan) and ±0.2 (Rd).
