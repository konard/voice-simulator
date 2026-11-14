---
id: P64
title: Recognition benchmark on public recordings
type: Feature
milestone: M4
blocked_by: [P61, P04, P06, P02]
requirements: [R6, R8, R11, R13, R19]
---

## Goal

A manually started test measures `recognize` on real recordings of people in
English, Russian, Hindi and Mandarin: phone, word and character error rates,
language identification, tone errors and speed, at every recognition level
including 8 kHz. The numbers are written to a report, a baseline is
committed, and from then on the numbers may only get better.

## Why

The round trip of {{P63}} tests recognition on the synthesiser's own speech.
That says nothing about real voices, rooms and microphones. The issue asks
for tests on real recordings from data sets and for heavy tests that run on
request. Without a committed baseline nobody can tell whether a change made
recognition of real speech better or worse.

## Current state

- No recognition code and no benchmark exist. After {{P61}},
  `recognize(samples, sampleRate, options)` returns `ipa`, `text`,
  `languages` and `words`, with the levels `low` (8000 Hz), `medium` and
  `high` (16000 Hz).
- After {{P04}}, `datasets/registry.json` has the entries `fleurs-en`,
  `fleurs-ru`, `fleurs-hi`, `fleurs-zh` (FLEURS, CC BY 4.0, 16 kHz,
  validation split with 394, 356, 239 and 409 rows), `aishell3-test-index`
  (text with pinyin and tone numbers, no audio) and two LibriVox entries.
  `fetchDataset(id, { limit })` downloads the first rows into `.datasets/`
  and `readDataset(id)` returns `[{ id, text, audioPath, gender }]`.
  `datasetSkipReason(id)` in `tests/helpers/datasets.js` tells a test why a
  set cannot be used. Fetched audio must never enter the repository, a
  release or an artifact.
- After {{P06}}, `errorRate(reference, hypothesis, unit)` counts errors for
  the units `'word'`, `'char'` and `'phone'`.
- After {{P02}}, files `tests/heavy/recognition-*.test.js` run with
  `gh workflow run heavy.yml -f suite=recognition`;
  `tests/heavy/helpers/report.js` gives `heavyLimit` and `writeReport`.
- No free recordings have phone labels made by people: TIMIT is paid and
  refused by the registry. So the phone reference here is the dictionary
  pronunciation of the transcript, not what the speaker really said.
- Published figures, for orientation only (research notes, file 2): the
  Kaldi recipe for TIMIT, with trained statistical models and no neural
  network, reports 32.7 % phone errors for its simplest system and 19.7 %
  for its best one. This project trains nothing, so its first numbers will
  be much worse. The notes name 80 to 90 % right broad sound classes on
  clean read speech as an honest first target.

## What to do

1. Sets. Create `datasets/benchmark.json`:

   ```text
   { "schema": 1, "sets": [
     { "id": "fleurs-en", "language": "en", "rows": 50 },
     { "id": "fleurs-ru", "language": "ru", "rows": 50 },
     { "id": "fleurs-hi", "language": "hi", "rows": 50 },
     { "id": "fleurs-zh", "language": "zh", "rows": 50 } ] }
   ```

   A set is the first `rows` rows of the registry entry, in row order. Add
   two more registry entries under the rules of {{P04}} (read the licence
   again, quote it, record sizes and hashes) and add them to this file with
   `rows: 20`: LibriTTS-R `dev.clean` (English, listed as CC BY 4.0) and
   SOVA RuDevices `test` (Russian, listed as CC BY 4.0); their rows
   addresses are in `docs/case-studies/issue-11/research/3-datasets.md`. If
   the licence gate refuses one, leave it out and say so in the report.

