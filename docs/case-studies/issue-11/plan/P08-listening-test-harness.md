---
id: P08
title: 'Listening-test harness: MUSHRA, ABX and intelligibility'
type: Feature
milestone: M0
blocked_by: []
requirements: [R1, R19]
---

## Goal

Add a small web page that runs blind listening tests with people, and a script
that prepares the sound files and analyses the answers. Three kinds of trial:
MUSHRA (rate several versions of a sentence against a reference), ABX (is X
the same as A or as B?) and intelligibility (type what you heard). The page
works when opened from disk, sends nothing over the network and stores no
personal data.

## Why

The vision defines "state of the art" as a voice that people cannot tell from
a recording in a blind test, and says naturalness is "measured by people in
blind comparisons that include real recordings and other synthesisers".
Objective metrics ({{P06}}) cannot answer that question. Neural quality
predictors are not allowed, so the only valid judge of naturalness is a
listener, and the project has no tool to ask one.

## Current state

- There is no listening test in the repository. The only app is
  `examples/universal-app` (React, built with Vite; it needs a build step).
- Quality has been judged by the authors' ears and by formant checks
  (`docs/case-studies/issue-9/README.md`).
- Useful existing code: `synthesize()`, `encodeAudio()` / `decodeAudio()`
  (`src/audio/formats.js`), `resample(samples, fromRate, toRate)` with a
  built-in low-pass (`src/audio/resample.js`), `createRandom(seed)`
  (`src/random.js`).
- `package.json` has `"type": "module"`. A browser refuses to load ES modules
  and to `fetch()` files from a page opened as `file://`, so a page that must
  work from disk has to use classic scripts and `<audio>` elements.
- The public tool webMUSHRA has its own licence (not a standard open-source
  one) and needs a server, so it is not copied here.

## What to do

1. Create the folder `examples/listening-test/` with:
   - `index.html`: one page, no external resource. It loads `config.js` and
     `app.js` with plain `<script src>` tags and contains
     `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'">`.
   - `app.js`: a classic script without `import` or `export`. It puts its
     pure functions on `globalThis.ListeningTest` and touches `document` only
     inside `ListeningTest.start()`, which `index.html` calls. Because it
     cannot import `src/random.js`, it carries its own seeded generator
     (mulberry32, about ten lines; say so in a comment).
   - `styles.css`, `README.md` (how to run a test, in simple steps) and
     `config.example.js`.
   - Add `examples/listening-test/stimuli/` and
     `examples/listening-test/config.js` to `.gitignore`.
2. Configuration: `config.js` contains
   `globalThis.LISTENING_TEST_CONFIG = {...}` with this shape:

   ```json
   {
     "id": "baseline-en",
     "title": "Voice quality test",
     "instructions": "Text shown before the first trial.",
     "trials": [
       {
         "type": "mushra",
         "id": "en-01",
         "text": "Optional text of the sentence.",
         "reference": "stimuli/en-01/reference.wav",
         "conditions": {
           "reference": "stimuli/en-01/reference.wav",
           "anchor35": "stimuli/en-01/anchor35.wav",
           "anchor70": "stimuli/en-01/anchor70.wav",
           "studio": "stimuli/en-01/studio.wav"
         }
       },
       { "type": "abx", "id": "abx-01", "a": "a.wav", "b": "b.wav" },
       {
         "type": "intelligibility",
         "id": "sus-01",
         "audio": "sus-01.wav",
         "text": "The reference words.",
         "maxPlays": 2
       }
     ]
   }
   ```

   `ListeningTest.validateConfig(config)` returns a list of error strings:
   missing `id`, duplicate trial `id`, unknown `type`, a MUSHRA trial without
   a condition named `reference` or with more than 12 conditions, an ABX
   trial without `a` or `b`, an intelligibility trial without `audio` or
   `text`.

3. Session plan: `ListeningTest.planSession(config, seed)` returns the trials
   in a shuffled order (Fisher-Yates with the seeded generator). For each
   MUSHRA trial it shuffles the conditions and names them `A`, `B`, ... on
   screen. For each ABX trial it draws `x` as `'a'` or `'b'` with equal
   chance. The seed is drawn once with `crypto.getRandomValues` and stored
   in the result.
