---
id: P54
title: Decode articulation into IPA with times
type: Feature
milestone: M4
blocked_by: [P53, P50]
requirements: [R6, R7, R10, R12, R13, R18, R19]
---

## Goal

`audioToIpa(samples, sampleRate, options)` returns the sounds of a recording
as IPA: one entry per phoneme with start time, end time and confidence, the
syllables with their times, the few next-best readings, and a lattice of
alternatives. It works without knowing the language, and better when the
language is given. No part of it is trained on recordings.

## Why

- This is the step "audio to IPA" of the issue. Text ({{P56}}), language
  ({{P57}}), tones and stress ({{P58}}) are read from its output.
- Times per phoneme and per syllable are needed for highlighting during
  recognition ({{P62}}) and for copy synthesis ({{P67}}).
- The channels of {{P53}} are continuous, symbols are discrete, and the
  simulator holds the target of every symbol. So decoding is a search for
  the symbol sequence whose planned targets lie closest to the track.

## Current state

- `parseIpa` and `formatIpa` (`src/ipa/parse.js`) read and write IPA tokens;
  the inventory has 31 vowels and 66 consonants (`listSymbols()` gives 97).
- `planUtterance` turns tokens into segments (`pause`, `consonant`,
  `release`, `vowel`) with `start` and `end`, and into channel targets
  (`vowelTarget`, `vowelChannels`, `consonantTarget`). For example `əpʰə`
  gives a `consonant` segment of 86 ms followed by a `release` of 60 ms.
- `syllabifyTokens(tokens, {language})` in `src/ipa/syllables.js` groups
  tokens into syllables.
- Words with IPA exist for counting which sounds follow which:
  `ENGLISH_DICTIONARY` (12000 `word=ipa` entries), `CHINESE_READINGS`
  (readings of 8105 characters) and `RUSSIAN_STRESS` (a hand-made list of
  stressed words) in `src/g2p/`. Hindi has rules only and no word list.
- Nothing goes from sound or from channels to symbols.

## What to do

Create `src/recognition/decode.js`, `scripts/build-phonotactics.mjs` and
`scripts/tune-decoder.mjs`.

1. A unit is one IPA token without stress, tone or length mark, written as
   `formatIpa` writes it (`a`, `pʰ`, `tʲ`, `ã`). Universal: `listSymbols()`.
2. `scripts/build-phonotactics.mjs` (deterministic) writes
   `src/recognition/phonotactics.js` with `PHONOTACTICS[lang]`, an object
   `{units, counts}`, for `en`, `ru`, `hi`, `zh`. Word sources: the IPA side
   of `ENGLISH_DICTIONARY`; `textToIpa` of every word of `RUSSIAN_STRESS`,
   of one character per group of `CHINESE_READINGS`, and of the words in a
   new file `scripts/data/hindi-words.txt` (at least 500 common words,
   written for this project, one per line). Each word counts once. `units`
   = every unit seen; `counts` = a `Uint16Array` of `(n + 1)^2` values: how
   often unit `b` follows unit `a` inside a word, with the extra symbol `#`
   at both word ends; clip at 65535.
   `P(b | a) = (count(a, b) + 0.5) / (count(a) + 0.5 * (n + 1))`.
3. Templates, made once per voice at first use. For a vowel unit plan the
   unit alone; for a consonant plan `ə`, the unit, `ə` (`planUtterance` with
   `head: voice`). The stretch is the vowel segment, or the consonant
   segment plus its `release` segment. Store the 21 channel values at 10,
   30, 50, 70 and 90 % of the stretch (`sampleState`) and the nominal
   duration `d_u` of the stretch.
4. Compared channels. Vowel units: `height`, `backness`, `rounding`,
   `rhotic`, `velum`, `voicing`. Consonant units: `lipAmount`,
   `tongueAmount`, `velum`, `voicing`, `aspiration`, `frication`,
   `sibilance`, `trill`; also `lipArea` when the template has
   `lipAmount > 0.5`, and `tongueArea` and `tongueLocation` when it has
   `tongueAmount > 0.5`.
5. Boundary candidates (times): every landmark of {{P50}}; every change of
   the broad class; every local maximum above 0.15 of the speed
   `v[t] = sqrt(sum_c ((a_c[t + 2] - a_c[t - 2]) / range_c)^2)` over the 12
   tract channels; the edges of every gap. Candidates closer than 15 ms are
   merged; the kept one is, in this order, a gap edge, a landmark, a class
   change, a speed peak.
