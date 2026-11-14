---
id: P07
title: Baseline quality report against real recordings
type: Feature
milestone: M0
blocked_by: [P02, P05, P06]
requirements: [R1, R8, R11]
---

## Goal

Measure how far the synthetic voice is from human speech today, with numbers.
A script synthesises every sentence of the golden set ({{P05}}) on every
quality tier, compares it with the recording by the metrics of {{P06}} and
writes a table per language and tier. The first result is committed as
`docs/reports/baseline-quality.md` and `.json`; later issues compare
themselves with it.

## Why

The issue asks for a quality that is "state of the art". Nobody can say how
far the project is from that, because no number has ever been measured
against a human voice. Without a baseline, every later change ("better
intonation", "better fricatives") can only be judged by ear, and an AI agent
has no ear. The final report {{P71}} needs a starting point to show progress.

## Current state

- No script compares the output with a recording of human speech.
  `scripts/check-simulation.mjs` renders test words and checks physical
  properties (formants of vowels, noise of fricatives); with `--out` it
  writes `report.json`, WAV files and a GitHub step summary. It is a good
  model for the structure of the new script.
- `voice-simulator benchmark` measures speed only.
- `synthesize(text, options)` returns `{ipa, samples, sampleRate, duration,
...}`. The option `preset` is used only when `head` is `'random'`
  (`resolveHead` in `src/synthesize.js`); a fixed preset voice needs
  `head: presetHeadConfig('male' | 'female' | 'child')`.
- Tiers (`src/perf/lod.js`): `minimal`, `low`, `medium` (waveguide) and
  `high`, `ultra`, `studio`, `reference` (3D). Measured real-time factors
  (render seconds per second of sound, one core): minimal 0.05, low 0.1,
  medium 0.14, high 1.3, ultra 6.8. `studio` and `reference` were not
  measured; they are slower.
- `.gitignore` has the line `reports/` (under "# jscpd reports"). It has no
  leading slash, so it also ignores `docs/reports/`. {{P02}} changes it to
  `/reports/`.

## What to do

1. Create `scripts/quality-report.mjs`. Usage:

   ```text
   node scripts/quality-report.mjs [--manifest <file>] [--tiers <list>]
     [--lang <list>] [--limit <n>] [--out <dir>] [--baseline <json>]
     [--update-docs]
   ```

   Defaults: `--manifest tests/fixtures/golden/manifest.json`, `--tiers
minimal,low,medium`, `--lang en,ru,hi,zh`, no limit (`--limit n` keeps the
   first `n` utterances of each language), `--out reports/quality`.

2. Export `qualityReport(options)` (returns the data object of step 6) and
   `renderMarkdown(data, baseline)` (returns a string) so that tests can call
   them without a child process.
3. For each utterance `u` and each tier `t`:
   1. `reference = {samples, sampleRate}` from `decodeFlac` of the file.
   2. `voice = synthesize(u.text, {lang: u.lang, tier: t, seed: 1, head:
presetHeadConfig(u.speaker.sex === 'male' ? 'male' : 'female')})`.
      Measure the wall time of this call with `performance.now()`.
   3. `m = compareRecordings(reference, voice)` from `src/metrics/`.
   4. Store one row: `{id, lang, tier, lsd, mcd, f0RmseCents, f0MeanCents,
gpe, vde, ffe, f1Percent, f2Percent, f3Percent, timingRms,
durationRatio, renderSeconds, rtf}` where `rtf = renderSeconds /
voice.duration`, `timingRms = m.timing.rmsSeconds`, `durationRatio =
m.duration.ratio`, and the others are the fields of `m` with the same
      meaning. Round to 4 significant digits.
4. Once per utterance (it does not depend on the tier): the phone error rate
   of the text front end, `per = errorRate(u.ipa, voice.ipa, 'phone').rate`.
5. Two anchors per utterance, so that a reader can tell what a number means.
   Each anchor is compared with the recording exactly like a tier:
   - `lowpass`: the recording itself, `resample`d to 7000 Hz and back to its
     own rate (a very good voice that only lost its high frequencies);
   - `noise`: white noise from a seeded generator (`createRandom(1)` of
     `src/random.js`) with the same length and the same RMS as the recording
     (no speech at all).
     A useful tier lies between the two on every metric.
6. Data object:

   ```json
   {
     "schema": 1,
     "generated": { "date": "", "commit": "", "version": "", "node": "" },
     "settings": { "tiers": [], "languages": [], "seed": 1, "limit": null },
     "utterances": [{ "id": "", "lang": "", "per": 0, "reviewed": false }],
     "rows": [],
     "anchors": [],
     "summary": []
   }
   ```

   `summary` has one object per (language, tier), per (`all`, tier) and per
   anchor: the mean and the sample standard deviation of every metric of
   step 3 and the count `n`. `reviewed` is true when both `review` fields of
   the manifest are `confirmed`. `commit` comes from `git rev-parse HEAD`
   (empty string if git is missing), `version` from `package.json`.

7. Markdown (`renderMarkdown`): a title, the `generated` block, then
   - table "Summary": one row per tier and anchor for all languages, columns
     MCD (dB), LSD (dB), f0 RMSE (cents), GPE (%), VDE (%), F1/F2/F3 error
     (%), timing (s), duration ratio, RTF; each cell `mean ± sd`;
   - one such table per language;
   - table "Text front end": language, utterances, mean PER (%);
   - table "Utterances": one row per utterance and tier with the raw values;
     an id whose `reviewed` is false gets a `*`, explained under the table;
   - section "How to read this": one sentence per metric (what it is, which
     direction is better), taken from the README section of {{P06}};
   - with `--baseline <json>`, every cell of "Summary" also shows the
     difference to the same cell of that file, for example `7.31 (−0.42)`.
8. Write `<out>/baseline-quality.md` and `<out>/baseline-quality.json`. If
   the environment variable `GITHUB_STEP_SUMMARY` is set, append the
   "Summary" table to that file. With `--update-docs`, also copy both files
   to `docs/reports/`.
9. Add `tests/heavy/quality-baseline.test.js` (suite `quality` of {{P02}}):
   it calls `qualityReport` with the tiers `minimal`, `low`, `medium`,
   `high`, `ultra`, `studio` and `limit: heavyLimit(6)`, writes the result
   with `writeReport('baseline-quality', markdown, data)` and checks only
   sanity: every value is a finite number, and for every language the mean
   MCD of every tier is lower than the mean MCD of the `noise` anchor.
10. Produce the first baseline: run
    `gh workflow run heavy.yml -f suite=quality`, download the artifact, copy
    `baseline-quality.md` and `baseline-quality.json` to `docs/reports/` and
    commit them. Add to the top of the Markdown file the run URL. Do not
    change numbers by hand.
11. Link the report from `README.md` (section "Quality", one paragraph: what
    is measured and the three main numbers) and from `docs/VISION.md` where
    it speaks about measuring quality.
12. Write into the pull request the three worst (language, metric) cells.
    They show which later issues matter most.

The baseline is a snapshot. It is not regenerated by normal pull requests.
An issue that claims an improvement runs the script with
`--baseline docs/reports/baseline-quality.json` and puts the table into its
pull request. {{P71}} compares the final numbers with the baseline and
leaves the baseline files unchanged.

Cost: the golden set is about 100 s of sound. With the factors above one pass
costs about 5 s on `minimal`, 2 min on `high` and 12 min on `ultra`. Measure
`studio` with `--limit 1` first; if the whole run would not fit into the job
time limit of {{P02}}, leave `studio` out of the heavy test and say so in
the report.

## Tests

Add `tests/quality-report.test.js` (fast; part of `npm test`):

- `reports one utterance`: `qualityReport({lang: ['en'], tiers: ['minimal'],
limit: 1})` returns 1 utterance, 1 row and 2 anchors; every metric is a
  finite number; `rtf` is greater than 0.
- `anchors bracket the scale`: for that utterance the MCD of `lowpass` is
  lower than the MCD of `noise`.
- `is deterministic`: two calls give the same rows except `renderSeconds`
  and `rtf`.
- `renders markdown`: the string contains `## Summary`, one table row that
  starts with `| minimal`, and a `*` when the utterance is not reviewed.
- `shows differences to a baseline`: with a baseline whose MCD is 1 dB
  higher, the cell contains `(−1`.
- `committed baseline is consistent`: `docs/reports/baseline-quality.json`
  parses, has `schema` 1, has a row for every utterance id of the manifest
  on every tier in `settings.tiers`, and every summary mean is finite.

The heavy test of step 9 runs only in the workflow `Heavy checks`.

## Acceptance criteria

- [ ] `node scripts/quality-report.mjs --lang en --limit 2` finishes in less
      than 60 seconds and writes `reports/quality/baseline-quality.md` with
      a "Summary" table of 3 tiers and 2 anchors.
- [ ] `git check-ignore docs/reports/baseline-quality.md` prints nothing and
      `git ls-files docs/reports` lists `baseline-quality.md` and
      `baseline-quality.json`.
- [ ] The committed report covers 4 languages, all golden utterances and at
      least the tiers `minimal`, `low`, `medium`, `high` and `ultra`, and
      names the workflow run that produced it.
- [ ] A run of `Heavy checks` with `suite=quality` on the pull request is
      green, shows the "Summary" table in the run summary and uploads the
      report as an artifact.
- [ ] In the committed report, every tier has a lower mean MCD than the
      `noise` anchor for every language (if not, the metric or the alignment
      is broken: fix that first).
- [ ] `README.md` links the report; the pull request lists the three worst
      cells.
- [ ] `npm run check` and `npm test` pass on Node.js, Bun and Deno; a patch
      changeset is added.

## Out of scope

- Improving any number. This issue only measures.
- Thresholds that fail a pull request when a number gets worse: {{P19}}
  tracks speed; quality gates come with {{P71}}.
- Listening tests with people: {{P08}}.
- Recognition accuracy on recordings: {{P64}}. Round trip: {{P63}}.
- Fitting the voice to the speaker of each recording ({{P51}}). The baseline
  uses the preset head of the speaker's sex, so part of the spectral
  distance is a difference between two people, not an error. The report
  must say this in "How to read this".

## References

- Kubichek, R. (1993). Mel-cepstral distance measure for objective speech
  quality assessment. IEEE Pacific Rim Conference on Communications,
  Computers and Signal Processing.
- Sakoe, H. and Chiba, S. (1978). Dynamic programming algorithm optimization
  for spoken word recognition. IEEE Transactions on Acoustics, Speech, and
  Signal Processing 26(1).
- `docs/case-studies/issue-11/research/3-datasets.md` (sources of the
  recordings) and `docs/case-studies/issue-11/research/1-similar-projects.md`
  (what other synthesisers report).
- `scripts/check-simulation.mjs` (structure of a report script in this
  repository).