4. Screens:
   - Start: instructions, a check box "I am using headphones", an optional
     field "native language (two letters)", a volume check sound, a button
     "Start".
   - MUSHRA (ITU-R BS.1534-3): a button "Reference" and one "Play" button
     and one slider per condition. Slider 0 to 100, step 1, start value 0,
     with the labels Bad (0-20), Poor (20-40), Fair (40-60), Good (60-80),
     Excellent (80-100). The listener may switch freely. "Next" is enabled
     when every condition was played at least once and at least one slider
     is at 100. The instruction says: "One of the versions is the reference
     itself. Rate it 100."
   - ABX: buttons "Play A", "Play B", "Play X" and the answers "X is A" and
     "X is B". "Next" is enabled after X was played once and an answer was
     chosen.
   - Intelligibility: "Play" (at most `maxPlays` times, default 1), a text
     field, "Next".
   - End: a button "Download results" that saves the result as
     `listening-<test id>-<listener>.json` with a `Blob` and an
     `<a download>` link, and the text "Send this file to the person who
     asked you to take the test."
5. Result file, built by `ListeningTest.buildResult(...)`:
   `{schema: 1, test, listener, seed, date, headphones, nativeLanguage,
trials}`. `listener` is 8 random hexadecimal characters; `date` is
   `YYYY-MM-DD` without the time. Trial records: MUSHRA
   `{id, type, order, ratings, plays, seconds}` with `ratings` and `plays`
   keyed by the real condition names; ABX
   `{id, type, x, answer, correct, plays, seconds}`; intelligibility
   `{id, type, typed, plays, seconds}`. Nothing else is stored: no name, no
   address, no browser details.
6. Create `scripts/listening-test.mjs` with two commands.
   - `build --sentences <file.json> --out examples/listening-test`: for each
     entry `{id, text, lang, reference?, tiers, extra?}` write the stimuli
     and `config.js`. `reference` is a recording supplied by the tester; when
     absent, the reference is the rendering with the most detailed tier
     listed. `tiers` are simulator tiers to render with `seed: 1`. `extra`
     maps a name to a file supplied by the tester (for example another
     synthesiser). The anchors are the reference resampled to 7000 Hz and
     back (`anchor35`, band limit 3.5 kHz) and to 14000 Hz and back
     (`anchor70`, 7 kHz). Every file is written as 16-bit mono WAV at
     48000 Hz, scaled to an RMS of -26 dBFS.
   - `analyze <result.json>... [--json] [--out report.md]`: see below.
7. Analysis, as exported functions of the same script:
   - `screenListeners(results)`: drop a listener who rated the hidden
     reference below 90 in more than 15 % of their MUSHRA trials (the
     post-screening rule of BS.1534-3). Report how many were dropped.
   - `bootstrapInterval(values, {resamples: 10000, seed: 1})`: mean and the
     2.5th and 97.5th percentile of the means of resamples drawn with
     replacement using `createRandom(seed)`.
   - MUSHRA: per condition, average each listener's ratings first, then
     report the mean over listeners and its bootstrap interval. For every
     pair of conditions report the bootstrap interval of the difference of
     the per-listener means; call the pair "different" when the interval
     does not contain 0.
   - ABX: `wilsonInterval(correct, total)` with `z = 1.959964`:
     `(p + z^2/(2n) ± z*sqrt(p(1-p)/n + z^2/(4n^2))) / (1 + z^2/n)`, and
     `binomialTail(correct, total)`, the chance of at least `correct` right
     answers by guessing: `sum_{k>=correct} C(n, k) / 2^n`.
   - Intelligibility: word error rate of `typed` against `text` per trial
     and its mean with a bootstrap interval. If `src/metrics/text.js` exists
     ({{P06}} was merged), import `errorRate` from it. If not, write a local
     function `wordErrorRate(reference, typed)` (lower case, punctuation
     removed, Levenshtein distance over words divided by the number of
     reference words) with the comment
     `// replace with errorRate from src/metrics when it exists`.
   - Output: a Markdown report with one table per kind of trial, the number
     of listeners and trials, and the exact command that produced it.
8. Semantically unpredictable sentences for the intelligibility trials:
   `scripts/listening-test.mjs sus --lang en --count 20 --seed 1` prints
   sentences built from five fixed sentence frames and word lists (at least
   40 nouns, 25 verbs, 25 adjectives, common one- and two-syllable words,
   written by the contributor and committed in
   `examples/listening-test/sus.en.json`). Only English in this issue; for
   other languages the tester writes the sentences into the sentences file.
