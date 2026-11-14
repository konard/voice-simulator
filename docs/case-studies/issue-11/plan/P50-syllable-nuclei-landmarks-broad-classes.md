---
id: P50
title: Syllable nuclei, landmarks and broad sound classes
type: Feature
milestone: M4
blocked_by: [P46, P05]
requirements: [R6, R10, R12, R13, R18]
---

## Goal

`findLandmarks` reads the analysis frames and says three things without
knowing the language: where each syllable has its centre (nucleus), where
the sound changes abruptly (landmarks: a closure, a release, the start or
end of voicing), and which broad class every frame belongs to (silence,
vowel, glide, nasal, voiced fricative, voiceless fricative, closure, burst).
In a stream a nucleus is reported at most 150 ms after it was spoken.

## Why

- Live highlighting ({{P62}}) must mark the syllable being spoken long before
  the words are known. Nuclei give that from energy alone.
- The decoder ({{P54}}) needs places where a sound may begin or end, and a
  cheap first guess of the kind of sound, so that it compares each stretch
  with a few phonemes and not with all 97.
- Speech rate for the voice fit ({{P51}}) is the number of nuclei per second.

## Current state

- `analyzeVoice` gives one number, `syllableRate`: peaks of a smoothed energy
  curve of the whole recording. The peak times are not returned and nothing
  works on a stream.
- No code finds closures, bursts or the start of voicing, and no code names
  the kind of sound of a frame.
- The forward direction knows all of this exactly: `planUtterance` returns
  `plan.segments` with `kind` (`pause`, `consonant`, `release`, `vowel`),
  `start` and `end`, and the tokens carry manner and voicing
  (`src/articulation/phones.js`, `MANNERS`). So the simulator can make as
  much labelled speech as needed to set thresholds.
- `syllabifyIpa(ipa, {language})` in `src/ipa/syllables.js` gives the true
  number of syllables of a transcript.

## What to do

Create `src/recognition/landmarks.js` (stage pattern of {{P46}}) and the
script `scripts/calibrate-landmarks.mjs`. Inputs per frame, all from the
frame set: `energy`, `noise`, `speech`, `periodicity`, `zcr`, `gravity`,
`tilt`, `band` (6 values) and `mel`.

1. Exported constant `BROAD_CLASSES`, a list of names in this order (the
   index is the class number): `silence`, `vowel`, `glide`, `nasal`,
   `voiced-fricative`, `voiceless-fricative`, `closure`, `burst`.
2. Sonority curve `s[t]` in dB: `10 * log10` of the sum of `exp(mel[m])`
   over the filters with centres from 300 to 3000 Hz (to 2800 Hz when `rate`
   is 8000), smoothed with a moving mean of 40 ms. Store it as `sonority`.
3. Nuclei (after Mermelstein 1975; de Jong and Wempe 2009). Frame `t` is a
   nucleus when all hold:
   1. `s[t]` is the largest value within 40 ms on both sides;
   2. `s[t] >= noise[t] + NUCLEUS_ABOVE_NOISE` (start value 10 dB);
   3. `periodicity[t] >= 0.45` (voiced);
   4. between `t` and the nucleus before it `s` falls at least
      `NUCLEUS_DIP` (start value 2 dB) below the lower of the two peaks;
   5. the nucleus before it is at least 80 ms away. If rule 4 or 5 fails,
      keep the higher of the two peaks only.

   A nucleus is confirmed, and never taken back, when `s` has fallen
   `NUCLEUS_DIP` below it or when 100 ms have passed, whichever comes
   first; with the 40 ms of rule 1 the delay is at most 150 ms. Each
   nucleus is `{time, start, end, strength}`: `strength` = `s[t]` minus the
   lower of the two minima around it; `start` and `end` = the minima of `s`
   between neighbouring nuclei, or the nearest frame with `speech` 0. `end`
   is `null` until the next minimum is known.

