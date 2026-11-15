# voice-simulator

A physical 3D voice simulator. There are no recordings and no samples: text is
transcribed to IPA, turned into a smooth articulation plan, and every sound is
a pressure wave travelling through the 3D shape of a parametric low-poly head
(vocal tract, nasal cavity, lips and the air in front of the mouth).

![Voice simulator web UI while speaking](docs/screenshots/web-app-speaking.png)

## Features

- **Text to IPA** for English, Russian, Hindi and Chinese, with automatic
  language detection per word (`textToIpa`). Numbers, dates, times, money,
  units and abbreviations are read out per language (`normalizeText`).
  English heteronyms get the reading that fits the sentence (`I will read`
  ɹid, `I read it yesterday` ɹɛd, `record the record` ɹəˈkɔɹd ˈɹɛkɚd) by
  written rules on the neighbouring words. Russian prepositions and the
  particles `не`, `ни`, `же`, `ли`, `бы` are spoken as part of the word they
  lean on, with a reduced vowel and the voicing of the next sound (`из дома`
  ɪz ˈdomə, `на работе` nə rɐˈbotʲə, `как же` kaɡ ʐɨ); each stays its own
  word for highlighting. Mandarin applies tone sandhi and erhua: 花儿 and
  `huār` are one syllable, `xwaɻ˥`.
- **English weak forms**: function words are weak and unstressed inside a
  phrase (`a cup of tea for you` ə ˈkʌp əv ˈti fɚ ju, `the end` ði ˈɛnd,
  `I have to go` aɪ ˈhæf tə ˈɡoʊ) and keep their strong form alone and at
  the end of a phrase (`Yes, I can.`). The table is `WEAK_FORMS`;
  `weakForms: false` (CLI `--strong-forms`) turns them off.
- **English accents**: General American, Southern British, Australian and
  Indian English (`accent: 'en-GB'`, or `lang: 'en-GB'`).
- **Punctuation prosody**: commas, semicolons, dashes, parentheses, quotes,
  periods, exclamations, questions and ellipses each have their own pause,
  final pitch movement and lengthening; questions with a question word
  fall, yes/no questions rise, exclamations are higher and louder. Hindi
  question words fall wherever they stand, and sentence-initial क्या is
  read as the yes/no particle (`क्या तुम आओगे?` rises) unless the next word
  makes it mean "what" (`क्या हुआ?` falls).
- **Lexical tones**: every level of a tone written with Chao tone letters is
  a pitch target, so the Mandarin third tone `˨˩˦` dips before it rises.
- **Word and syllable timeline**: `utteranceTimeline` (also in
  `synthesize`) tells when every word and syllable is spoken; the app
  highlights the current word and syllable in the text and the IPA.
  Numbers, dates, times, money and units stay one word of the text with
  `spoken` set to what is said (`25` → `twenty five`); their syllables
  carry the spoken letters, and the part of the token they read
  (`partStart`/`partEnd`), so `3/4/2024` lights 3, then 4, then 2024.
- **Smooth articulation**: IPA becomes a time plan of tract shapes with
  coarticulated transitions, glottal source and pitch contour.
- **Physical acoustics** with two interchangeable solvers:
  - `waveguide`: a branched Kelly-Lochbaum tube (tract + nose) that follows
    the 3D centreline of the head; real time on any device.
  - `fdtd3d`: a sparse-voxel 3D finite-difference time-domain solver of the
    acoustic wave equation inside the voxelised head and the air around it;
    the default of the library, the CLI and the server (`studio` tier).
