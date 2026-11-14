---
id: P71
title: State-of-the-art evaluation and public report
type: Feature
milestone: M5
blocked_by: [P07, P08, P67, P69]
requirements: [R19, R1, R8, R14]
---

## Goal

Measure where the project stands and publish it. One report,
`docs/reports/state-of-the-art.md`, holds five parts: objective quality
against real recordings, listening tests with people, recognition accuracy,
the lowest-settings matrix and speed. It ends with a table that says for
every goal of `docs/VISION.md` whether it is met, not met or not measured,
with the number. The words "state of the art" may then be written only where
a number in this report supports them.

## Why

Issue 11 asks for a state-of-the-art result without neural networks, given to
the public domain (requirement R19). The research found no listening-test
evidence anywhere that a network-free physical synthesizer matches neural
text-to-speech; the notes call this the largest open risk. A claim without a
blind test would be marketing. A published test, even one that shows a gap,
is the gift: other people can check it, repeat it and build on it.

## Current state

- No listening test has ever been run. `docs/VISION.md`, table "Where the
  project is today", row "Evidence": "No test on recordings of running
  speech, no listening test".
- `docs/reports/` does not exist. {{P07}} adds
  `docs/reports/baseline-quality.md`, {{P08}} the harness
  `examples/listening-test/` and `scripts/listening-test.mjs`, {{P67}} the
  test definitions `copy-abx` and `copy-similarity`, {{P69}}
  `docs/reports/lowest-settings.json`.
- `docs/VISION.md` uses "state of the art" once, as a goal: "a voice that
  people cannot tell from a recording of a person in a blind listening test
  ... it is a goal, not a current claim". Nothing checks that wording.

## What to do

1. Evaluation commit. Measure every part at one commit of `main` and name it
   in the report. All renders use `seed: 1`.
2. Report script `scripts/state-of-the-art-report.mjs`, called as
   `node scripts/state-of-the-art-report.mjs --heavy reports/heavy`. It reads
   the JSON files that `writeReport` of {{P02}} wrote for the suites
   `quality`, `recognition`, `copy`, `lowest` and `performance`, the folder
   `docs/reports/listening/` and `docs/reports/published-references.json`,
   and writes `docs/reports/state-of-the-art.md` and `.json`. Export
   `buildReport(inputs)` (returns the Markdown and the data) and
   `goalStatus(goal, data)`. A part whose input is missing is printed as
   "not measured"; it is never left out and never counted as met.
3. Part A, objective quality. Run `Heavy checks` with `suite=all`, which
   runs `scripts/quality-report.mjs` of {{P07}} with
   `--baseline docs/reports/baseline-quality.json`. Print its table: one row
   per language (`en`, `ru`, `hi`, `zh`) and tier, every metric of
   `compareRecordings` ({{P06}}), and next to each number the change
   against the baseline. Mark every number that became worse. Do not
   overwrite the baseline files; they stay the snapshot of the start.
4. Part B, listening tests, built and analysed with {{P08}}.

   | Test id                   | Type              | Items                              | Conditions                                                                                                                                          |
   | ------------------------- | ----------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `sota-naturalness-<lang>` | `mushra`          | the 6 golden sentences of `<lang>` | `reference` (hidden real recording), `anchor35`, `anchor70`, tiers `studio`, `medium`, `telephone`, `baseline`, `espeak-ng`; optional: see below    |
   | `sota-sounds`             | `mushra`          | [a], [i], [u] of 1 s; [ama], [asa] | `reference`, tiers `studio` and `minimal`, `espeak-ng`, `klatt`, `pink-trombone`, `vocaltractlab`                                                   |
   | `sota-abx-<lang>`         | `abx`             | 10 real sentences (see below)      | A = the real recording, B = the same text at tier `studio` in the voice fitted to that speaker by {{P66}}                                           |
   | `sota-intelligibility-en` | `intelligibility` | 20 sentences of `sus --lang en`    | tiers `studio` and `telephone`, `espeak-ng`; each listener hears a sentence in one condition only (three sentence files that rotate the conditions) |
   | `copy-abx`                | `abx`             | as defined in {{P67}}              | original against copy                                                                                                                               |
   | `copy-similarity`         | `mushra`          | as defined in {{P67}}              | speaker similarity of the copied voice                                                                                                              |
   - `<lang>` is `en`, `ru`, `hi` and `zh`. Real recordings come from the
     golden set of {{P05}} (6 per language). The ABX tests add 4 CC0 or
     public-domain recordings per language, fetched with
     `scripts/datasets.mjs` of {{P04}}; `sota-sounds` takes its references
     the same way (drop an item for which no such file exists).
   - `baseline` is the release that `baseline-quality.md` measured, rendered
     by the tester with that version from npm.
   - Other synthesizers are supplied by the tester through `extra`, as
     {{P08}} rules: eSpeak NG (GPL-3.0; run on the tester's machine only to
     make stimuli), a Klatt formant synthesizer, Pink Trombone and
     VocalTractLab. The last three have no text input, so they are required
     only in `sota-sounds`; add them to a naturalness test as `klatt` or
     `vocaltractlab` only if the tester can make the same sentences.
   - One neural text-to-speech system may be added as the condition
     `neural`, supplied by the tester. It is an external yardstick: every
     table prints it as "neural (yardstick)", it is never committed and
     nothing is tuned against it.
   - For every test write `docs/reports/listening/<test id>/conditions.md`:
     tool, version, voice and command line of every supplied condition.