6. Cost of calling the stretch from candidate `i` to candidate `j` unit `u`
   (allowed when it lasts 20 to 400 ms and skips at most 3 candidates):
   `C = A + W.duration * Dur + W.class * Cls`.
   - `A` = the mean over the 5 template points `k` and the `n` compared
     channels `c` of `(a_c(t_k) - m_c,k)^2 / (v_c(t_k) + (0.15 * range_c)^2)`.
     `a` and `v` are value and variance of the track of {{P53}} at the same
     relative position (linear interpolation); `m` is the template;
     `range_c` is 1 for source channels.
   - `Dur = ln(d / (d_u / voice.speechRate))^2 / (2 * 0.5^2)`, `d` = length
     of the stretch in seconds.
   - `Cls` = the share of frames of the stretch whose broad class is not
     allowed for the unit. Allowed: vowels `vowel`, `glide`; approximants,
     laterals, taps and trills `glide`, `vowel`; nasals `nasal`, `glide`;
     voiced fricatives `voiced-fricative`, `glide`; voiceless fricatives
     `voiceless-fricative`, `burst`; plosives and affricates `closure`,
     `silence`, `burst` and both fricative classes; voiced plosives also
     `nasal` (the voice bar).
   - A gap of 150 ms or more is the unit `pause`, cost 0, and no other.
7. Cost of unit `b` after unit `a`: `W.phonotactic * -ln(Q)` with
   `Q = max(P(b | a), P(# | a) * P(b | #))`, so a word may end anywhere.
   With several languages `Q` is the largest over them and the unit set is
   their union. Without a language: the universal set and cost 0.
8. Search (Viterbi 1967, over stretches as in Glass 2003). State = (boundary
   candidate, last unit). Go through the candidates in time order; keep the
   `beam` cheapest states per candidate. Each state keeps its `nbest` best
   predecessors (Schwartz and Austin 1991), from which the `nbest` cheapest
   different unit strings are read at the end. Every stretch and unit that
   was inside the beam goes into the lattice.
9. Start weights `W = {duration: 0.5, class: 4, phonotactic: 1}`.
   `scripts/tune-decoder.mjs` tries 0.5, 1 and 2 times each start value (27
   combinations) on 10 tuning sentences per language that are not test
   sentences, keeps the lowest phone error rate, and writes
   `src/recognition/decode-weights.js`.
10. After the search. `long` is true when `d > 1.6 * d_u / speechRate`; `ː`
    is written only when the language has long units in `PHONOTACTICS`.
    Confidence of a phoneme = `exp(-C)` of the chosen unit divided by the
    sum of `exp(-C)` over all units for the same stretch. It orders
    alternatives; it is not a calibrated probability. Syllables:
    `syllabifyTokens` on the chosen tokens between pauses; a syllable
    starts at its first phoneme and ends at its last.
11. `audioToIpa(samples, sampleRate, options)`. Options: `voice` (head;
    without it `fitVoice` of {{P51}} with `refine: false` is run on the
    input), `language` or `languages`, `rate` (highest working rate
    allowed), `hop` (0.005), `beam` (32), `nbest` (1, at most 10). Order of
    work: `analyzeFrames`, `trackPitch`, voice, `trackFormants`,
    `findLandmarks`, `buildCodebook`, `invertArticulation`, steps 5 to 10.
    Result:

    ```js
    const result = {
      ipa, // 'hɛloʊ'
      segments, // [{ ipa, kind, start, end, confidence, long, cost }]
      syllables, // [{ ipa, start, end, segments: [first, afterLast] }]
      nbest, // [{ ipa, cost, confidence, segments }], cheapest first
      lattice, // { times: Float64Array, edges: [{ from, to, ipa, cost }] }
      frames, // the frame set of the front end
      tracks, // { pitch, formants, landmarks, articulation }
      voice, // the head that was used
    };
    ```

    Times are seconds from the start of the input. `kind` is `vowel`,
    `consonant` or `pause`; pauses are not in `ipa`. `cost` = `C` plus the
    cost of step 7. `from` and `to` index `lattice.times`. `nbest[0]` is
    the answer itself. Without speech: `ipa: ''` and empty lists.

