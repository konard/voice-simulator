# Listening test: emotions (issue 55)

**Status: not run.** No listeners were available when issue
[#55](https://github.com/konard/voice-simulator/issues/55) was solved. This
page describes the test and how to run it. It has no results yet, and
nothing on it is a guess at what listeners would answer. The acceptance
box of issue 55 for this test stays open until the test has been run and
its report is added below.

## What to expect

Listeners name the emotion of human actors in 72 to 91 % of the cases
(Pell et al. 2009). Rule-based formant synthesis reaches 50 to 80 %
(Schröder 2001). The presets of the simulator are rules of this kind
([docs/markup.md](../markup.md#emotions-and-attitudes)), so they should be
recognisable but less clear than an actor.

## Design

- **Stimuli**: two neutral sentences per language (`en`, `ru`, `hi`,
  `zh`; [emotions.sentences.json](../../examples/listening-test/emotions.sentences.json)),
  each spoken in `neutral`, `happy`, `sad`, `angry`, `afraid` and `bored`
  at intensity 1, tier `medium`: 8 × 6 = **48 choice trials**.
- **Trial**: the listener hears the sentence (at most twice) and picks one
  of the six emotions. Chance is 1/6 = 16.7 %.
- **Level**: the six renderings of one sentence share one gain (rendered
  with a headroom of 20 dB; the neutral one at an RMS of −26 dBFS unless a
  peak would pass 0.98), so loudness stays a cue, as it is in speech.
- **Listeners**: at least 10, so that each emotion and language gets 20 or
  more answers.

Levels of the built stimuli (RMS, peak and length;
`node experiments/issue-55-stimuli-levels.mjs /tmp/lt55 en-1,ru-1,hi-1,zh-2`
after building into `/tmp/lt55`, saved in
[experiments/issue-55-stimuli-levels.txt](../../experiments/issue-55-stimuli-levels.txt)):

| Sentence     | neutral | happy | sad   | angry | afraid | bored |
| ------------ | ------- | ----- | ----- | ----- | ------ | ----- |
| emotion-en-1 | −26.0   | −18.3 | −33.5 | −16.6 | −18.4  | −31.1 |
| emotion-ru-1 | −35.3   | −31.1 | −43.3 | −25.0 | −31.3  | −41.5 |
| emotion-hi-1 | −31.0   | −23.8 | −38.3 | −17.8 | −24.6  | −36.1 |
| emotion-zh-2 | −26.2   | −21.2 | −33.9 | −15.7 | −24.9  | −31.6 |

(dBFS. In `ru-1`, `hi-1` and `zh-2` the angry rendering reaches the peak
limit of 0.98, which lowers the whole sentence.)

## Criteria

- Every one of the six emotions is named correctly in **≥ 40 %** of its
  trials.
- The mean over the six emotions is **≥ 50 %**.

With 20 answers and chance 1/6, the probability of at least k correct
answers by guessing (`binomialTailP(k, 20, 1/6)` of
[scripts/listening-test.mjs](../../scripts/listening-test.mjs)):

| k of 20 | Share | p by guessing |
| ------- | ----- | ------------- |
| 6       | 30 %  | 0.102         |
| 7       | 35 %  | 0.0371        |
| 8       | 40 %  | 0.0113        |
| 9       | 45 %  | 0.00284       |
| 10      | 50 %  | 0.000599      |

So 40 % (8 of 20) is above chance with p < 0.02.

## How to run it

```sh
# 48 trials (about 25 s)
node scripts/listening-test.mjs build \
  --sentences examples/listening-test/emotions.sentences.json \
  --out examples/listening-test

# Open examples/listening-test/index.html in a browser (or serve the
# directory), let each listener take the test and collect the downloaded
# result files in docs/reports/listening/emotions/, then:
node scripts/listening-test.mjs analyze docs/reports/listening/emotions/*.json \
  --config examples/listening-test/config.js \
  --out docs/reports/listening/emotions/report.md
```

As for every listening test of the README, the result files and the report
are committed to `docs/reports/listening/emotions/`, and the share per
emotion, the mean and the confusion matrix are copied to the Results
section below.

The analysis reports, per emotion and per language, the share of correct
answers with its Wilson 95 % interval and the p of the binomial test
against 1/6, the mean over the emotions, and the confusion matrix (rows:
the emotion played, columns: the emotion chosen). Listeners who fail the
checks of the harness are left out, as in the other tests of
[examples/listening-test](../../examples/listening-test/README.md).

## Results

None yet: the test has not been run.
