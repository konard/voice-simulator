---
id: P06
title: Objective speech metrics and a `compare` command
type: Feature
milestone: M0
blocked_by: []
requirements: [R1, R8, R18]
---

## Goal

Add a module `src/metrics/` that measures how far one recording is from
another (spectrum, pitch, formants, timing) and how far one transcript is from
another (phoneme, word and character error rates), and a command
`voice-simulator compare a.wav b.wav`. Everything is plain mathematics in
JavaScript with no dependency.

## Why

The vision says quality is "measured against real speech" by "algorithms that
are themselves free of neural networks". Today the project cannot put a
number on the distance between its output and a recording of a person, so no
issue can prove that it made the voice better. Every later quality issue
({{P07}}, {{P26}}, {{P64}}, {{P67}}) reports numbers from this module.

## Current state

- `src/analysis/voice-features.js` exports `analyzeVoice()` (one median value
  per recording for pitch, formants, tilt, noise), `yinPitch(signal, start,
length, sampleRate)` (YIN pitch of one frame, 60-600 Hz, returns
  `{f0, aperiodicity}`), `resample()`, `median()` and `ANALYSIS_RATE = 11025`.
- `src/acoustics/analysis.js` exports `lpcCoefficients()`, `lpcEnvelope()` and
  `estimateFormants(samples, sampleRate, {start, duration, order, count})`.
- `src/analysis/voice-match.js` has `featureDistance()`, a distance between
  two sets of median features. It does not compare frame by frame.
- `decodeAudio(bytes)` in `src/audio/formats.js` reads WAV, FLAC, AIFF and AU
  and returns `{sampleRate, samples, ...}`; `resample(samples, from, to)` is
  in `src/audio/resample.js`.
- There is no Fourier transform, no mel filter bank, no dynamic time warping
  and no edit distance in `src/` (`grep -rniE "fft|dtw|levenshtein" src`
  prints nothing).
- The command line tool (`bin/voice-simulator.js`, object `COMMANDS`) has
  `ipa`, `say`, `convert`, `timeline`, `visemes`, `head`, `mesh`, `match`,
  `benchmark` and `serve`. There is no `compare`.

## What to do

Create these files (each under 400 lines) and export the public functions from
`src/metrics/index.js`, `src/index.js` and `src/index.d.ts`.

Common settings, exported as `METRIC_DEFAULTS`: analysis rate `16000` Hz,
window `0.025` s (Hann), hop `0.01` s, FFT size: the next power of two that is
not smaller than the window in samples (512 at 16000 Hz), floor
`EPSILON = 1e-10`.

1. `src/metrics/spectrum.js`
   - `fft(re, im)`: in-place radix-2 transform of two `Float64Array`s whose
     length is a power of two; throw otherwise. If `src/recognition/fft.js`
     of {{P46}} exists already, do not write a second transform: call its
     `createFft(size).forward(re, im)` and keep one object per size in a
     `Map`. Otherwise {{P46}} makes that change.
   - `powerFrames(samples, sampleRate, options)`: list of `Float64Array`
     power spectra `P[k] = re[k]^2 + im[k]^2` for `k = 0 .. size/2`.
   - `melFilterbank(count, size, sampleRate)`: `count` triangular filters
     with centres equally spaced on the mel scale
     `mel(f) = 2595 * log10(1 + f / 700)` between 0 Hz and `sampleRate / 2`;
     each filter rises linearly from the centre of the previous one to 1 at
     its own centre and falls to 0 at the next centre.
   - `mfcc(samples, sampleRate, options)`: for each frame
     `L[m] = ln(max(E[m], EPSILON))` with `E[m]` the filter energy, `M = 26`
     filters, then
     `c[n] = sqrt(2 / M) * sum_{m=1..M} L[m] * cos(pi * n * (m - 0.5) / M)`
     for `n = 0 .. 13`.