4. Landmarks (after Liu 1996). For each of the six bands compute the rise
   `r_b[t] = band_b[t + d] - band_b[t - d]` with `d` = 25 ms (coarse) and
   13 ms (fine). A peak of `|r_b|` above `LANDMARK_RISE` (start value 9 dB)
   in the coarse pass, placed at the nearest peak of the fine pass within
   20 ms, is a candidate. Types:
   - `g+` / `g-`: band 0 (0 to 400 Hz) rises or falls and `periodicity`
     crosses 0.45: voicing starts or stops.
   - `s+` / `s-`: inside a voiced stretch, at least three of bands 1 to 4
     rise or fall together: a sonorant consonant ends or begins.
   - `b+` / `b-`: outside a voiced stretch, at least three of bands 1 to 5
     rise or fall together: a burst or frication starts or stops.

   Each landmark is `{time, type, strength}` (`strength` = mean `|r_b|` in
   dB over the bands that took part). Two landmarks of one type closer
   than 20 ms: keep the stronger.

5. Broad class of frame `t`, a fixed tree; `e = energy - noise`:
   1. `speech` is 0 and `e < T.silence` : silence (or closure, see step 6).
   2. `periodicity < T.voiced`: if the frame is within 20 ms after a `b+`
      landmark and the frame 20 ms earlier was silence or closure: burst;
      otherwise voiceless fricative.
   3. voiced, and `zcr > T.fricativeZcr` or `gravity > T.fricativeGravity`:
      voiced fricative.
   4. voiced, `band[0] - band[2] > T.nasalDrop` and
      `s[t] < peak - T.nasalBelowPeak`: nasal. `peak` = the largest `s`
      from 200 ms before the frame to 40 ms after it.
   5. voiced and `s[t] < peak - T.glideBelowPeak`: glide (this class also
      holds liquids).
   6. otherwise vowel.

   In a stream the class of a frame is fixed 60 ms after the frame (40 ms
   for `peak`, 20 ms for the clean-up of step 6); `committed` counts these.

6. Clean-up: a median over 5 frames of the class numbers; a silence run
   shorter than 150 ms with speech on both sides becomes closure; a run of
   any class shorter than 15 ms takes the class of the longer neighbour
   (bursts may be 5 ms).
7. `scripts/calibrate-landmarks.mjs` finds the thresholds `T` and the three
   start values above. It must be deterministic and is run by hand:
   1. Render with `synthesize` (`solver: 'waveguide'`, `seed: 1`) every
      consonant of `src/ipa/inventory.js` between the vowels `a`, `i`, `u`
      (`aCa`, `iCi`, `uCu`), for the presets male, female and child, at
      8000, 11025 and 16000 Hz, clean and with seeded white noise 20 dB
      below the speech.
   2. Truth per frame from `plan.segments` and the token: pause is silence;
      vowel is vowel; a consonant by manner: plosive closure part is
      closure, its `release` segment burst; nasal is nasal; fricatives by
      voicing; approximants, laterals, taps and trills are glide. Frames
      within 10 ms of a segment edge are not counted.
   3. Coordinate search: for each threshold in turn try 21 values across
      its allowed range, keep the one with the highest mean of the per-class
      recall; three rounds.
   4. Write `src/recognition/landmark-thresholds.js` (one exported object,
      with the reached recall per class and per rate in a comment).
8. Result: an object with `hop`, `startTime`, `count`, `committed`,
   `classes`, `sonority`, `landmarks` and `nuclei`; `classes` is a
   `Uint8Array`, `sonority` a `Float32Array`, both with `frames.capacity`
   values; `landmarks` and `nuclei` are arrays that only grow. Exports:
   `findLandmarks(frames, options)`, `BROAD_CLASSES` and
   `createLandmarkDetector(frames, options)` (its `advance()` returns the
   nuclei confirmed by this call).

Budget on the reference machine of {{P46}}: at most 2 % of real time.

## Tests