12. `createIpaDecoder(sampleRate, options)` for streams returns
    `{push(chunk), flush(), result(), reset()}`. `push` runs all stages on
    the new frames and returns `{segments, nuclei}`: the phonemes fixed by
    this call and the nuclei confirmed by {{P50}}. A phoneme is fixed when
    it ended 0.3 s ago and all states in the beam agree on it, and in any
    case 0.5 s after it ended (best state). A fixed phoneme never changes.
    The voice is updated only at gaps of 0.3 s or more.

Budget on the reference machine of {{P46}}: steps 5 to 10 at most 5 % of
real time; all of `audioToIpa` at most 35 % with a given voice (16000 and
8000 Hz) and 65 % when the voice must be found too.

## Tests

New file `tests/recognition-decode.test.js`. Test sentences: 4 per language
(`en`, `ru`, `hi`, `zh`), the first of each being the sentences of {{P50}};
presets male and female; `synthesize` with `solver: 'waveguide'`, `seed: 1`.
The true head is passed as `voice`. Error = the phone error rate of {{P06}}:
`errorRate(reference, result.ipa, 'phone').rate`, `reference` = the planned
IPA, mean over the sentences.

- `decodes single vowels`: each of the 31 vowels for 300 ms, no language:
  the right symbol is first in at least 60 % and within `nbest: 5` in at
  least 90 %.
- `decodes with the language given`: at most 25 % at 16000 Hz, 35 % at
  8000 Hz.
- `decodes without a language`: at most 40 % at 16000 Hz.
- `finds the boundaries`: at least 80 % of the planned phoneme boundaries
  have a result boundary within 20 ms.
- `n-best holds better readings`: the lowest error among `nbest: 10` is at
  least 5 points below the error of the first reading (printed as "oracle").
- `syllables carry times`: the number of syllables equals the planned number
  within 10 %, and each start is within 50 ms.
- `stream fixes phonemes in time`: pushed in chunks of 20 ms, every phoneme
  is returned at most 0.55 s after its end, and the phone error rate is at
  most 5 points above the batch result.
- `returns nothing for silence and noise`: `ipa` is `''` for 1 s of each.
- `stays within the CPU budget`: prints `decode rtf <x>` and
  `audioToIpa rtf <x>`; fails above 1.0.

Heavy test `tests/heavy/recognition-decode.test.js` ({{P02}}): 50 sentences
per language from the simulator, and the golden set ({{P05}}) with the voice
fitted per speaker; `writeReport('recognition-decode', ...)` with the phone
error rate per language, rate and condition and the broad-class error.

## Acceptance criteria

- [ ] `node --test tests/recognition-decode.test.js` passes on Node.js, Bun
      and Deno with the thresholds above.
- [ ] `node scripts/build-phonotactics.mjs` and
      `node scripts/tune-decoder.mjs`, each run twice, write the same files;
      `src/recognition/phonotactics.js` is at most 200 kB.
- [ ] The CI log shows `audioToIpa rtf` of at most 0.35.
- [ ] `reports/heavy/recognition-decode.md` exists. Targets to be measured,
      not gates yet: golden set phone error rate at most 60 % and broad
      class error at most 35 %. The report also prints the long-term
      reference: 32.7 % for a trained monophone recogniser on TIMIT (Kaldi).
      If a target is missed, the pull request says so and a Bug issue with
      the numbers is opened.
- [ ] `audioToIpa` and `createIpaDecoder` are exported and typed.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Words and spelling: {{P56}}. Which language: {{P57}}. Tones, stress marks
  and sentence type: {{P58}}. Whisper: {{P60}}. Public `recognize`: {{P61}}.
- Comparing renders of the best readings with the input: {{P55}}.
- Larger word lists for the counts: {{P35}}. Durations from {{P27}}.

## References

- Glass, J. R. (2003). A probabilistic framework for segment-based speech
  recognition. Computer Speech and Language 17(2-3), 137-152.
  doi:10.1016/s0885-2308(03)00006-8
- Stevens, K. N. (2002). Toward a model for lexical access based on acoustic
  landmarks and distinctive features. JASA 111(4), 1872-1891.
  doi:10.1121/1.1458026
- Viterbi, A. (1967). Error bounds for convolutional codes and an
  asymptotically optimum decoding algorithm. IEEE Trans. Information Theory
  13(2). doi:10.1109/tit.1967.1054010
- Schwartz, R., Austin, S. (1991). A comparison of several approximate
  algorithms for finding multiple (N-best) sentence hypotheses. ICASSP.
  doi:10.1109/icassp.1991.150436
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