2. `src/metrics/dtw.js`: `dtw(a, b, {distance, band})`.
   - `a` and `b` are lists of vectors; `distance` defaults to the Euclidean
     distance.
   - `D(i, j) = d(i, j) + min(D(i-1, j), D(i, j-1), D(i-1, j-1))`,
     `D(0, 0) = d(0, 0)`.
   - `band` (0 to 1, default 1 = no limit): a cell is allowed when
     `|i / (n - 1) - j / (m - 1)| <= band`.
   - Throw `RangeError` when `n * m > 25e6`.
   - Return `{cost, normalizedCost, path}` where `path` is a list of
     `[i, j]` from `[0, 0]` to `[n-1, m-1]` and
     `normalizedCost = cost / path.length`. When several predecessors have
     the same cost, prefer the diagonal, then `(i-1, j)`, then `(i, j-1)`.
3. `src/metrics/distortion.js`. Both functions take
   `(reference, test, sampleRate, {path, normalize})`; `path` is a DTW path
   (default: pair frame `t` with frame `t` up to the shorter length).
   - `logSpectralDistance`: per pair
     `sqrt(mean_k (10*log10(Pr[k] + EPSILON) - 10*log10(Pt[k] + EPSILON))^2)`
     over `k = 1 .. size/2`; the result is the mean over pairs, in dB. With
     `normalize` (default `true`) both signals are first scaled to an RMS of
     0.1.
   - `melCepstralDistortion`: per pair
     `(10 / ln 10) * sqrt(2 * sum_{n=1..13} (cr[n] - ct[n])^2)`; mean over
     pairs, in dB. `c[0]` is left out, so the value does not depend on gain.
   - Both skip a pair when both frames are silent: frame power below the
     loudest frame of the same signal minus 40 dB.
4. `src/metrics/pitch.js`
   - `pitchTrack(samples, sampleRate, {hop, window})`: resample to
     `ANALYSIS_RATE`, call `yinPitch` every `hop` (0.01 s) on a window of
     0.04 s, and return a `Float64Array` with the pitch in Hz, or 0 when the
     frame is quieter than 10 % of the 95th percentile level or its
     aperiodicity is 0.35 or more (the rule `analyzeVoice` uses).
   - `f0Errors(reference, test)`: two tracks of equal length `N` (cut the
     longer one). `V` is the set of frames voiced in both. With
     `e = 1200 * log2(test / reference)` (cents):
     `rmseCents = sqrt(mean_V e^2)`, `meanCents = mean_V e`,
     `gpe = |{V : |test / reference - 1| > 0.2}| / |V|` (gross pitch error),
     `vde = (frames voiced in exactly one track) / N` (voicing decision
     error), `ffe = (gross errors + voicing errors) / N` (f0 frame error),
     `correlation` = Pearson correlation of `log(f0)` over `V`,
     `voicedFrames = |V|`. When `V` is empty the pitch values are `null`.
5. `src/metrics/formants.js`
   - `formantTrack(samples, sampleRate, {hop})`: `estimateFormants` with
     `duration: 0.03` and `count: 3` every 0.01 s; an entry is `null` for an
     unvoiced frame (use `pitchTrack`).
   - `formantErrors(reference, test)`: for F1, F2 and F3 the mean absolute
     difference in Hz and in percent of the reference, over frames that have
     formants in both: `{f1: {hz, percent}, f2, f3, frames}`.
6. `src/metrics/text.js`
   - `editDistance(reference, hypothesis)`: Levenshtein distance between two
     lists of tokens with cost 1 for a substitution, a deletion and an
     insertion. Return `{distance, substitutions, deletions, insertions}`.
     When tracing back prefer match or substitution, then deletion, then
     insertion.
   - `tokenize(text, unit)`: `unit` is `'word'` (Unicode NFC, lower case,
     characters of classes `\p{P}` and `\p{S}` removed, split on white
     space), `'char'` (the same, then white space removed, one token per
     code point) or `'phone'` (`parseIpa()` from `src/ipa/parse.js`; one
     token per vowel or consonant: its symbol with length mark and
     diacritics; stress marks, tone letters, pauses and boundaries are
     dropped).
   - `errorRate(reference, hypothesis, unit = 'word')`: strings or token
     lists; returns the fields of `editDistance` plus `referenceLength` and
     `rate = distance / max(1, referenceLength)`. Word, character and phoneme
     error rates (WER, CER, PER) are this function with the three units.