New file `tests/recognition-landmarks.test.js`. Sentences: "The north wind
and the sun were disputing which was the stronger." (English), "Мама мыла
раму." (Russian), "नमस्ते दुनिया" (Hindi), "你好世界" (Mandarin); presets
male and female; 16000 and 8000 Hz; `lang` set for each. True nuclei = the
middle of each vowel segment of `plan.segments`; vowel segments with no
consonant between them that `syllabifyTokens` puts into one syllable count
as one nucleus at the middle of the group. A nucleus is found when a
reported one lies within 50 ms.

- `finds the nuclei of synthetic speech`: over all sentences at least 90 %
  found and at most 10 % extra.
- `reports nuclei in time`: pushed in chunks of 20 ms, every nucleus is
  returned by `advance()` before 150 ms of later sound have been pushed, and
  the list returned by the stream equals the batch list within 10 ms.
- `names broad classes`: frame accuracy against the truth of step 7.2 at
  least 85 % at 16000 Hz and 80 % at 8000 Hz.
- `finds landmarks`: `apa`, `asa`, `ama`, `aba`: the closure, the release
  and the two voicing changes are each within 20 ms of the segment edge.
- `is quiet on noise`: 2 s of seeded white noise at -40 dB: no nucleus.
- `thresholds are up to date`: running the calibration on a tenth of its
  material gives thresholds within one search step of the committed ones.
- `stays within the CPU budget`: prints `landmarks rtf <x>`; fails above
  0.08.

Heavy test `tests/heavy/recognition-landmarks.test.js` ({{P02}}) on the
golden set ({{P05}}): number of nuclei against the number of syllables of
the IPA transcript (`syllabifyIpa`), per utterance.

## Acceptance criteria

- [ ] `node --test tests/recognition-landmarks.test.js` passes on Node.js,
      Bun and Deno.
- [ ] `node scripts/calibrate-landmarks.mjs` run twice writes the same file,
      byte for byte.
- [ ] `reports/heavy/recognition-landmarks.md` gives, for each golden
      utterance, the true and the found number of syllables, and the mean
      absolute relative error. Target to be measured, not a gate yet: 15 %.
- [ ] The CI log of `stays within the CPU budget` shows at most 0.02.
- [ ] `findLandmarks`, `createLandmarkDetector` and `BROAD_CLASSES` are
      exported and typed.
- [ ] `npm run check` and `npm test` pass; a minor changeset is added.

## Out of scope

- Which vowel or consonant it is: {{P53}}, {{P54}}.
- Whispered speech, where rule 3.3 cannot hold: {{P60}}.
- Showing the nuclei in the app: {{P62}}.
- Stress and tone of a syllable: {{P58}}.

## References

- Mermelstein, P. (1975). Automatic segmentation of speech into syllabic
  units. JASA 58(4), 880-883. doi:10.1121/1.380738
- Liu, S. A. (1996). Landmark detection for distinctive feature-based speech
  recognition. JASA 100(5), 3417-3430. doi:10.1121/1.416983 (about 90 % of
  landmarks found and 6 to 9 % extra on clean read speech).
- Stevens, K. N. (2002). Toward a model for lexical access based on acoustic
  landmarks and distinctive features. JASA 111(4), 1872-1891.
  doi:10.1121/1.1458026
- de Jong, N. H., Wempe, T. (2009). Praat script to detect syllable nuclei
  and measure speech rate automatically. Behavior Research Methods 41(2),
  385-390. doi:10.3758/brm.41.2.385
- Wang, D., Narayanan, S. S. (2007). Robust speech rate estimation for
  spontaneous speech. IEEE Trans. ASLP 15(8). doi:10.1109/tasl.2007.905178
- Juneja, A., Espy-Wilson, C. (2008). A probabilistic framework for
  landmark detection based on phonetic features for automatic speech
  recognition. JASA 123(2). doi:10.1121/1.2823754
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