2. Create `tests/heavy/helpers/benchmark.js`:
   - `loadBenchmark({ set, limit })`: calls `fetchDataset` (cache
     `.datasets`), decodes the audio with `decodeAudio`, and returns
     `[{ id, language, text, samples, sampleRate }]`. {{P69}} uses it too.
   - `normalizeForScoring(text, language)`: Unicode NFC; lower case; remove
     every character of the Unicode classes P and S; `ё` becomes `е`; one
     space between words; for `zh` remove all spaces. A reference that
     contains a digit is skipped and counted in `skipped`.
   - `scoreUtterance(row, result, language)` returns an object with the
     keys `wer`, `cer`, `per`, `classErr`, `toneErr` (each
     `{ errors, length }`: a count and the reference length, not a ratio)
     and `languageRight` (true or false), computed as in step 3.
   - `checkBaseline(measured, baseline, margins)` returns a list of
     failures (step 6).
3. Measures. `ref` is `normalizeForScoring(row.text)`, `hyp` is
   `normalizeForScoring(result.text)`.
   - `wer`: `errorRate(ref, hyp, 'word')`; not for `zh`.
   - `cer`: `errorRate(ref, hyp, 'char')`.
   - `per`: reference `textToIpa(row.text, { lang }).ipa`, hypothesis
     `result.ipa`; from both remove stress marks, tone letters, sentence
     marks, pauses and brace labels; `errorRate(..., 'phone')`.
   - `classErr`: map every phone of both to one letter (vowel, plosive,
     affricate, fricative, nasal, or liquid and glide together; from the
     `manner` of the phoneme in `src/ipa/inventory.js`) and count errors
     the same way.
   - `toneErr` (`zh`): split both into syllables; align the syllables by
     edit distance on the toneless forms; among aligned pairs, the share
     whose tone letters differ.
   - `languageRight`: `result.languages[0].language` equals the language of
     the set. `recognize` is called without the option `languages`.
   - `rtf`: processing time divided by audio duration, one thread.
   - Sum the counts over a set, then divide: that is the rate of the set.
4. Create `tests/heavy/recognition-benchmark.test.js`. For every set that
   `datasetSkipReason` allows, and for the levels `low`, `medium`, `high`:
   recognise `heavyLimit(rows)` utterances and collect the measures. Then:
   - one extra run per language with `languages: [language]` at level
     `medium` (how good is the text when the language is known);
   - if `aishell3-test-index` is fetched: compare the tone numbers of its
     pinyin with the tones of `textToIpa` on the first 500 lines and report
     the share that differs. This is the error of the tone reference
     itself; no audio is needed.
   - A set that is skipped is listed in the report with the reason. A run
     in which no set was measured fails.
5. Report. `writeReport('recognition-benchmark', markdown, data)`:
   - a table per set: level, utterances, minutes of audio, PER, class
     errors, WER, CER, tone errors, language right, real-time factor;
   - the 10 most frequent phone confusions per language (pairs of IPA
     symbols with counts);
   - a section "Data": id, title, licence, citation and link of every set,
     from the registry (attribution is required by CC BY);
   - a section "How to read this": the phone reference is the dictionary
     pronunciation; the published figures of "Current state" with their
     source and the sentence that they are not comparable.
   - `data` holds only sums and rates per set and level, and per utterance
     the row id with its counts. No audio, no reference text.
     Copy the markdown to `docs/reports/recognition-benchmark.md` when the
     baseline is set or changed.
6. Baseline and ratchet. `tests/heavy/baselines/recognition.json` (the
   numbers here only show the format):

   ```text
   { "schema": 1, "commit": "<sha>", "limit": 50, "sets": {
     "fleurs-en": { "low": { "per": 0.71, "wer": 0.93, "cer": 0.8,
       "classErr": 0.4, "toneErr": null, "languageRight": 0.6,
       "rtf": 2.1, "utterances": 50 } } } }
   ```

   - `checkBaseline` fails when an error rate is more than 2 points above
     the baseline, `languageRight` more than 4 points below, or `rtf` more
     than 1.5 times the baseline. It compares only when `limit` and the
     number of utterances are the same as in the baseline; otherwise it
     prints a notice and passes.
   - Without a baseline file the test passes and prints `no baseline`.
   - `HEAVY_UPDATE_BASELINE=1` writes the file. It refuses when any error
     rate is higher than in the old file, unless
     `HEAVY_BASELINE_REASON="..."` is set; the reason is stored in the file
     under `notes`.