7. `src/metrics/compare.js`: `compareRecordings(reference, test, options)`
   where both are `{samples, sampleRate}`.
   1. Resample both to `min(16000, reference rate, test rate)`.
   2. Cut silence from both ends (frames more than 40 dB below the loudest).
   3. Scale both to an RMS of 0.1.
   4. Compute `mfcc` of both and `dtw` on the coefficients 1 to 13.
   5. Compute the metrics along the path: for tracks take the value of the
      test frame paired with each reference frame (first pair wins).
   6. Timing: for each pair, `d = j*hop - i*hop * (Tt / Tr)` with `Tt`, `Tr`
      the durations; `timing = {rmsSeconds: sqrt(mean d^2), maxSeconds}`.
   7. Return `{sampleRate, duration: {reference, test, ratio}, lsd, mcd, f0,
formants, timing, dtw: {normalizedCost}, frames}`.
8. `bin/voice-simulator.js`: command `compare <reference> <test>` with
   `--json`. It decodes both files with `decodeAudio`, calls
   `compareRecordings` and prints either the JSON or one line per metric, for
   example `MCD 7.31 dB`. Add it to `usage()`, to `README.md` and to the
   tests of the command line.

Use `Float64Array` for the sums and no random numbers, so the result is the
same on Node.js, Bun and Deno.

## Tests

Add `tests/metrics.test.js`:

- `fft finds a sine`: 512 samples of `sin(2*pi*8*n/512)`; bin 8 holds more
  than 99 % of the power of bins 1 to 255.
- `lsd of a signal with itself is zero` and
  `lsd without normalisation measures gain`: for one second of seeded noise
  `x` (`createRandom(1)`), `logSpectralDistance(x, x * 0.5, 16000,
{normalize: false})` is `6.02` ± `0.01` dB; with `normalize: true` it is
  below `0.01`.
- `mcd ignores gain`: `melCepstralDistortion(x, x * 0.5, 16000)` is below
  `1e-6`.
- `mcd grows with spectral change`: `x` against `x` filtered by
  `y[n] = x[n] + 0.9 * y[n-1]` gives more than 3 dB.
- `dtw aligns a stretched sequence`: `[0,1,2,3]` against `[0,1,1,2,3]`
  (one-element vectors) gives `cost` 0 and a path of length 5.
- `dtw respects the band`: with `band: 0` and equal lengths the path is the
  diagonal.
- `f0 errors on a known case`: reference `[100, 100, 0, 200]`, test
  `[100, 130, 100, 0]` gives `gpe` 0.5, `vde` 0.5, `ffe` 0.75, `rmseCents`
  `321.18` ± `0.01`, `voicedFrames` 2.
- `pitchTrack follows a glide`: a pulse train from 100 to 200 Hz over 1 s;
  the median error against the true pitch is below 2 %.
- `edit distance of kitten and sitting`: characters; `distance` 3,
  `substitutions` 2, `insertions` 1.
- `word error rate`: `errorRate('The cat sat on the mat.', 'the cat sit on
mat')` gives `rate` `0.3333` ± `0.0001`, 1 substitution, 1 deletion.
- `character error rate handles Chinese`: `errorRate('你好吗', '你好', 'char')`
  gives `rate` `0.3333` ± `0.0001`.
- `phoneme error rate ignores stress and tone`:
  `errorRate('ˈhɛloʊ', 'hɛloʊ', 'phone').rate` is 0.
