# Listening test

A blind listening test that runs in a web browser from a folder on disk: no
server, no network, no account. It has four kinds of trial:

- **MUSHRA** (ITU-R BS.1534-3): the listener rates several versions of a
  sentence from 0 to 100 against a reference. One of the versions is the
  reference itself (the hidden reference) and two are the reference with
  everything above 3.5 kHz (`anchor35`) or 7 kHz (`anchor70`) removed.
- **ABX**: the listener hears A, B and X and says whether X is A or B, which
  shows whether two versions can be told apart at all.
- **Intelligibility**: the listener types the words of a sentence heard once
  (or `maxPlays` times); the word error rate (WER) measures how
  understandable the voice is.
- **Choice**: the listener hears a sentence (at most `maxPlays` times, 2
  by default) and picks one of several names, for example the emotion it
  is spoken with (issue 55). The answers give a confusion matrix.

The page keeps everything in the browser. At the end the listener presses
**Download results**, which saves `listening-<test id>-<listener>.json`, and
sends that file back by hand. The file holds the ratings, the answers, the
play counts, the seconds spent on each trial, whether headphones were used
and, if given, the native language. It holds no name, address or browser
details; `listener` is 8 random hexadecimal characters.

## Run a test (for the person who organises it)

1. **Write the sentences.** Copy `sentences.example.json` and edit it. Each
   entry is `{id, text, lang, tiers, type?, reference?, extra?, maxPlays?}`
   (and `emotions`, `choices`, `intensity` for a choice entry):
   - `type` is `mushra` (the default), `abx`, `intelligibility` or `choice`;
   - `tiers` are quality tiers of the simulator (`minimal`, `low`,
     `medium`, `high`, `ultra`, `studio`), each rendered with seed 1;
   - `reference` is an optional recording of a real voice (WAV, FLAC, AIFF
     or AU). Without it, the reference of a MUSHRA trial is the rendering
     at the most detailed tier listed;
   - `extra` maps a condition name to a sound file you supply, for example
     another synthesiser's output: `"extra": {"other": "other/en-01.wav"}`.
     Those files are only read and copied; they are never committed and no
     code of another synthesiser is ever run.

   File names are relative to the sentences file. A MUSHRA entry gets the
   reference, the two anchors, every tier and every extra (at most 12). An
   ABX entry needs exactly two sounds (reference, tiers and extra together),
   which become A and B. An intelligibility entry gives one trial per tier
   or extra; give each its own sentence (one tier per entry) so that no one
   hears a sentence twice. A choice entry has one tier (`medium` when none
   is given), no reference and no extra, and gives one trial per name of
   `emotions` (emotion presets of `EMOTION_PRESETS`): the text is spoken as
   `[name intensity]text[/name]` (`intensity` 0 … 1, 1 by default), and
   the listener picks among `choices` (by default the emotions; it must
   hold each of them).

   For intelligibility, use semantically unpredictable sentences, which a
   listener cannot guess from context:

   ```sh
   node scripts/listening-test.mjs sus --lang en --count 20 --seed 1
   ```

2. **Build the sounds.**

   ```sh
   node scripts/listening-test.mjs build \
     --sentences examples/listening-test/sentences.example.json \
     --out examples/listening-test
   ```

   This writes `stimuli/` (16-bit mono WAV at 48000 Hz, every file at an RMS
   of −26 dBFS, plus `stimuli/volume.wav`, 2 s of pink noise for the volume
   check) and `config.js`. The renderings of one choice entry share one
   gain instead (rendered with a headroom of 20 dB, the first emotion at
   −26 dBFS unless a peak would pass 0.98), so that a loud or a soft
   emotion keeps its level. Both are listed in `.gitignore`, so the build
   leaves `git status` clean. The example takes about 8 s.

3. **Try it yourself.** Open `index.html` in a browser (double-click it).
   If it shows "The test cannot start", the list below says what is wrong.