- **Two voice sources**: the LF pulse (`source: 'lf'`, the default) and a
  two-mass model of the vocal folds driven by the lung pressure
  (`source: 'folds'`), whose pitch, loudness and voice quality follow
  from the lung pressure, the fold tension and the adduction; see
  [Voice source](#voice-source).
- **Low-poly head model** with only acoustically relevant detail (tract tube,
  nasal tube, lips, jaw, skin hull, teeth, tongue, hard and soft palate),
  four mesh LODs and OBJ, STL and glTF export (`npm run export:model`, opens
  in Blender). The tract bends like the MRI tracts of the Dresden Vocal
  Tract Dataset, the upper and lower lips outline the acoustic opening, the
  teeth lie on a dental arch fitted to 17 segmented CBCT scans, the jaw
  opens per phoneme as measured by MRI, and the hard palate and velum have
  the lengths, vault height and thickness measured on skulls, CT and MRI.
- **Anatomy checks**: `scripts/compare-anatomy.mjs` renders the model next
  to MRI vocal tracts and measures their agreement on midsagittal, coronal,
  axial and oblique cuts; `scripts/fetch-dvtd.mjs` and
  `scripts/fetch-anatomy.mjs` fetch MRI tracts, segmented teeth and the
  HuBMAP Visible Human mouth and larynx just in time, and
  `scripts/compare-hra.mjs` cuts the model and the HuBMAP organs like MRI
  slices and compares ten key points after a rigid fit; with
  `--atlas z-anatomy|bodyparts3d --dir DIR` it does the same against the
  Z-Anatomy and BodyParts3D atlases (see
  [the issue 9 case study](docs/case-studies/issue-9/README.md)).
- **Anatomy from any 3D source, part by part**: each articulator (upper
  and lower teeth, tongue, hard palate, velum) comes from the procedural
  model or from a segmented dataset (the HuBMAP Visible Human male and
  female, or any glTF binary), fitted onto the model's dental key points,
  carried by the jaw and reduced from full resolution to each LOD by vertex
  clustering:

  ```js
  import { headModel, hraSource, registerAnatomySource } from 'voice-simulator';

  registerAnatomySource(await hraSource('male')); // fetched just in time
  const meshes = headModel(head, {
    lod: 3,
    anatomy: { tongue: 'hra-male', palate: 'hra-male' }, // or 'hra-male'
  });
  ```

  `npm run export:model -- --anatomy hra-female --scale` exports the same,
  `anatomySourceFromGlb` reads a character's own mouth, and
  `zAnatomySource` and `bodyParts3dSource` read the Z-Anatomy STLs and
  BodyParts3D OBJs that `scripts/fetch-anatomy.mjs` downloads
  (`npm run export:model -- --atlas z-anatomy=DIR --anatomy z-anatomy`).

- **Talking animation for character models**: `visemeTrack(plan, head,
{ format, fps })` turns the articulation the solvers hear into ARKit
  blendshapes (the 52 curves of MetaHuman, Ready Player Me and face
  trackers), VRM 1.0 expressions (`aa ih ou ee oh`) or the 15 Oculus
  visemes. Each frame comes from the jaw angle that opens the incisors as
  far as the tract needs, the lip opening with the area of the last tract
  section, and where the lips and the tongue constrict: /m b p/ close the
  lips, /f v/ tuck the lower lip under the upper incisors, /θ ð/ show the
  tongue tip, and coarticulation carries over (`faceRig` gives the
  physical measures in cm and radians).
- **Bridges to any character model**: `bindRig(morphTargetNames)` reads
  the mouth shapes a model has and binds them to the face rig, whichever
  convention they follow: ARKit names (also MetaHuman
  `CTRL_expressions_*`, `blendShape1.*` and Ready Player Me), Oculus
  visemes (`viseme_PP`, VRChat `vrc.v_pp`), VRM 1.0 and 0.x vowels, VRoid
  `Fcl_MTH_*` and MMD `あいうえお`. `rigFrame(binding, faceRig(state, head))`
  gives the morph target weights of one frame, `characterTrack(plan, head,
names)` a whole utterance, and `vrmVowelBinds(gltfJson)` reads the morph
  targets a VRM file declares for its vowels. The example app's **Talking
  character** panel animates a procedural head or any `.vrm`, `.glb` or
  `.gltf` model the user loads.

  ![Talking character poses](docs/case-studies/issue-9/character/poses.png)

- **Teeth and piriform fossae in the acoustics**: the incisors narrow the
  tract and turn the frication jet into a sibilant source; the piriform
  fossae add their side-branch antiresonance in both solvers, the
  vallecula in the 3D solver.
- **Head and voice editor**: 34 parameters, everything that changes the
  sound (tract length, pharynx, mouth, jaw, nose, pitch, breathiness,
  jitter, shimmer, vibrato, declination, accent strength, lengthening,
  pauses, wall loss, nasal losses, nasal coupling, frication level, ...). Every page
  refresh starts from a new random seed; `?seed=` makes it reproducible.
- **Male, female and child presets** for random heads (`preset`), with f0
  and formants fitted to the men's, women's and children's means of
  Hillenbrand et al. (1995), and a posterior glottal chink (`glottalChink`)
  that gives women and children their measured spectral tilt.
- **Copy a voice**: `matchVoice` analyses a recording (f0, formants,
  vocal-tract length, H1-H2, HNR, speaking rate) and searches for the head
  that sounds most like it; in the app, upload a file or record yourself.
- **Microphone and room**: place the microphone anywhere around the head
  (distance, azimuth, elevation, 1/r fall-off and delay), add a room
  reverb (eight presets or any shoebox with an RT60), or let the 3D solver
  simulate a box of air around the head.
- **Audio formats**: WAV (8-32-bit integer and 32/64-bit float), FLAC,
  AIFF, AU and raw PCM, for both writing and reading, with band-limited
  resampling (`encodeAudio`, `decodeAudio`, `resample`).
- **Automatic LODs** for audio and visuals: a startup benchmark (on the CPU
  and, for the 3D tiers, on WebGPU) plus a runtime governor keep about 20%
  headroom (target load 80%).
- **WebGPU**: the 3D solver can run on the GPU (`device` option), and the
  app uses it when the browser has WebGPU, with the CPU as fallback.
- **Modes**: sound only, 3D only, or both, with optional jaw/lip animation and
  a live pressure-field view.
- **Delivery**: GitHub Pages web app, JavaScript library, CLI, HTTP API with
  WAV streaming, and a Docker image with the server.

The full research, the list of requirements and the plan behind each of them
are in [docs/case-studies/issue-1](docs/case-studies/issue-1/README.md); the
second round (precision, anatomy, listening, presets, voice matching,
formats, linguistics) is in
[docs/case-studies/issue-5](docs/case-studies/issue-5/README.md), and the
third (full 3D by default, anatomy against MRI and segmented scans, female
and child voices, WebGPU) in
[docs/case-studies/issue-9](docs/case-studies/issue-9/README.md).

### Vision and roadmap

Where the project is going is written in [docs/VISION.md](docs/VISION.md): one
physical model that both speaks (text → IPA → audio) and listens (audio → IPA
→ language → text), copies voices, uses no neural networks and stays in the
public domain. Today the simulator speaks; listening and voice copying from
real recordings are planned, not delivered.

The plan is [docs/ROADMAP.md](docs/ROADMAP.md): GitHub issues marked as bugs
and features, grouped in six milestones, with the blockers between them. The
analysis, the survey of similar projects and the research behind the plan are
in [docs/case-studies/issue-11](docs/case-studies/issue-11/README.md).

## Quick Start

### Web app

The web app in [`examples/universal-app`](examples/universal-app) is deployed
to GitHub Pages. Run it locally:

```bash
npm install --prefix examples/universal-app
npm run example:web:dev
```

Synthesis runs in a Web Worker and is streamed to Web Audio in chunks; the 3D
view uses three.js and colours the tract (or every air voxel with the 3D
solver) by the simulated acoustic pressure.

Every published release stays online at its own path so all versions can be
compared: `/v1/`, `/v2/` (the release before issue 9) and so on, with the
current version at both `/` and the next path (`/v3/` for this one). The
header of the app links every version
(`https://konard.github.io/voice-simulator/v2/`).

### Library

```bash
npm install voice-simulator
```

```js
import {
  decodeAudio,
  encodeAudio,
  encodeWav,
  matchVoice,
  randomHeadConfig,
  synthesize,
  synthesizeStream,
  textToIpa,
} from 'voice-simulator';

textToIpa('Привет, мир'); // { lang: 'ru', ipa: 'prʲɪˈvʲet | mʲir', ... }
textToIpa('water', { lang: 'en', accent: 'en-GB' }).ipa; // 'ˈwɔːtə'
textToIpa('a cup of tea for you', { lang: 'en' }).ipa; // 'ə ˈkʌp əv ˈti fɚ ju'
// weakForms: false keeps every English word in its stressed dictionary form.
textToIpa('I can do it', { lang: 'en', weakForms: false }).ipa; // 'ˈaɪ ˈkæn ˈdu ˈɪt'

const head = randomHeadConfig(42); // a different person for every seed
const result = synthesize('Hello world', { head, tier: 'medium' });
const wav = encodeWav(result.samples, result.sampleRate);

// A random woman, heard from 1 m in front in a small room, saved as FLAC.
const far = synthesize('Hello world', {
  head: 'random',
  preset: 'female',
  microphone: { distance: 100, compensate: true },
  room: 'small-room',
});
const flac = encodeAudio(far.samples, far.sampleRate, {
  format: 'flac',
  bitDepth: 24,
});

// Copy a voice: the head that sounds most like a recording.
const { samples, sampleRate } = decodeAudio(recordingBytes);
const { head: copied } = matchVoice(samples, sampleRate, {
  transcript: 'What the recording says',
});

// The vocal folds as the voice source (the default is source: 'lf').
const folds = synthesize('Hello world', { tier: 'medium', source: 'folds' });

// When each word and syllable is spoken, in seconds of the audio.
for (const word of result.timeline.words) {
  console.log(word.start, word.end, word.text, word.syllables.length);
}

// Streaming: chunks of Float32Array as soon as they are simulated.
for await (const chunk of synthesizeStream('नमस्ते', { tier: 'low' })) {
  play(chunk);
}
```

On the GPU, pass a WebGPU device and render asynchronously; the GPU
follows the CPU kernel within 1e-5 relative RMS error:

```js
import {
  describeGpuDevice,
  requestGpuDevice,
  synthesizeAsync,
} from 'voice-simulator';

const device = await requestGpuDevice(); // null without WebGPU
const gpuResult = await synthesizeAsync('Hello world', { device });
// {description, vendor, architecture, fallback} of the adapter, or null
console.log(describeGpuDevice(device));
```

Lower-level building blocks are exported too: `planUtterance`,
`sampleState`, `tractShape`, `Waveguide`, `Fdtd3d`, `buildVoxelModel`,
`VoiceRenderer`, `headMesh`, `tubeMesh`, `headModelObj`, `LodGovernor`,
`chooseTier`, `chooseTierWithGpu`, `measureAudioTier`,
`benchmarkAudioTiersAsync` and more; see
[`src/index.d.ts`](src/index.d.ts). A runnable example is in
[`examples/basic-usage.js`](examples/basic-usage.js).

### CLI

```bash
npx voice-simulator ipa "你好世界"
npx voice-simulator ipa "Water, please." --accent en-GB
npx voice-simulator timeline "Hello world, how are you?"   # word and syllable times
npx voice-simulator visemes "Hello world" -f vrm --fps 30 -o hello.json  # face animation
npx voice-simulator say "Hello world" -o hello.wav --seed 7
npx voice-simulator say "Привет" --tier high -o fdtd.wav   # 3D FDTD solver
npx voice-simulator say "Hello" --preset female --head random -o hi.flac -b 24
npx voice-simulator say "Hello" --mic-distance 100 --mic-azimuth 45 --room hall -o hall.wav
npx voice-simulator say "Hello" --tier high --box 30x44x30 -o box.wav  # simulated box
npx voice-simulator say "Hello" --source folds -o folds.wav  # vocal-fold source
npx voice-simulator convert hello.flac -o hello.aiff --sample-rate 16000
npx voice-simulator match recording.wav --transcript "What it says" --json
npx voice-simulator compare recording.wav hello.wav --json   # distances from a reference
npx voice-simulator mesh --lod 3 -o head.obj
npx voice-simulator benchmark
npx voice-simulator serve --port 8080
npx voice-simulator --help
```

### Comparing recordings

`compareRecordings(reference, test)` measures how far a recording is from a
reference, and `voice-simulator compare <reference> <test> [--json]` does the
same for two audio files. Both recordings are resampled to
min(16000 Hz, both rates), the silence at both ends is cut (frames more than
40 dB below the loudest), both are scaled to an RMS of 0.1 and aligned by
dynamic time warping (DTW; Sakoe & Chiba 1978) on the mel cepstra c1 to c13.
Every metric is then taken along the alignment. Frames are 0.025 s long with
a Hann window, taken every 0.01 s, with a 512-point FFT. Before a logarithm,
bin powers and mel filter energies weaker than 60 dB below the strongest one
of the same recording are raised to that level (`DYNAMIC_RANGE_DB`, option
`range`), so an empty band costs at most the dynamic range. LSD and MCD skip
the pairs whose reference frame is silent (40 dB below the loudest reference
frame): pauses and background noise of a recording are not speech to compare
with.

| Metric                                       | Field                             | Unit     | Formula                                                                           |
| -------------------------------------------- | --------------------------------- | -------- | --------------------------------------------------------------------------------- |
| Log-spectral distance (LSD)                  | `lsd`                             | dB       | per frame pair √(mean over bins of (10 log10 Pr − 10 log10 Pt)²), mean over pairs |
| Mel-cepstral distortion (MCD; Kubichek 1993) | `mcd`                             | dB       | per pair (10 / ln 10) √(2 Σ₁¹³ (cr[n] − ct[n])²), mean over pairs                 |
| f0 root mean square error                    | `f0.rmseCents`                    | cents    | √mean e², e = 1200 log2(f0 test / f0 reference) over frames voiced in both        |
| Mean f0 error                                | `f0.meanCents`                    | cents    | mean e (positive: the test is higher)                                             |
| Gross pitch error (GPE)                      | `f0.gpe`                          | fraction | share of frames voiced in both with \|test / reference − 1\| > 0.2                |
| Voicing decision error (VDE)                 | `f0.vde`                          | fraction | share of all frames voiced in only one recording                                  |
| f0 frame error (FFE; Chu & Alwan 2009)       | `f0.ffe`                          | fraction | (gross errors + voicing errors) / frames                                          |
| f0 correlation                               | `f0.correlation`                  | −1 to 1  | Pearson correlation of log f0 over frames voiced in both                          |
| Formant errors                               | `formants.f1` … `f3`              | Hz and % | mean \|F test − F reference\| over voiced frames with formants in both            |
| Timing error                                 | `timing.rmsSeconds`, `maxSeconds` | s        | per pair d = j·hop − i·hop·(Tt / Tr)                                              |

Pitch comes from YIN (de Cheveigné & Kawahara 2002) at 11025 Hz on 0.04 s
windows; a frame is unvoiced when it is quieter than 10 % of the 95th
percentile level or its aperiodicity is 0.35 or more. Formants come from LPC
on 0.03 s of each voiced frame.

`errorRate(reference, hypothesis, unit)` compares two transcripts by the
Levenshtein distance: the word error rate (WER, `unit = 'word'`), the
character error rate (CER, `'char'`) and the phoneme error rate (PER,
`'phone'`, IPA without stress marks and tones), each a fraction of the
reference length.

```js
import { compareRecordings, errorRate, decodeAudio } from 'voice-simulator';

const result = compareRecordings(decodeAudio(refBytes), decodeAudio(testBytes));
result.mcd; // dB
result.f0.ffe; // fraction of frames
errorRate('The cat sat on the mat.', 'the cat sit on mat').rate; // 0.333
errorRate('你好吗', '你好', 'char').rate; // 0.333
```

The lower-level functions `fft`, `powerFrames`, `melFilterbank`, `mfcc`,
`dtw`, `logSpectralDistance`, `melCepstralDistortion`, `pitchTrack`,
`f0Errors`, `formantTrack`, `formantErrors`, `editDistance` and `tokenize` are
exported too.

Mel-cepstral distortion depends on how the cepstrum is computed (here: 26 mel
filters, 13 coefficients, 16 kHz). Values are comparable inside this project
and only roughly with published ones. In particular this cepstrum is taken
from the natural logarithm of the filter energies (power, not amplitude) with
an orthonormal DCT, so its values are larger than those of tools that use the
SPTK mel-generalised cepstrum: the female and the male preset head saying the
same sentence on the `minimal` tier are 47 to 52 dB apart here, and two
renderings with seeds 1 and 2 are 10 to 11 dB apart
(`node experiments/issue-19-voice-pairs.mjs`).

### Quality

[docs/reports/baseline-quality.md](docs/reports/baseline-quality.md) is the
first measurement of how far the synthetic voice is from human speech: every
sentence of the golden set (24 LibriVox recordings in English, Russian, Hindi
and Chinese) is rendered on every tier and compared with its recording by
`compareRecordings`, next to two anchors (the recording low-passed at 3.5 kHz,
and white noise). Three numbers of the
[run of 15 November 2026](https://github.com/konard/voice-simulator/actions/runs/43705076861)
sum it up. **MCD** of the best tier (`high`) is 68.0 dB (all tiers 68 to
73 dB), between 49.2 dB for `lowpass` and 89.7 dB for `noise`: the voice is
about halfway between a recording and noise. **Pitch** is the largest gap: the
f0 RMSE is about 630 cents and the gross pitch error about 53 % on every tier,
partly because every sentence is rendered with the female preset head while
the manifest does not record the sex of the speaker (`en-02` is more than an
octave off). **PER** of the
text front end is 9.0 % in English and 11.4 % in Russian and below 0.5 % in
Hindi and Chinese (against IPA that nobody has reviewed yet).
`node scripts/quality-report.mjs [--lang en --limit 2] [--baseline docs/reports/baseline-quality.json]`
measures again; a pull request that claims an improvement puts that table
into its description. The baseline itself is regenerated only by the
`quality` suite of the `Heavy checks` workflow.

### Listening tests

Only people can judge whether the voice sounds natural, so a blind listening
test is required before a claim about naturalness is written anywhere (the
README, a release note, a pull request or a report). Objective metrics such
as those of `compare` do not replace it.

[examples/listening-test/](examples/listening-test/README.md) is a page that
runs from a folder on disk, with no server and no network
(`Content-Security-Policy: connect-src 'none'`). It has three kinds of
trial: MUSHRA (ITU-R BS.1534-3: rate versions of a sentence from 0 to 100
against a reference, with a hidden reference and 3.5 kHz and 7 kHz
anchors), ABX (is X the same as A or as B?) and intelligibility (type what
you heard; scored by the word error rate).

```bash
node scripts/listening-test.mjs build --sentences examples/listening-test/sentences.example.json --out examples/listening-test
node scripts/listening-test.mjs sus --lang en --count 20 --seed 1    # sentences for intelligibility
node scripts/listening-test.mjs analyze results/*.json --out docs/reports/listening/<test id>/report.md
node scripts/listening-test.mjs --help
```

- At least 8 listeners take part; with fewer the report says that its
  numbers support no claim.
- The result files and the report are committed to
  `docs/reports/listening/<test id>/`.
- Listeners who rate the hidden reference below 90 in more than 15 % of
  their MUSHRA trials are dropped (BS.1534-3 post-screening).
- The result file holds no name, address or browser details. The start
  screen shows this consent sentence: "Your answers are saved in a file on
  this computer only. It holds your ratings, the time you spent on each
  trial, whether you use headphones and, if you give it, your native
  language; it holds no name, address or browser details. By pressing
  "Start" you agree that this file may be published as part of the results
  of the test."
- Audio of other synthesisers may be a condition, supplied by the tester
  through `extra` in the sentences file. It is never committed (`stimuli/`
  is ignored by git) and no code in this repository runs them.

### HTTP API and streaming

`voice-simulator serve` (or `createVoiceServer` from the separate
`voice-simulator/server` export, which keeps `node:http` out of browser
bundles) serves a small test page at `/` and these endpoints. Parameters can
be passed as a query string or as a JSON `POST` body.

| Endpoint               | Result                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `GET /api/health`      | `{ status, version }`                                         |
| `GET /api/languages`   | Supported languages with sample sentences                     |
| `GET /api/tiers`       | Audio and visual LOD tiers                                    |
| `GET /api/ipa`         | `text`, `lang`, `accent` → IPA transcription                  |
| `GET /api/timeline`    | `text`, `lang`, `accent` → word and syllable times            |
| `GET /api/visemes`     | `text`, `format` (arkit, vrm, oculus), `fps` → face animation |
| `GET /api/head/random` | `seed` → random head configuration                            |
| `GET /api/mesh.obj`    | `head`, `seed`, `lod` → OBJ model                             |
| `GET /api/synthesize`  | `text`, `lang`, `tier`, `seed`, `head`, `sampleRate` → WAV    |
| `GET /api/stream`      | Same parameters → chunked WAV that starts playing right away  |

Synthesis also accepts `accent` (`en-US`, `en-GB`, `en-AU`, `en-IN`),
`preset` (`male`, `female`, `child`, used with `head=random`), `micDistance`
(cm), `micAzimuth` and `micElevation` (degrees), `micCompensate`, `room` (a
preset name, or a `{width, height, depth, rt60}` object in a JSON body), and
the encoding: `format` (`wav`, `flac`, `aiff`, `au`, `raw`; `/api/stream`
streams `wav`, `au` and `raw`), `bitDepth` and `float`.

```bash
curl -o hello.wav "http://127.0.0.1:8080/api/stream?text=Hello&tier=medium"
```

### Docker

```bash
docker build -t voice-simulator .
docker run --rm -p 8080:8080 voice-simulator
```

The image runs `voice-simulator serve` on port 8080 with a health check on
`/api/health`.

### Quality tiers

| Audio tier  | Solver    | Detail        | Sample rate | Relative cost |
| ----------- | --------- | ------------- | ----------- | ------------- |
| `minimal`   | waveguide | 22 sections   | 22.05 kHz   | 1             |
| `low`       | waveguide | 32 sections   | 32 kHz      | 1.6           |
| `medium`    | waveguide | 44 sections   | 48 kHz      | 2.6           |
| `high`      | fdtd3d    | 1 cm voxels   | 48 kHz      | 10            |
| `ultra`     | fdtd3d    | 0.6 cm voxels | 48 kHz      | 65            |
| `studio`    | fdtd3d    | 0.5 cm voxels | 48 kHz      | 105           |
| `reference` | fdtd3d    | 0.4 cm voxels | 48 kHz      | 220           |

`studio` is the default of the library, the CLI and the server
(`DEFAULT_AUDIO_TIER`): full 3D acoustics whose 0.5 cm cells resolve the
incisors, the piriform fossae, the vallecula and transverse modes well
above 5 kHz. It renders about 12 times slower than real time on a desktop
CPU. The web app starts in Auto: it benchmarks the tiers on the CPU, then
the 3D tiers above the CPU's choice on WebGPU, and uses the most detailed
tier whose load stays under 80%, so a fast GPU gets the 3D tiers and a
laptop or phone the real-time waveguide. Every tier stays in the menu;
when a slower one is chosen, the app renders ahead: it shows the progress
and starts playback as soon as the rest of the utterance is predicted to be
ready before the player reaches it, so the voice never breaks up. Choose
`--tier medium` (or `tier: 'medium'`) for the real-time 1D waveguide.

The 3D tiers also run on the GPU: give `synthesizeAsync`,
`renderPlanAsync` or `new Fdtd3d` a WebGPU `device` (`requestGpuDevice()`
finds one). One workgroup runs a whole chunk of steps per dispatch, so the
field stays on the GPU and only the output samples come back. The web app
uses WebGPU whenever the browser offers it (Acoustics → Simulation turns it
off) and says the utterance again on the CPU if the GPU fails; the audio
meter shows `studio · fdtd3d · GPU` or `studio · fdtd3d`.

The GPU solver is checked against the CPU kernel in CI: the Deno test jobs on
macOS and Windows run `tests/fdtd-gpu.test.js` with `REQUIRE_GPU=1`, so a
missing adapter fails the job, and suite `gpu` of the `Heavy checks` workflow
(`npm run test:heavy -- --suite gpu`, which needs Deno) runs a 20 000-step
comparison and the word `həˈloʊ` at tiers `high` and `ultra` on Linux through
Mesa's software adapter. The last report is
[docs/reports/gpu-solver.md](docs/reports/gpu-solver.md).

The web app (`benchmarkAudioTiersAsync`) and `voice-simulator benchmark`
pick the most detailed tier whose measured load stays under 80%. On a
machine with WebGPU, the GPU is only tried for the 3D tiers above the CPU's
choice, so a slow integrated or software adapter never lowers it. The benchmark does not run tiers whose
load, predicted from the cheaper tier, is far above the target, and it stops
measuring a tier as soon as it is clearly too slow; the app remembers the
result per device. In the first 40-300 ms of each utterance an
`OverloadDetector` checks that the tier keeps up with real time and, if not,
the utterance restarts at once on a cheaper tier before any gap is audible.
While speaking, `LodGovernor` steps down
immediately when the load exceeds the target and steps up only after a dwell
period when the next tier is predicted to fit with margin. Visual tiers
(mesh LOD 0-3, pressure-field points) are governed the same way from the
measured frame time.

### Voice source

`source: 'lf'` (`DEFAULT_SOURCE`, CLI `--source lf`) draws every glottal
pulse with the LF model (Fant, Liljencrants and Lin 1985) at the pitch of
the plan. `source: 'folds'` (CLI `--source folds`) simulates the vocal folds
instead: `VocalFolds` in
[`src/acoustics/folds.js`](src/acoustics/folds.js) is the symmetric
two-mass model of Steinecke and Herzel (1995), a simplified form of
Ishizaka and Flanagan (1972), in cgs units at 44100 inner steps per second.
The air from the lungs pushes the lower mass of each fold apart, the folds
close again on their springs and collide, and the flow through the glottis
follows Bernoulli; the source is the derivative of that flow. Any other
value throws `Unknown source: <value>`.

The plan drives the folds with three channels: `lungPressure`
(`head.lungPressure * loudness ** (2 / 3)`, default 800 Pa), `adduction`
(0 open, 0.5 modal, 1 pressed; lower in breathy voice and `h`, 1 in a
glottal stop) and `foldTension` (the factor Q of Ishizaka and Flanagan).
`tensionForPitch(f0, lungPressure, head)` finds the tension for the pitch
of the plan from a table of simulated pitches, so the voice keeps its
intonation. The head parameters `lungPressure`, `foldLength`, `foldMass`,
`foldStiffness` and `foldDamping` (group `source`) set the larynx; the
presets give men 1.4 to 1.6 cm long folds, women 0.9 to 1.1 cm and children
0.6 to 0.8 cm (Titze 1989).

Measured with constant controls and no noise
([experiments/issue-11-folds.txt](experiments/issue-11-folds.txt),
`node experiments/issue-11-folds.mjs`):

- the folds start by themselves above 125 Pa and reach 1 % of their
  amplitude at 800 Pa from 175 Pa (the phonation threshold; people need
  about 200 to 500 Pa, Titze 1988);
- the pitch at 800 Pa is 65.6, 147.5, 278.8 and 549.2 Hz for Q 0.5, 1, 2
  and 4;
- the open quotient falls from 0.88 to 0.56 and H1-H2 from 7.7 to 2.3 dB
  when the adduction rises from 0.3 to 0.9;
- doubling the pressure from 800 to 1600 Pa raises the level by 8.6 dB
  ([experiments/issue-33-folds-tests.txt](experiments/issue-33-folds-tests.txt)).

The folds reach half of their steady amplitude 14 ms after the pressure is
on, and the flow is below 1 % of it 20 ms after the pressure is off. With
the CLI `match` of a rendered word the pitch of the folds is 2.5 % from
that of LF, and tier `medium` renders it as fast as LF
([experiments/issue-33-folds-match.txt](experiments/issue-33-folds-match.txt),
[experiments/issue-33-folds-speed.txt](experiments/issue-33-folds-speed.txt)).
LF stays the default and renders bit for bit as before.

### Development

```bash
# Install dependencies
bun install

# Run tests
bun test --timeout 30000

# Or with other runtimes:
npm test
deno test -A --parallel

# Lint code
bun run lint

# Format code
bun run format

# Check all (lint + format + file size)
bun run check

# Optional: build the Rust engine into src/engine/voice-simulator.wasm
# (needs rustup; without cargo it prints a note and the JavaScript engine is used)
npm run build:wasm

# Build the web app
npm install --prefix examples/universal-app
npm run example:web:build
npm run example:desktop:package
```

## Project Structure

```
.
├── bin/voice-simulator.js # CLI
├── crates/                # Rust engine: core (no_std), wasm (vs_* exports), cli
├── Cargo.toml             # Rust workspace (Cargo.lock, rust-toolchain.toml)
├── datasets/              # Speech dataset registry (data is fetched, never committed)
├── Dockerfile             # Server image
├── docs/case-studies/     # Research, requirements and plans
├── examples/
│   ├── basic-usage.js     # Library example
│   ├── listening-test/    # Blind listening test page (MUSHRA, ABX, intelligibility)
│   └── universal-app/     # Web app (GitHub Pages, Electron, Capacitor)
├── experiments/           # Measurement and debugging scripts
├── scripts/               # Repository tools (listening-test.mjs, golden.mjs, ...)
├── src/
│   ├── g2p/               # Text normalisation, accents, text to IPA
│   ├── ipa/               # IPA parsing, phone inventory, syllables
│   ├── articulation/      # Plan, prosody, timeline and tract shapes
│   ├── geometry/          # Head model, centrelines and meshes
│   ├── animation/         # ARKit, VRM and Oculus face animation
│   ├── acoustics/         # Glottis, waveguide, voxel model, 3D FDTD,
│   │                      # microphone and room
│   ├── analysis/          # Voice features and voice matching
│   ├── metrics/           # Objective speech metrics and recording comparison
│   ├── perf/              # Benchmarks and LOD governor
│   ├── audio/             # WAV, FLAC, AIFF, AU, raw and resampling
│   ├── server/            # HTTP API (voice-simulator/server)
│   ├── engine/            # WebAssembly loader of the Rust engine (the .wasm is built, never committed)
│   ├── index.js           # Library entry point
│   └── index.d.ts         # TypeScript definitions
└── tests/                 # test-anywhere tests (Node, Bun, Deno)
    └── fixtures/golden/   # 24 public-domain sentences with text and IPA
```

## Design Choices

### Multi-Runtime Support

The library and its tests run on Node.js, Bun and Deno:

- **Bun**: native test support (`bun test`)
- **Node.js**: built-in test runner (`node --test`)
- **Deno**: `deno test`

The [test-anywhere](https://github.com/link-foundation/test-anywhere) framework provides a unified testing API that works identically across all runtimes.

### Web App Example

`examples/universal-app` is a Vite React app that imports the library from
`src/index.js`. The same static build is used by:

- GitHub Pages (`npm run example:web:build`)
- Electron desktop packaging (`npm run example:desktop:package`)
- Capacitor Android/iOS sync (`npm run example:mobile:sync`)

The app has its own `package.json` and lockfile so React, three.js, Electron
and Capacitor stay out of the library package.

See [examples/universal-app/README.md](examples/universal-app/README.md) for
local web, desktop, Android, and iOS testing instructions.

### Code Quality

- **ESLint**: Configured with recommended rules + Prettier integration
- **Prettier**: Consistent code formatting
- **Husky + lint-staged**: Pre-commit hooks ensure code quality
- **File size limit**: Files must stay under 1500 lines for maintainability (enforced via ESLint and CI)

### Release Workflow

The release workflow uses [Changesets](https://github.com/changesets/changesets) for version management:

1. **Creating a changeset**: Run `bun run changeset` to document changes
2. **PR validation**: CI checks for valid changeset in each PR
3. **Automated versioning**: Merging to `main` triggers version bump
4. **npm publishing**: Automated via OIDC trusted publishing (no tokens needed)
5. **Optional Docker Hub publishing**: When configured, waits for the exact npm version and tags the Docker image with that version
6. **GitHub releases**: Auto-created with formatted release notes

> **First release of a brand-new package**: OIDC trusted publishing cannot
> create a package that does not exist yet (the first publish fails with
> `E404`, because a trusted publisher can only be configured for an existing
> package). To bootstrap, add a repository secret named `NPM_TOKEN` (a
> granular/automation token with publish access). The release workflow passes
> it as `NODE_AUTH_TOKEN` automatically. Once the package exists and OIDC
> trusted publishing is configured on npmjs.com, the token becomes optional and
> can be removed.

#### Manual Releases

Two manual release modes are available via GitHub Actions:

- **Instant release**: Immediately bump version and publish
- **Changeset PR**: Create a PR with changeset for review

### CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/release.yml`) implements a fast-fail pipeline:

**Fast checks** (~7-30s each, run first for fastest feedback):

1. **Test compilation**: Syntax-checks all `.mjs` files with `node --check`
2. **Lint, format & secrets scan**: ESLint, Prettier, jscpd, and [secretlint](https://github.com/secretlint/secretlint) for credential leak detection, plus the policy check (`npm run check:policy`: no neural network libraries or model files, permissive licences only; see [Policy check](docs/CONTRIBUTING.md#policy-check))
3. **File line limits**: Enforces the 1500-line limit on JavaScript (`.js`, `.mjs`, `.cjs`) and Markdown (`.md`) files plus `release.yml`
4. **Changeset check**: Validates PR has exactly one changeset (added by that PR)
5. **Version check**: Blocks manual version changes in `package.json`
6. **Documentation validation**: Checks required doc files (doc line limits are enforced by the file line limits check)

**Slow checks** (only run after all fast checks pass):

7. **Test matrix**: 3 runtimes × 3 OS = 9 test combinations
   - **Rust engine** (job `rust`): `cargo fmt`, `cargo clippy -D warnings`, `cargo test`, the WebAssembly build with its size budget and the Rust-against-JavaScript parity tests; the release jobs publish the file it builds (see [RUST-ENGINE.md](docs/RUST-ENGINE.md))
8. **Broken link checks**: Validates all links in Markdown/HTML files (separate workflow)

**Release** (on merge to main):

9. **Changeset merge**: Combines multiple pending changesets at release time
10. **Release**: Automated versioning and npm publishing
11. **Optional Docker publish**: Publishes Docker Hub `latest` and npm-version tags after the npm package is visible

#### Reasonable Timeouts

Every CI job declares an explicit `timeout-minutes` so hung steps fail
in minutes instead of reaching the GitHub Actions default of six hours.
Fast checks use 5-10 minute caps, release jobs use 50 minutes, and the
link checker uses 10 minutes for external network variance.

That cap is a backstop, never the deadline: GitHub reports a job it
kills as **cancelled**, not **failed**. Long steps therefore own an
explicit budget via `scripts/run-with-budget-warning.sh`, which warns at
70% of the budget and fails the step with exit code 124 when it expires.
See [CI-TIMEOUT-BUDGETS.md](docs/CI-TIMEOUT-BUDGETS.md).

Individual tests are also capped inside supported runners:
`npm test` runs `node --test --test-timeout=30000`, and the CI Bun
runner uses `bun test --timeout 30000`. Both bound a _single test_, not
the suite, which is why the suite budget above exists. Deno does not
provide a single global per-test timeout flag, so Deno tests are
protected by their step budget and the matrix job backstop.

See [BEST-PRACTICES.md](docs/BEST-PRACTICES.md) for detailed explanations of each practice.

#### Robust Changeset Handling

The CI/CD pipeline is designed to handle concurrent PRs gracefully:

- **PR Validation**: Only validates changesets **added by the current PR**, not pre-existing ones from other merged PRs. This prevents false failures when multiple PRs merge before a release cycle completes.

- **Release-time Merging**: If multiple changesets exist when releasing, they are automatically merged into a single changeset with:
  - The highest version bump type (major > minor > patch)
  - All descriptions preserved in chronological order

This design decouples PR validation from the need to pull changes from the default branch, reducing conflicts and ensuring that even if CI/CD fails, all unpublished changesets will still get published when the error is resolved.

### Deploying the example app

The `example-app.yml` workflow deploys the voice simulator web app to GitHub
Pages on every push to `main`. Before the first run on `main`, open **Settings → Pages** and set
**Source = GitHub Actions**. This is a one-time manual step and cannot be
configured from a workflow because the Pages source defaults to
_Deploy from a branch_. Without it, the `pages-deploy` job fails on
`actions/deploy-pages` with `Get Pages site failed` /
`Failed to create deployment`. After flipping the source, the workflow
provisions the Pages site on its first run.

`scripts/check-pages.sh` checks the setting before the build: pull requests
get a warning, and `main` fails with the settings link until the source is
GitHub Actions. The `web-build` job grants `pages: read` explicitly because the
Pages API answers a request it does not authorise with the same 404 as a
disabled site.

### Enabling dependency review

`actions/dependency-review-action` needs the repository's **Dependency graph**,
which only a maintainer can enable: **Settings → Advanced Security →
Dependency graph → Enable**. Until it is enabled, the Security workflow skips
dependency review on pull requests with a warning, and its
`Dependency graph enabled` job fails on `main` with the same instruction
(`scripts/check-dependency-graph.sh`).

### Auto-regenerated preview screenshots

The same `example-app.yml` workflow contains a `preview-regen` job that boots
the built example app in a headless Chromium via
[`browser-commander`](https://www.npmjs.com/package/browser-commander) +
Playwright and writes fresh screenshots to
`docs/screenshots/example-app/example-app-{locale}-{theme}.png` on every
push to `main` (and on `workflow_dispatch`). Any drift is committed back to
`main` so README/site images never go stale between releases. Screenshot-only
pushes do not match this workflow's path filter, while a protected-branch
fallback PR remains eligible for its required checks. The job runs in the
official Playwright container with the browser already installed, avoiding CI
stalls from live Chromium downloads.

The same script is available locally:

```bash
npm install --prefix examples/universal-app
npm run example:web:preview-images
# Verbose probe of <html data-theme>, <html lang>, and PNG signatures:
PREVIEW_VERBOSE=1 npm run example:web:preview-images
```

The matrix covers `{en, ru} × {light, dark}`; the app follows the browser
language and the stored theme. Each tile opens the app with `?seed=preview`
so the random head is the same in every run. Set `PREVIEW_CHROMIUM` to a
Chromium binary when the locally installed browser build differs from the
pinned Playwright release.

### Broken Link Checker

The link checker workflow (`.github/workflows/links.yml`) validates all links in Markdown and HTML files:

1. **Detection**: Uses [lychee](https://github.com/lycheeverse/lychee-action) to scan all `*.md` and `*.html` files
2. **Web Archive fallback**: For any broken links found, automatically checks the [Wayback Machine](https://web.archive.org) for archived versions
3. **Actionable suggestions**: Reports one of three outcomes for each broken link:
   - **Archived**: Suggests the Web Archive URL as a replacement
   - **Not archived**: Clearly reports the link is unrecoverable
4. **Scheduled checks**: Runs weekly to catch links that break over time (even if no files changed)
5. **Issue creation**: On scheduled runs, creates a GitHub Issue with the full broken links report

Add regex patterns to `.lycheeignore` to exclude URLs from checks (e.g., local dev URLs, example.com, known rate-limited sites).

## Configuration

### Package Name

The package is published as `voice-simulator` (see `package.json`). Release
scripts derive the package name from `package.json` at runtime, so renaming
the package only needs `package.json` and `.changeset/config.json`.

### Protected-Branch Release Pull Requests

If `main` requires pull requests and the `Pipeline Status` check, the release
and instant-release jobs can use their built-in `GITHUB_TOKEN` to open a release
PR. Enable **Allow GitHub Actions to create and approve pull requests** in
repository Actions settings. The helper verifies that the version commit is a
direct child of the validated workflow SHA and contains only package metadata
and consumed changesets. It then creates a successful `Pipeline Status` check
on that exact commit, linked to the validating run, waits for every required
check, and merges the PR only after they pass. The release jobs alone receive
`checks: write`. Set `RELEASE_METADATA_PATHS` to a comma-separated list of
additional exact metadata paths for other package layouts.

An optional `RELEASE_PR_TOKEN` secret keeps the existing dedicated-token path
and takes precedence when set. Give that actor Contents and Pull requests write
access and Checks read access. The manual changeset-PR and generated-preview
paths still require the dedicated token. A short-lived GitHub App installation
token can be wired to the same inputs instead of a PAT.

### Optional Docker Hub Publishing

Pull requests build the server image from the `Dockerfile` as a check.
Publishing to Docker Hub is disabled by default. To enable it, configure these
GitHub Actions settings:

| Setting              | Type               | Description                                                                           |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| `DOCKERHUB_IMAGE`    | Variable           | Docker Hub image name, for example `namespace/image`. This enables Docker publishing. |
| `DOCKERHUB_USERNAME` | Variable           | Docker Hub username used by `docker/login-action`.                                    |
| `DOCKERHUB_TOKEN`    | Secret             | Docker Hub access token used for registry authentication.                             |
| `DOCKER_CONTEXT`     | Variable, optional | Docker build context. Defaults to `.`.                                                |
| `DOCKERFILE`         | Variable, optional | Dockerfile path. Defaults to `./Dockerfile`.                                          |

When enabled, the release workflow waits until the exact published npm version
is visible in the npm registry, then publishes Docker Hub tags for `latest` and
that same version. The Docker build also receives `NPM_PACKAGE_VERSION` as a
build argument so Dockerfiles can install the matching published package.

### ESLint Rules

Customize ESLint in `eslint.config.js`. Current configuration:

- ES Modules support
- Prettier integration
- No console restrictions (common in CLI tools)
- Strict equality enforcement
- Async/await best practices
- **Strict unused variables rule**: No exceptions - all unused variables, arguments, and caught errors must be removed (no `_` prefix exceptions)

### Prettier Options

Configured in `.prettierrc`:

- Single quotes
- Semicolons
- 2-space indentation
- 80-character line width
- ES5 trailing commas
- LF line endings

## Scripts Reference

| Script                               | Description                                           |
| ------------------------------------ | ----------------------------------------------------- |
| `bun test --timeout 30000`           | Run tests with Bun and a 30s per-test cap             |
| `npm test`                           | Run tests with Node.js and a 30s per-test cap         |
| `npm run test:heavy`                 | Run the slow tests of `tests/heavy/` (CONTRIBUTING)   |
| `npm run datasets -- list`           | List, fetch or verify speech datasets (CONTRIBUTING)  |
| `node scripts/golden.mjs verify`     | Check the golden set of `tests/fixtures/golden/`      |
| `node scripts/quality-report.mjs`    | Score the tiers against the golden set (Quality)      |
| `bun run lint`                       | Check code with ESLint                                |
| `bun run lint:fix`                   | Fix ESLint issues automatically                       |
| `bun run format`                     | Format code with Prettier                             |
| `bun run format:check`               | Check formatting without changing files               |
| `bun run check`                      | Run all checks (lint + format)                        |
| `npm run example:web:dev`            | Start the universal app Vite dev server               |
| `npm run example:web:build`          | Build the universal app static web bundle             |
| `npm run example:web:preview-images` | Regenerate preview screenshots via browser-commander  |
| `npm run example:desktop:package`    | Package the Electron desktop app locally              |
| `npm run example:mobile:sync`        | Build and sync the app bundle into Capacitor projects |
| `npm run build:wasm`                 | Build the Rust engine into `src/engine/` (optional)   |
| `bun run changeset`                  | Create a new changeset                                |

## Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed contribution guidelines.

Quick steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Create a changeset: `bun run changeset`
5. Commit your changes (pre-commit hooks will run automatically)
6. Push and create a Pull Request

## Best Practices

This repository implements CI/CD best practices for AI-driven development. See [BEST-PRACTICES.md](docs/BEST-PRACTICES.md) for details on:

- File size limits for AI readability
- Automated formatting and linting
- Multi-runtime and cross-platform testing
- Changeset-based versioning
- Concurrency control for CI/CD pipelines

## License

[Unlicense](LICENSE) - Public Domain