5. Listeners. At least 20 per test after `screenListeners`; invite 24.
   Naturalness and ABX tests of a language need native speakers of it (field
   `nativeLanguage`) with headphones. The number comes from two estimates:
   - MUSHRA: to see a difference of 10 points between two conditions when
     the per-listener differences have a standard deviation of 15 points
     (two-sided 5 %, power 80 %): `((1.96 + 0.84) * 15 / 10) ** 2` = 17.7,
     so 18 listeners, 20 with a reserve.
   - ABX: to state "cannot tell" (rule in step 6) with a chance of 80 % when
     listeners really guess, the standard error must be at most
     `0.10 / (1.96 + 0.84)` = 0.0357, so `0.25 / 0.0357 ** 2` = 196 answers:
     20 listeners times 10 items.

   Run a pilot with 3 listeners first, measure the real standard deviation
   and repeat the first estimate; if it gives more than 20, invite more
   people. Listeners are volunteers found through the README and the issue
   tracker. A test with fewer than 20 is still published, with the label
   "underpowered"; its goals count as not measured.

6. Decision rules, coded in `goalStatus` and printed in the report:
   - "People cannot tell the voice from a recording" (per language): `met`
     when the upper end of the 95 % Wilson interval of the share of right
     answers in `sota-abx-<lang>` is at most 0.60 and the bootstrap interval
     of `reference` minus `studio` in `sota-naturalness-<lang>` contains 0.
     Otherwise `not met`. Print the share and the interval in both cases,
     and also the bootstrap interval over listeners, because answers of one
     listener are not independent.
   - "More natural than other network-free synthesizers": `met` when the
     interval of `studio` minus each of them is above 0.
   - The distance to `neural` is printed in points. It decides no goal.
   - Intelligibility: word error rate per condition with its interval.
     Russian, Hindi and Mandarin have no generator in {{P08}}; print them as
     "not measured by people" unless a tester wrote the sentences.
   - Copying: the intervals of `copy-abx` and `copy-similarity`, next to
     the objective numbers of `docs/reports/copy-synthesis.md`.
7. Part C, recognition. Print the table of {{P64}} (phoneme, word and
   character error rate, language identification) per language and
   recognition level, with the 8 kHz row. Below it print "Published numbers"
   from `docs/reports/published-references.json`, an array of
   `{ system, neural, task, data, metric, value, source, quote, retrieved }`.
   `source` is a URL and `quote` the line copied from it. Start with the
   phone error rates of the Kaldi TIMIT recipe (GMM-HMM rows of its
   `RESULTS` file). The column "Comparable" says "yes" only when {{P64}}
   measured on the same test set; otherwise "no, other data".
8. Part D: the matrix of `docs/reports/lowest-settings.json` ({{P69}}),
   unchanged. Part E, speed: real-time factor per tier and engine on one
   core and on all cores, time to first sound and the cost of the load-time
   benchmark, from the suite `performance` ({{P19}}), with the CPU model.
9. Goals table. One row for every sentence under "What the system does when
   the vision is reached" and "How quality is judged" in `docs/VISION.md`:
   goal, evidence (number and link to the part), status. For every row that
   is `not met` or `not measured` open a GitHub issue named "Gap: <goal>"
   with the number, the target and the link, and put its link in the row.
