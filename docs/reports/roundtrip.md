# Synthetic speech round trips

Measured 2026-11-20 on commit `3fe19e7c62672efdff771ddb4fe13fad0d73d34b`.
The [full round-trip workflow](https://github.com/konard/voice-simulator/actions/runs/44796842943)
is in progress. The measurements below cover the three 8 kHz smoke cases.

## Single-core smoke baseline

`taskset -c 0 node --test tests/roundtrip-smoke.test.js` ran in 44.6 seconds.
All three utterances used the telephone tier, the male preset, and seed 1.
The smoke criteria require a phone error rate of at most 10%, zero sound
word errors, correct language detection, and a total time under 30 seconds.

| Language | Tier | Reference text            | Heard text   | Phone errors | Sound word errors | Language right |
| -------- | ---- | ------------------------- | ------------ | ------------ | ----------------- | -------------- |
| English  | telephone | Is this your pen or mine? | Gktapy i.    | 13/16        | 6/6               | yes            |
| Russian  | telephone | Привет, как дела?         | तेइ, i tie! | 9/13         | 3/3               | no             |
| Mandarin | telephone | 我是中国人。                | 偶？            | 10/13        | 5/5               | yes            |

## Decoder diagnosis

`node experiments/issue-75-stage-trace.mjs` compares the IPA immediately
after acoustic decoding with the IPA after text and prosody recovery.
Acoustic phone error rates were 81.25% for English, 61.54% for Russian, and
76.92% for Mandarin. The acoustic stage had already lost most of the
reference phones. The simulation matcher currently accepts English
proposals from 22.05 and 48 kHz input only. Telephone input uses the
general tract-inversion decoder.

Disabling automatic whisper detection for the Russian case left final PER
at 69.23%. Supplying the synthesis voice and language for each case also
left acoustic PER between 53.85% and 92.31%. These runs use reference
information or non-default options for diagnosis. The benchmark gates
use audio and the recognition level alone.

`node experiments/issue-75-decoder-costs.mjs` tested the three smoke cases
and Hindi sentence 2 with whisper detection disabled. The default acoustic
search made 44 phone edits over 54 reference phones. Increasing the duration
penalty made 45 edits, lowering the phone transition penalty made 48, and
weighting acoustic costs by span duration made 49. Combining the latter two
changes made 56 edits. The wider gap remains in acoustic phone scoring and
segmentation.

Giving a diagnostic search the reference phones and every label in the
existing boundary graph still left 5 of 12 Hindi phones wrong. Restricting
that search to the three best acoustic labels at each span left 39 of 54
phones wrong across the four cases. These are lower bounds with the current
graph and scores. Widening the beam alone cannot recover the discarded
Hindi phones, and lexical rescoring would need to reach far below the
highest-ranked labels for the other cases.