4. **Send the test.** Zip the folder (`index.html`, `app.js`, `styles.css`,
   `config.js` and `stimuli/`) and send it to at least 8 listeners, with the
   steps below.

   The emotion study of issue 55 builds 48 choice trials (two sentences in
   each of `en`, `ru`, `hi` and `zh`, each in six emotions, about 25 s):

   ```sh
   node scripts/listening-test.mjs build \
     --sentences examples/listening-test/emotions.sentences.json \
     --out examples/listening-test
   ```

   See [docs/listening-tests/emotions.md](../../docs/listening-tests/emotions.md).

5. **Analyse the answers.**

   ```sh
   node scripts/listening-test.mjs analyze results/*.json \
     --config examples/listening-test/config.js \
     --out docs/reports/listening/<test id>/report.md
   ```

   The report has one table per kind of trial, the numbers of listeners and
   trials, and the command. Commit the result files and the report to
   `docs/reports/listening/<test id>/`. `--json` prints the numbers as JSON.

## Take a test (for the listener)

1. Unzip the folder you received.
2. Put on headphones and go somewhere quiet.
3. Open `index.html` in Chrome, Edge or Firefox.
4. Read the text, tick "I am using headphones" if you are, and play the
   volume check sound. Set the volume so that it is comfortable, then leave
   it as it is.
5. Press **Start** and follow the instruction above each trial. **Next**
   becomes available once the trial is complete: in a MUSHRA trial you have
   played every version and rated one of them 100; in a choice trial you
   have played the sentence and picked an answer.
6. At the end press **Download results** and send the downloaded file to the
   person who asked you to take the test.

## What the analysis does

- **Post-screening** (BS.1534-3): a listener who rated the hidden reference
  below 90 in more than 15 % of their MUSHRA trials is dropped from every
  table, and the report says how many were dropped.
- **MUSHRA**: each listener's ratings of a condition are averaged first; the
  table gives the mean over listeners with a 95 % bootstrap interval (10 000
  resamples, seed 1). For every pair of conditions the bootstrap interval
  of the per-listener difference is given; the pair is "different" when the
  interval excludes 0.
- **ABX**: the share of correct answers with its Wilson 95 % interval, and p,
  the chance of at least as many correct answers by guessing.
- **Intelligibility**: the WER of each answer against the text (the same
  `errorRate` as `voice-simulator compare`), per trial and as a mean over
  listeners with a bootstrap interval.
- **Choice**: per answer (e.g. per emotion) and per language the share of
  correct answers with its Wilson 95 % interval and p, the chance of at
  least as many correct answers by guessing among the choices
  (`binomialTailP(correct, total, p)`, p = 1 / number of choices), the mean
  over answers, and the confusion matrix (rows: the answer, columns: what
  the listeners picked). Like the intelligibility trials, it reads the
  trials from `config.js` (`--config`, default
  `examples/listening-test/config.js`).

With fewer than 8 listeners the report says that its numbers support no
claim.

## Files

| File                      | What it is                                                     |
| ------------------------- | -------------------------------------------------------------- |
| `index.html`              | The page; loads `config.js` and `app.js` with plain `<script>` |
| `app.js`                  | The test (a classic script; functions on `ListeningTest`)      |
| `styles.css`              | Layout, light and dark                                         |
| `config.example.js`       | A hand-written configuration showing every field               |
| `sentences.example.json`  | Input of `build`: one trial of each kind                       |
| `emotions.sentences.json` | Input of `build`: the emotion study of issue 55 (48 trials)    |
| `sus.en.json`             | Frames and word lists of `sus` (CC0)                           |
| `config.js`, `stimuli/`   | Written by `build`; not committed                              |

The page sets `Content-Security-Policy: connect-src 'none'`, so it cannot
send anything even by mistake, and `app.js` has no network code. Its random
numbers come from its own copy of mulberry32, the generator of
`src/random.js`; a session's seed is drawn with `crypto.getRandomValues` and
stored in the result, so the order of every listener's trials can be
replayed with `ListeningTest.planSession(config, seed)`.
