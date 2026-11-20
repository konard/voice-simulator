# Synthetic speech round trips

Measured 2026-11-20 on benchmark commit `83bd5633e3322d80d1c0863372f751f8a42092a8`.
The [full round-trip workflow](https://github.com/konard/voice-simulator/actions/runs/44799632294)
is in progress. These measurements use the seeded voice generator.

## Telephone baseline

The four rows cover the first two sentences per language with the male and
female presets. A dash for timing means that no syllable pairs had identical
IPA. All four rows missed the PER, sound WER, timing, and language gates.

```bash
HEAVY_LIMIT=2 HEAVY_OUT=/tmp/voice-75-telephone-report taskset -c 1 node --test --test-name-pattern='^main (en|ru|hi|zh) telephone$' tests/heavy/roundtrip-sentences.test.js
```

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male, female | 4 | 85.7% | 100.0% | 96.2% | 100.0% | – | 50.0% | – | 25.0% | 100.0% | – | 5.226 | PER 0.857 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.250 (need ≥ 0.9) |
| ru | telephone | male, female | 4 | 76.7% | 107.7% | 95.8% | 107.7% | – | – | – | 25.0% | 50.0% | – | 12.632 | PER 0.767 (need ≤ 0.1)<br>sound WER 1.077 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.250 (need ≥ 0.9)<br>sentence mark match share 0.500 (need ≥ 0.85) |
| hi | telephone | male, female | 4 | 94.4% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 50.0% | – | 1.966 | PER 0.944 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.500 (need ≥ 0.85) |
| zh | telephone | male, female | 4 | 85.7% | – | 173.1% | 173.1% | 76.9% | – | – | 25.0% | 25.0% | – | 1.611 | PER 0.857 (need ≤ 0.1)<br>sound WER 1.731 (need ≤ 0.2)<br>tone error 0.769 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.250 (need ≥ 0.9)<br>sentence mark match share 0.250 (need ≥ 0.85) |

## Single-core smoke baseline

`taskset -c 0 node --test tests/roundtrip-smoke.test.js` used 45.4 seconds of
user CPU time and took 213.0 seconds of wall time on a contended host. The
target is under 30 seconds on one core. All three cases ran at 8 kHz using
the male preset with seed 1.

| Language | Reference text            | Heard text      | Phone errors | Sound word errors | Top language |
| -------- | ------------------------- | --------------- | ------------ | ----------------- | ------------ |
| English  | Is this your pen or mine? | 脸 а мы я и.      | 12/16        | 6/6               | Russian      |
| Russian  | Привет, как дела?         | Pay? A why я.   | 7/13         | 4/3               | English      |
| Mandarin | 我是中国人。                | Leah meir अंग. | 13/13        | 11/5              | English      |

## Decoder diagnosis

`node experiments/issue-75-stage-trace.mjs` uses the default voice and compares the IPA immediately
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

With the seeded male preset
(`node experiments/issue-75-decoder-costs.mjs --seeded-preset --length-models`),
a diagnostic search restricted to the three best acoustic labels at each
span still missed 42 of 54 phones. The search with the full phone inventory
missed 5 of 12 Hindi phones because the decoder assigns one length to each
label. Offering both lengths at every boundary gave the reference-guided
search a path with zero edits. The ordinary acoustic search made 43 edits,
and explicit short and long phone models made 45 and 46 at the two duration
weights tested. The existing boundaries can accommodate the reference
sequence, but the acoustic evidence needs to rank those labels higher.

`node experiments/issue-75-telephone-templates.mjs --search` uses the seeded
male voice to render generic phones in three contexts at 8 kHz. Even on the
known phone boundaries and within the correct language inventory, the best
scoring variant ranked only 22 of the 54 reference phones first. Adding
spectral distance to the acoustic search changed the total from 44 phone
errors to 42 in its best trial. The other weights produced 43 and 44 errors.
All of those search trials used the correct language and disabled automatic
whisper detection. The public benchmark uses its normal settings.