10. Publish, all under the Unlicense, in `docs/reports/listening/<test id>/`:
    `sentences.json`, `results/*.json` (the anonymous answers as {{P08}}
    stores them), `report.md` and `stimuli.sha256` (hashes of the stimuli
    this project rendered). Attach a zip of the project's own stimuli to the
    GitHub release; they can also be rendered again from `sentences.json` at
    the evaluation commit. Audio of other synthesizers is not published.
    Add `docs/reports/listening/README.md` that says so.
11. Update `docs/VISION.md` ("Where the project is today": every row, and
    "Evidence" with a link to the report), `docs/ROADMAP.md` and a README
    section "How good is it?" with the goals table.
12. Wording check `scripts/check-claims.mjs`, added to `npm run check`. It
    reads `README.md`, `docs/VISION.md`, the `description` of `package.json`
    and `examples/universal-app/src/i18n.js`. A paragraph that contains
    "state of the art", "state-of-the-art", "indistinguishable" or
    "human-like" must also contain a link to
    `docs/reports/state-of-the-art.md` or the word "goal"; else exit 1.

## Tests

`tests/state-of-the-art-report.test.js` (fast; fixtures in
`tests/fixtures/sota/`, no audio):

- `builds all five parts`: `buildReport` of the fixtures has the headings
  of parts A to E and the goals table.
- `decides the recording goal`: 100 right of 200 with a MUSHRA interval of
  −3 to 4 gives `met` (Wilson upper end 0.569); 130 of 200 gives `not met`.
- `marks missing data`: without the listening folder the goal is
  `not measured` and the part says "not measured".
- `labels the neural yardstick`: a condition named `neural` is printed as
  "neural (yardstick)" and is in no decision.
- `rejects a number without a source`: an entry of
  `published-references.json` without `source` or `quote` throws.
- `keeps answers anonymous`: a result file with a key outside the schema of
  {{P08}} (for example `email`) throws.
- `finds an unsupported claim`: `check-claims.mjs` exits with 1 on a fixture
  paragraph "state-of-the-art speech" and with 0 when the link is added.

## Acceptance criteria

- [ ] `docs/reports/state-of-the-art.md` and `.json` are committed with
      parts A to E, the goals table, the evaluation commit and the command
      of every number.
- [ ] Every published listening test has 20 or more listeners after
      screening, or carries the label "underpowered"; the report prints the
      count per test.
- [ ] `git ls-files docs/reports examples/listening-test` lists no file
      ending in `.wav`, `.flac`, `.mp3` or `.ogg`.
- [ ] Every goal with the status `not met` or `not measured` links to an
      open GitHub issue.
- [ ] `node scripts/check-claims.mjs` exits with 0.
- [ ] `docs/VISION.md` links to the report in the row "Evidence".
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Closing the gaps the report finds. Each gets its own issue (step 9).
- Automatic "quality prediction" by a neural network, and licensed tools
  such as PESQ or POLQA. Objective numbers come from {{P06}} only.
- Paying listeners or using a crowd platform.
- Tests in languages other than the four the simulator speaks.

## References

- ITU-R BS.1534-3 (2015). Method for the subjective assessment of
  intermediate quality level of audio systems (MUSHRA).
  https://www.itu.int/rec/R-REC-BS.1534
- Benoît, C., Grice, M., Hazan, V. (1996). The SUS test: a method for the
  assessment of text-to-speech synthesis intelligibility using semantically
  unpredictable sentences. Speech Communication 18(4), 381-392.
- Wilson, E. B. (1927). Probable inference, the law of succession, and
  statistical inference. Journal of the American Statistical Association 22.
- Kaldi TIMIT recipe, results file:
  https://raw.githubusercontent.com/kaldi-asr/kaldi/master/egs/timit/s5/RESULTS
- eSpeak NG: https://github.com/espeak-ng/espeak-ng ; klatt-syn:
  https://github.com/chdh/klatt-syn ; VocalTractLab:
  https://www.vocaltractlab.de/ ; Pink Trombone:
  https://dood.al/pinktrombone/
- Research notes: `docs/case-studies/issue-11/research/1-similar-projects.md`
  ("Gaps") and `2-inversion-and-recognition.md` (section 7).