- `compareRecordings of a rendering with itself`: `synthesize('Hello.',
{tier: 'minimal', seed: 1})` against itself gives `lsd`, `mcd`,
  `timing.rmsSeconds` equal to 0 and `f0.gpe` equal to 0.
- `compareRecordings separates voices`: the same text with `seed: 1` and with
  `seed: 2` plus `head: {pitch: 220}` gives `mcd > 1` and
  `f0.rmseCents > 300`.

Add to `tests/cli-audio.test.js`: `compare prints JSON` (two files written by
`say`, the output parses and has the keys `lsd`, `mcd`, `f0`, `timing`).

## Acceptance criteria

- [ ] `voice-simulator say "Hello." -t minimal -s 1 -o a.wav`, the same with
      `-s 2 -o b.wav`, then `voice-simulator compare a.wav b.wav --json`
      prints JSON with finite `lsd`, `mcd`, `f0.rmseCents`, `f0.ffe` and
      `timing.rmsSeconds`; `compare a.wav a.wav` prints zeros.
- [ ] Comparing two 5-second recordings takes less than 5 seconds on one core.
- [ ] All tests above pass on Node.js, Bun and Deno; no new dependency is
      added (`git diff main -- package.json` shows none).
- [ ] The functions `logSpectralDistance`, `melCepstralDistortion`,
      `f0Errors`, `formantErrors`, `dtw`, `editDistance`, `errorRate` and
      `compareRecordings` are exported from `src/index.js` and typed in
      `src/index.d.ts`.
- [ ] `README.md` has a section "Comparing recordings" with the formulas'
      names, units and the note below about comparability.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

Note for the README: mel-cepstral distortion depends on how the cepstrum is
computed (here: 26 mel filters, 13 coefficients, 16 kHz). Values are
comparable inside this project and only roughly with published ones.

## Out of scope

- Perceptual models such as PESQ, POLQA or ViSQOL, and every neural quality
  predictor.
- Intelligibility measures such as STOI and ESTOI. They can be added later
  if {{P07}} shows that the metrics here do not separate good from bad.
- Running the metrics on the golden set: {{P07}}.
- Recognising speech; `errorRate` only compares two transcripts: {{P61}}.
- A Rust version of the metrics: {{P09}} decides what moves to Rust.

## References

- Kubichek, R. (1993). Mel-cepstral distance measure for objective speech
  quality assessment. IEEE Pacific Rim Conference on Communications,
  Computers and Signal Processing, 125-128.
  <https://doi.org/10.1109/pacrim.1993.407206>
- Gray, A. H. and Markel, J. D. (1976). Distance measures for speech
  processing. IEEE Transactions on Acoustics, Speech, and Signal Processing
  24(5), 380-391. <https://doi.org/10.1109/tassp.1976.1162849>
- Sakoe, H. and Chiba, S. (1978). Dynamic programming algorithm optimization
  for spoken word recognition. IEEE Transactions on Acoustics, Speech, and
  Signal Processing 26(1), 43-49.
- de Cheveigné, A. and Kawahara, H. (2002). YIN, a fundamental frequency
  estimator for speech and music. Journal of the Acoustical Society of
  America 111(4), 1917-1930.
- Rabiner, L. R. et al. (1976). A comparative performance study of several
  pitch detection algorithms. IEEE Transactions on Acoustics, Speech, and
  Signal Processing 24(5), 399-418.
  <https://doi.org/10.1109/tassp.1976.1162846>
- Chu, W. and Alwan, A. (2009). Reducing f0 frame error of f0 tracking
  algorithms under noisy conditions with an unvoiced/voiced classification
  frontend. ICASSP 2009, 3969-3972.
  <https://doi.org/10.1109/icassp.2009.4960497>
- Levenshtein, V. I. (1966). Binary codes capable of correcting deletions,
  insertions, and reversals. Soviet Physics Doklady 10(8), 707-710.