7. Floors that hold from the first run (if one fails, the issue is not
   done; find the weakest stage with the confusion table first):
   - `languageRight` at level `medium`: at least 50 % over the four FLEURS
     sets together (guessing gives 25 %);
   - `classErr` below 60 % and `per` below 100 % on every set;
   - level `low`: every error rate at most 15 points above `medium`.
     These are floors, not targets. The targets (class errors at most 20 %,
     PER at most 50 %) are written in the report as "not reached yet" until
     they are; when one is reached, add it here as a floor.
8. Time. With the default `rows` the suite must end within 90 minutes on
   the workflow runner. If it does not, lower `rows`, and write the
   measured minutes in the report.
9. Document in `docs/CONTRIBUTING.md` (new section "Recognition
   benchmark", after "Heavy checks" of {{P02}}): how to run it locally
   (`node scripts/run-heavy.mjs --suite recognition --limit 5`), how to
   update the baseline, and the rule that fetched audio stays in
   `.datasets/`.

## Tests

`tests/recognition-benchmark.test.js` (runs in `npm test`, no network):

- `normalises text`: `Hello, World!` gives `hello world`; `Ёлка — это…`
  gives `елка это`; `你好， 世界。` gives `你好世界`; `In 1999` is skipped.
- `scores an utterance`: a hand-made result with one wrong word of four
  gives `wer` 1 of 4; identical IPA gives `per` 0.
- `ignores marks in the phone score`: `ˈhɛloʊ ?` against `hɛloʊ` gives 0.
- `maps phones to classes`: every symbol of `listSymbols()` maps to exactly
  one class.
- `counts tone errors`: `ni˧˥ xɑʊ˨˩˦` against `ni˨˩˦ xɑʊ˨˩˦` gives 1 of 2.
- `ratchet`: `checkBaseline` passes for equal numbers, fails for PER +3
  points, passes for PER -10 points, and passes with a notice when the
  limits differ.
- `the benchmark file is valid`: every `id` of `datasets/benchmark.json`
  is in the registry and has `licenceGate` passing.
- `nothing fetched is tracked`: `git ls-files .datasets` prints nothing.

## Acceptance criteria

- [ ] `gh workflow run heavy.yml -f suite=recognition` ends green and its
      artifact holds `recognition-benchmark.md` and `.json` with rows for
      at least the four FLEURS sets at the three levels.
- [ ] `tests/heavy/baselines/recognition.json` and
      `docs/reports/recognition-benchmark.md` are committed with the numbers
      of that run, and the floors of step 7 hold.
- [ ] A second run on the same commit passes `checkBaseline`.
- [ ] The report names every data set with its licence and citation.
- [ ] `git ls-files | grep -c "\.datasets/"` prints `0`, and the artifact
      holds no `.wav` or `.flac` file.
- [ ] `npm test` runs `tests/recognition-benchmark.test.js` without network
      access.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Making recognition better: this issue only measures. Fixes go to the
  issue of the weakest stage ({{P54}}, {{P56}}, {{P57}}, {{P58}}).
- Modes on real recordings: {{P59}}. Whispered recordings: {{P60}} (no
  usable data set).
- Speech in noise, far microphones, telephone recordings, children.
- Comparing with other recognisers by running them.
- The speed table over time: {{P19}}. Lowest settings as a whole: {{P69}}.

## References

- Research notes: data sets and licences,
  `docs/case-studies/issue-11/research/3-datasets.md`; how to evaluate and
  the published figures, sections 4.6 and 7 of
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`.
- FLEURS rows, for example:
  https://datasets-server.huggingface.co/rows?dataset=google/fleurs&config=ru_ru&split=validation&offset=0&length=20
- LibriSpeech and its licence: https://www.openslr.org/12/
- Conneau, A. et al. (2022). FLEURS: Few-shot Learning Evaluation of
  Universal Representations of Speech. arXiv:2205.12446