9. Add a section "Listening tests" to `README.md` and to
   `docs/CONTRIBUTING.md`: when a test is required (before a claim about
   naturalness is written anywhere), at least 8 listeners, where the result
   files and the report go (`docs/reports/listening/<test id>/`), and the
   consent sentence shown on the start screen. The `.gitignore` line
   `reports/` also ignores `docs/reports/`; {{P02}} changes it to
   `/reports/`. If that is not merged yet, make the same change here.

Rules about other synthesisers: their audio may be a condition in a test,
supplied by the tester through `extra`. It is never committed (the
`stimuli/` folder is ignored by git), and no code in this repository runs
them.

## Tests

Add `tests/listening-test.test.js`. It loads the page script with
`await import('../examples/listening-test/app.js')` and reads
`globalThis.ListeningTest`.

- `validates a configuration`: the example passes; each error listed in step
  2 is reported for a broken copy.
- `plans a session deterministically`: the same seed gives the same order;
  100 different seeds put each of 4 conditions first at least 10 times;
  `x` is `'a'` between 35 and 65 times out of 100.
- `builds an anonymous result`: the keys are exactly those of step 5 and
  `date` matches `^\d{4}-\d{2}-\d{2}$`.
- `makes no network calls`: `app.js` and `index.html` do not contain
  `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `http://` or
  `https://`; `index.html` contains `connect-src 'none'`.
- `wilson interval`: `wilsonInterval(15, 20)` is `[0.5313, 0.8881]` ±
  `0.0001`.
- `binomial tail`: `binomialTail(15, 20)` is `0.020695` ± `0.000001`.
- `bootstrap interval is seeded`: two calls give identical numbers; for the
  values 1 to 100 the interval contains 50.5 and is narrower than 15.
- `screens out a careless listener`: a listener with the reference rated 50
  in 2 of 5 trials is dropped; one with 1 of 10 is kept.
- `analyses a synthetic study`: 10 generated listeners rate `reference` 100,
  `studio` near 60, `anchor35` near 20; the report orders them so and calls
  each pair different.
- `builds stimuli`: `build` with one sentence and the tiers `minimal` and
  `low` writes 5 WAV files of equal sample rate whose RMS is -26 dBFS ±
  0.2 dB, and the spectrum of `anchor35` above 4 kHz is at least 30 dB below
  that of the reference.

## Acceptance criteria

- [ ] After `node scripts/listening-test.mjs build --sentences
examples/listening-test/sentences.example.json --out
examples/listening-test`, opening `examples/listening-test/index.html`
      from disk (address starts with `file://`) in Chromium and in Firefox
      runs one MUSHRA, one ABX and one intelligibility trial and downloads a
      result file. The browser's network panel shows no request other than
      the local files.
- [ ] Screenshots of the three kinds of trial are committed in
      `docs/screenshots/listening-test/` and shown in the pull request.
- [ ] `node scripts/listening-test.mjs analyze <the downloaded file>` prints
      a report with three tables.
- [ ] `git status` after a build shows no new untracked file under
      `examples/listening-test/` (stimuli and `config.js` are ignored).
- [ ] All tests above pass on Node.js, Bun and Deno.
- [ ] `npm run check` and `npm test` pass; a patch changeset is added.

## Out of scope

- Recruiting listeners and running a study. The first study is part of the
  state-of-the-art report: {{P71}}.
- Hosting the page. Any static host works; none is set up here.
- Real recordings as references: they come from the golden set, {{P05}}.
- Objective metrics: {{P06}}.

## References

- ITU-R BS.1534-3 (2015). Method for the subjective assessment of
  intermediate quality level of audio systems (MUSHRA).
  <https://www.itu.int/rec/R-REC-BS.1534>
- Schoeffler, M. et al. (2018). webMUSHRA: a comprehensive framework for
  web-based listening tests. Journal of Open Research Software 6(1).
  <https://doi.org/10.5334/jors.187>
- Benoît, C., Grice, M. and Hazan, V. (1996). The SUS test: a method for the
  assessment of text-to-speech synthesis intelligibility using semantically
  unpredictable sentences. Speech Communication 18(4), 381-392.
- Wilson, E. B. (1927). Probable inference, the law of succession, and
  statistical inference. Journal of the American Statistical Association
  22(158), 209-212.
- Efron, B. (1979). Bootstrap methods: another look at the jackknife. The
  Annals of Statistics 7(1), 1-26.
- Research notes:
  `docs/case-studies/issue-11/research/2-inversion-and-recognition.md`,
  section 7.
