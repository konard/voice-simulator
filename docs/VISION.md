# Vision

voice-simulator is a physical model of the human voice that works in both
directions:

```
text in a language  ->  IPA  ->  articulation  ->  sound      (speaking)
text in a language  <-  IPA  <-  articulation  <-  sound      (listening)
```

Speaking simulates the air in a human head. Listening runs the same simulation
in reverse: it finds the head, the voice and the movements that would have
produced the sound it hears, and reads the speech off those movements. Nothing
is recorded and nothing is learned by a neural network. The project is in the
public domain and is a gift to everyone.

This document is the single statement of where the project is going. It is
updated by every pull request that changes the direction; the history is at the
end. The step-by-step plan that implements it is [ROADMAP.md](ROADMAP.md).

## Principles

These are rules, not preferences. A change that breaks one of them is not
merged.

1. **Physics and mathematics only.** Sound comes from simulated air, folds,
   walls and turbulence. Recognition comes from inverting that simulation.
   No neural network is used anywhere: not in the library, not in the app,
   not in the tests and not in the tools that build the data tables. No
   recorded speech is played back or concatenated. The exact boundary is in
   [What counts as a neural network](#what-counts-as-a-neural-network).
2. **One model, two directions.** Speaking and listening share the same head,
   the same articulation channels, the same IPA inventory and the same
   prosody rules. A feature is finished when it works both ways: whatever the
   simulator can say, it can recognise, and every mode of speech it detects, it
   can produce.
3. **Always through IPA.** Text is never mapped to sound directly, and sound
   is never mapped to text directly. Speaking is text in a language → IPA →
   audio. Listening is audio → IPA → the language, or the mix of languages,
   → text. IPA with its tone, stress, length and voice-quality marks is the
   interchange format between every stage and between the two directions.
4. **The highest quality the device can afford, never silence.** The most
   accurate simulation is the reference. Every device gets the most detailed
   variant it can run in real time, measured on that device in the background,
   and the quality steps down while speaking the moment the device falls
   behind. The same holds for listening.
5. **It works at the bottom too.** Synthesis, recognition and voice copying
   all work at the lowest settings: narrow-band audio, the cheapest solver, one
   CPU core. More cores, a GPU and higher settings make it better, never make
   it possible.
6. **Everything that changes a voice is a parameter.** Anatomy, the vocal
   folds, breathing, articulation habits, accent and expression are numbers
   with physical units, documented ranges and sources. A voice is a set of
   those numbers, so it can be edited, saved, copied from a recording and
   compared.
7. **Measured against real speech.** Claims of quality are backed by numbers
   computed on public recordings of real people with transcripts, by
   algorithms that are themselves free of neural networks, and by listening
   tests with people. A claim that was not measured is written as a goal.
8. **Reproducible.** The same input, seed and settings give the same samples
   on every runtime. Results of experiments are committed with the script
   that produced them.
9. **Public domain.** The code is released under the Unlicense. Data that is
   committed to the repository is public domain or CC0. Dependencies have
   permissive licences. Anything else is fetched at test time and never
   redistributed.

## What the system does when the vision is reached

### Speaking

- Reads text in every supported language, normalises it, converts it to IPA
  and speaks it with a voice that people cannot tell from a recording of a
  person in a blind listening test. That is the meaning of "state of the art"
  here, and it is a goal, not a current claim.
- Speaks in every common mode of speech: statements, all kinds of questions,
  exclamations, commands, lists and asides; lexical tones and pitch accents;
  word stress and rhythm; regional and foreign accents; soft, normal, loud and
  shouted speech with gradual changes of loudness; whisper, breathy, creaky,
  pressed and falsetto voice; emotions and attitudes; breaths, laughter, sighs
  and hesitations.
- Simulates the voice source as a physical system (vocal folds driven by lung
  pressure, coupled to the air below and above them), the turbulence at
  constrictions, the losses in the walls and the radiation from the mouth and
  nose, in 1D for speed and in full 3D for accuracy.
- Highlights every syllable in the text at the moment it is spoken.

### Listening

- Takes a recording or a live microphone and returns IPA with times, the
  language or languages spoken, and the text, using the simulation in reverse.
- Recognises the same modes of speech that it can produce and writes them
  down with the same marks: tones, stress, sentence type, loudness, whisper
  and other voice qualities, emotion.
- Highlights every syllable as it is recognised.

### Copying a voice

- Works in several passes that feed each other. The first pass fits the
  configuration of the voice: the size and shape of the head, the vocal folds,
  the habits of articulation. The second pass inverts the simulation with
  that configuration to recover the movements and the phonemes. As the person
  keeps speaking both estimates are refined until they are stable. From then
  on the system holds a voice it can speak with and a recogniser tuned to that
  speaker, and it can follow what the person says.
- Reproduces a real recording: the copy says the same words with the same
  timing, melody and voice quality, close enough to be measured against the
  original.

### Running everywhere

- The simulation core is written in Rust. In browsers it runs as WebAssembly
  in a background worker and is the default engine; the same core runs natively
  in the command line tool and the server. The JavaScript implementation stays
  as the readable reference and as the fallback.
- A short benchmark runs in the background when the page loads, without sound
  and without blocking the interface, and decides the precision for this
  device. While speaking, the quality follows the measured load and changes
  without a click or a gap.
- It uses all CPU cores when the platform allows it and works on one core
  when it does not.
- Expensive tests (full 3D renders, recognition of datasets, voice copying)
  run in manually triggered GitHub Actions workflows; the tests that run on
  every pull request stay fast.

## What counts as a neural network

Not allowed, in the product, the tests, the build tools and the continuous
integration:

- Artificial neural networks of any kind and size (perceptrons, convolutional,
  recurrent, transformer and diffusion models), whether trained by this project
  or downloaded.
- Libraries whose purpose is to run or train them.
- Scoring our output with neural models (for example neural speech recognisers
  or neural quality predictors).

Allowed:

- Physical simulation and its inversion.
- Closed-form mathematics and signal processing: Fourier and linear-prediction
  analysis, filters, cepstra, autocorrelation.
- Search and optimisation: dynamic programming, Viterbi decoding, least
  squares, gradient descent on the parameters of the physical model,
  derivative-free and evolutionary optimisers, Kalman and particle filters.
- Tables with a documented source: pronunciation dictionaries, measured
  anatomical dimensions, vowel formants, and counts taken from public text or
  recordings (for example how often one phoneme follows another). Every table
  is small enough to read, is produced by a committed script and names its
  data.
- Calibrating the constants of the rules and of the physical model against
  recordings by optimisation.

Neural systems remain the yardstick. Their published scores are quoted, and
their audio may be one of the samples in a listening test with people. They
are never a component.

## Where the project is today

Version 0.11 speaks; it does not listen yet.

| Area               | Today                                                                                                      | Gap to the vision                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Languages          | English, Russian, Hindi and Mandarin Chinese to IPA, with text normalisation; four English accents         | Small dictionaries: wrong stress and wrong readings of words spelled alike; accents for English only                     |
| Prosody            | Pauses, final pitch movements and lengthening from punctuation; lexical tones from start and end level     | No model of intonation per language, no focus or emphasis, tones lose their middle target, no expressive modes           |
| Voice source       | Liljencrants-Fant pulse with tenseness, breathiness, jitter, shimmer, vibrato and a glottal chink          | No simulated vocal folds, no lung pressure, no whisper, creak or falsetto, no coupling of the source to the tract        |
| Acoustics          | 1D waveguide in real time; sparse-voxel 3D FDTD (WebAssembly kernel, optional WebGPU) at 1 to 0.4 cm       | The 3D default is about 12 times slower than real time on a CPU; frequency-dependent losses and noise sources are simple |
| Configuration      | 33 head and voice parameters, three presets                                                                | Folds, breathing, expression and articulation habits are not parameters yet                                              |
| Performance        | JavaScript engine in a Web Worker, start-up benchmark, restart on a cheaper tier in the first 40-300 ms    | No Rust engine, one core only, no change of quality in the middle of an utterance, lowest tier is 22.05 kHz              |
| Listening          | `analyzeVoice` measures pitch, formants, tilt, noise and rate; `matchVoice` fits six parameters            | No recognition of phonemes, language or text; voice matching was tested on synthetic recordings only                     |
| Syllable highlight | While speaking, from the planned timeline                                                                  | Not for recognition                                                                                                      |
| Evidence           | Formant checks against Hillenbrand et al. (1995) and Story (2008); anatomy checked against MRI and atlases | No test on recordings of running speech, no listening test                                                               |

The measurements behind this table, the full list of requirements and the
research are in the case studies:
[issue 1](case-studies/issue-1/README.md) (the prototype),
[issue 5](case-studies/issue-5/README.md) (precision),
[issue 9](case-studies/issue-9/README.md) (quality) and
[issue 11](case-studies/issue-11/README.md) (this vision).

## How quality is judged

- **Speaking.** Distance between a synthesised sentence and a real recording
  of the same sentence: spectral distortion, pitch and formant error, timing
  of syllables. Intelligibility measured by people and by our own recogniser.
  Naturalness measured by people in blind comparisons that include real
  recordings and other synthesisers. The first measurement of the spectral,
  pitch, formant and timing distances on the golden set is
  [reports/baseline-quality.md](reports/baseline-quality.md); later work
  compares itself with it (`scripts/quality-report.mjs --baseline`).
- **Listening.** Phoneme, syllable, word and character error rates on public
  recordings with transcripts, per language and per audio setting, including
  the lowest one. Language identification accuracy, including mixed speech.
- **Copying.** Error of the recovered parameters on synthetic recordings
  where the truth is known, and distance between the copy and the original on
  real recordings.
- **Round trip.** What the simulator says, it must recognise: text → audio →
  text returns the input in every language, mode and tier.
- **Speed.** Real-time factor of every tier per device class, time to first
  sound, and the cost of the load-time benchmark.

Every number is reported with the script, the data and the commit that
produced it.

## Not goals

- Neural text-to-speech or speech recognition, or wrapping existing engines.
- Playing back, concatenating or morphing recorded speech.
- Diagnosis or treatment of voice disorders. The simulator can model unusual
  voices, but it is not a medical device.
- Impersonating a real person without their consent. Voice copying exists to
  let people use and study their own voices and public-domain recordings.

## History of the vision

| Issue                                                      | What it added                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/konard/voice-simulator/issues/1)   | A physical 3D voice simulator instead of a recording- or network-based one: text → IPA → articulation → waves in a low-poly head; four languages; library, command line, server and one app for every platform      |
| [#5](https://github.com/konard/voice-simulator/issues/5)   | Precision everywhere: teeth, tongue and palate; microphone and room; every parameter that changes the sound; presets; copying a voice from a recording; audio formats; punctuation; accents; syllable highlighting  |
| [#9](https://github.com/konard/voice-simulator/issues/9)   | Full 3D acoustics by default, quality chosen per device, female and child voices that sound right, anatomy checked against real data                                                                                |
| [#11](https://github.com/konard/voice-simulator/issues/11) | State of the art without neural networks; the reverse direction (audio → IPA → language → text); multi-pass voice copying; Rust engine; quality that adapts while streaming; all modes of speech in both directions |

One recommendation of the issue 9 case study is withdrawn. It proposed to
learn the control of the articulators with a sequence model and to add a small
neural residual to the output, and to score the result with neural recognisers
and neural quality predictors. Issue 11 rules neural networks out. The gap that
recommendation addressed is real, namely that the control of the voice, its
prosody and its source matter more than the acoustics of the tract. It is now
closed by rules and physical models whose constants are calibrated against
real recordings by optimisation, and it is measured by the methods in
[How quality is judged](#how-quality-is-judged).
