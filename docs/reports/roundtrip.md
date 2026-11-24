# Synthetic speech round trips

Measured 2026-11-24 on commit `77c36a28c158f6bf6593888c17ae0527592aa6c2`.
The [full round-trip run](https://github.com/konard/voice-simulator/actions/runs/45492367250)
finished in 21 minutes with 8 passing and 69 failing tests. The tables
below are its `roundtrip.md` artifact. The tests that passed are the
narrowband whisper rows for English, Russian and Hindi, and the mode rows for
telephone, narrowband, wideband, minimal and low.

Recognition now decodes words with the Gaussian HMM (`decoder: 'words'`).
Compared with the [previous full run](https://github.com/konard/voice-simulator/actions/runs/44942169457)
on `8a1d734`, which used the phone decoder, telephone phone error fell:

| Language | PER before | PER now | Language right before | Language right now |
| --- | --- | --- | --- | --- |
| English | 86.4% | 9.7% | 27.5% | 100.0% |
| Russian | 84.1% | 14.9% | 32.5% | 95.0% |
| Hindi | 94.0% | 14.5% | 2.5% | 100.0% |
| Mandarin | 87.4% | 6.2% | 37.5% | 97.5% |

The telephone gates still fail on sound WER for all four
languages (28.2%, 46.0%, 31.6% and 27.9% against 20%). They also fail on
PER for Russian and Hindi, on tone error for Mandarin (17.2% against 15%),
and on sentence marks for Russian and Mandarin. The tiers set fails on PER
at every tier. See "Word recogniser diagnostics" below.

Command: `npm run test:heavy -- --suite roundtrip`.

All renders use seed 1 and select their voice preset with the seeded head generator. Recognition receives audio and the level for its tier. The reference tier is excluded because of its run time.

Edit rates divide summed edits by summed reference length. Stress covers aligned words of equal syllable count. Timing covers start and end boundaries of aligned syllables with identical IPA. A dash indicates an inapplicable metric or no matches. Recognition RTF divides total recognition time by total audio time.

Mandarin uses character error rate in place of orthographic word error, including for the whisper gate. Sound WER compares Mandarin character pronunciations in context.

The mode tests measure the share of reference spans with matching notation and at least half of their duration overlapped by a recognition span. The gate uses all four languages at each tier.

Rows for male and female presets show their separate measurements when the gates use their combined results.

## main

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male, female | 40 | 9.7% | 26.8% | 13.3% | 28.2% | – | 100.0% | 8.1 | 100.0% | 85.0% | – | 0.269 | sound WER 0.282 (need ≤ 0.2) |
| en | telephone | male | 20 | 8.7% | 24.6% | 12.3% | 26.1% | – | 100.0% | 8.1 | 100.0% | 85.0% | – | 0.281 | – |
| en | telephone | female | 20 | 10.7% | 28.9% | 14.2% | 30.3% | – | 100.0% | 8.0 | 100.0% | 85.0% | – | 0.256 | – |
| en | narrowband | male, female | 40 | 9.7% | 29.2% | 13.4% | 30.3% | – | 100.0% | 8.2 | 100.0% | 85.0% | – | 0.228 | PER 0.097 (need ≤ 0.08)<br>sound WER 0.303 (need ≤ 0.15) |
| en | narrowband | male | 20 | 9.5% | 30.3% | 14.6% | 32.4% | – | 100.0% | 8.0 | 100.0% | 85.0% | – | 0.202 | – |
| en | narrowband | female | 20 | 9.9% | 28.2% | 12.3% | 28.2% | – | 100.0% | 8.4 | 100.0% | 85.0% | – | 0.255 | – |
| en | wideband | male, female | 40 | 10.1% | 29.6% | 15.5% | 30.6% | – | 100.0% | 7.8 | 100.0% | 85.0% | – | 0.287 | PER 0.101 (need ≤ 0.05)<br>sound WER 0.306 (need ≤ 0.1)<br>sentence mark match share 0.850 (need ≥ 0.9) |
| en | wideband | male | 20 | 7.9% | 27.5% | 12.5% | 28.9% | – | 100.0% | 8.0 | 100.0% | 85.0% | – | 0.251 | – |
| en | wideband | female | 20 | 12.4% | 31.7% | 18.5% | 32.4% | – | 100.0% | 7.6 | 100.0% | 85.0% | – | 0.325 | – |
| en | minimal | male, female | 40 | 11.0% | 31.0% | 16.4% | 32.4% | – | 100.0% | 8.1 | 100.0% | 85.0% | – | 0.281 | PER 0.110 (need ≤ 0.05)<br>sound WER 0.324 (need ≤ 0.1)<br>sentence mark match share 0.850 (need ≥ 0.9) |
| en | minimal | male | 20 | 8.3% | 28.2% | 13.4% | 30.3% | – | 100.0% | 7.6 | 100.0% | 85.0% | – | 0.253 | – |
| en | minimal | female | 20 | 13.6% | 33.8% | 19.5% | 34.5% | – | 100.0% | 8.6 | 100.0% | 85.0% | – | 0.309 | – |
| ru | telephone | male, female | 40 | 14.9% | 51.7% | 18.7% | 46.0% | – | 94.6% | 7.9 | 95.0% | 77.5% | – | 0.285 | PER 0.149 (need ≤ 0.1)<br>sound WER 0.460 (need ≤ 0.2)<br>sentence mark match share 0.775 (need ≥ 0.85) |
| ru | telephone | male | 20 | 12.4% | 46.0% | 16.7% | 40.2% | – | 96.0% | 8.1 | 95.0% | 80.0% | – | 0.299 | – |
| ru | telephone | female | 20 | 17.3% | 57.5% | 20.6% | 51.7% | – | 93.0% | 7.7 | 95.0% | 75.0% | – | 0.271 | – |
| ru | narrowband | male, female | 40 | 14.6% | 54.0% | 18.5% | 49.4% | – | 95.7% | 7.9 | 95.0% | 77.5% | – | 0.280 | PER 0.146 (need ≤ 0.08)<br>sound WER 0.494 (need ≤ 0.15) |
| ru | narrowband | male | 20 | 12.2% | 50.6% | 15.7% | 44.8% | – | 96.0% | 8.3 | 100.0% | 80.0% | – | 0.262 | – |
| ru | narrowband | female | 20 | 17.1% | 57.5% | 21.4% | 54.0% | – | 95.3% | 7.5 | 90.0% | 75.0% | – | 0.298 | – |
| ru | wideband | male, female | 40 | 14.5% | 54.0% | 19.5% | 49.4% | – | 96.6% | 7.7 | 95.0% | 77.5% | – | 0.327 | PER 0.145 (need ≤ 0.05)<br>sound WER 0.494 (need ≤ 0.1)<br>sentence mark match share 0.775 (need ≥ 0.9) |
| ru | wideband | male | 20 | 11.0% | 43.7% | 15.4% | 36.8% | – | 98.0% | 8.1 | 95.0% | 80.0% | – | 0.305 | – |
| ru | wideband | female | 20 | 18.0% | 64.4% | 23.6% | 62.1% | – | 95.0% | 7.2 | 95.0% | 75.0% | – | 0.349 | – |
| ru | minimal | male, female | 40 | 14.5% | 54.6% | 19.0% | 50.0% | – | 96.7% | 7.7 | 95.0% | 77.5% | – | 0.353 | PER 0.145 (need ≤ 0.05)<br>sound WER 0.500 (need ≤ 0.1)<br>sentence mark match share 0.775 (need ≥ 0.9) |
| ru | minimal | male | 20 | 9.0% | 44.8% | 13.9% | 37.9% | – | 98.0% | 8.0 | 100.0% | 80.0% | – | 0.329 | – |
| ru | minimal | female | 20 | 20.0% | 64.4% | 24.1% | 62.1% | – | 95.1% | 7.4 | 90.0% | 75.0% | – | 0.377 | – |
| hi | telephone | male, female | 40 | 14.5% | 32.7% | 18.8% | 31.6% | – | – | 9.9 | 100.0% | 90.0% | – | 0.259 | PER 0.145 (need ≤ 0.1)<br>sound WER 0.316 (need ≤ 0.2) |
| hi | telephone | male | 20 | 14.7% | 34.7% | 18.3% | 33.7% | – | – | 10.8 | 100.0% | 90.0% | – | 0.263 | – |
| hi | telephone | female | 20 | 14.4% | 30.6% | 19.4% | 29.6% | – | – | 8.9 | 100.0% | 90.0% | – | 0.254 | – |
| hi | narrowband | male, female | 40 | 14.5% | 33.2% | 18.7% | 32.1% | – | – | 9.9 | 100.0% | 90.0% | – | 0.252 | PER 0.145 (need ≤ 0.08)<br>sound WER 0.321 (need ≤ 0.15) |
| hi | narrowband | male | 20 | 13.5% | 31.6% | 17.1% | 30.6% | – | – | 11.2 | 100.0% | 90.0% | – | 0.255 | – |
| hi | narrowband | female | 20 | 15.5% | 34.7% | 20.3% | 33.7% | – | – | 8.4 | 100.0% | 90.0% | – | 0.249 | – |
| hi | wideband | male, female | 40 | 13.2% | 29.6% | 16.8% | 28.6% | – | – | 8.7 | 100.0% | 90.0% | – | 0.293 | PER 0.132 (need ≤ 0.05)<br>sound WER 0.286 (need ≤ 0.1) |
| hi | wideband | male | 20 | 10.6% | 24.5% | 14.5% | 23.5% | – | – | 8.7 | 100.0% | 90.0% | – | 0.295 | – |
| hi | wideband | female | 20 | 15.8% | 34.7% | 19.1% | 33.7% | – | – | 8.7 | 100.0% | 90.0% | – | 0.292 | – |
| hi | minimal | male, female | 40 | 13.4% | 28.1% | 17.5% | 27.0% | – | – | 8.8 | 100.0% | 90.0% | – | 0.318 | PER 0.134 (need ≤ 0.05)<br>sound WER 0.270 (need ≤ 0.1) |
| hi | minimal | male | 20 | 11.8% | 26.5% | 15.7% | 25.5% | – | – | 8.8 | 100.0% | 90.0% | – | 0.316 | – |
| hi | minimal | female | 20 | 14.9% | 29.6% | 19.4% | 28.6% | – | – | 8.7 | 100.0% | 90.0% | – | 0.320 | – |
| zh | telephone | male, female | 40 | 6.2% | – | 35.9% | 27.9% | 17.2% | – | 7.0 | 97.5% | 75.0% | – | 0.177 | sound WER 0.279 (need ≤ 0.2)<br>tone error 0.172 (need ≤ 0.15)<br>sentence mark match share 0.750 (need ≥ 0.85) |
| zh | telephone | male | 20 | 6.9% | – | 39.7% | 32.1% | 18.3% | – | 6.9 | 95.0% | 80.0% | – | 0.187 | – |
| zh | telephone | female | 20 | 5.4% | – | 32.1% | 23.7% | 16.0% | – | 7.2 | 100.0% | 70.0% | – | 0.167 | – |
| zh | narrowband | male, female | 40 | 8.6% | – | 39.3% | 30.9% | 16.8% | – | 15.8 | 95.0% | 70.0% | – | 0.178 | PER 0.086 (need ≤ 0.08)<br>sound WER 0.309 (need ≤ 0.15)<br>tone error 0.168 (need ≤ 0.12) |
| zh | narrowband | male | 20 | 10.9% | – | 45.8% | 36.6% | 18.3% | – | 6.6 | 90.0% | 70.0% | – | 0.180 | – |
| zh | narrowband | female | 20 | 6.3% | – | 32.8% | 25.2% | 15.3% | – | 24.0 | 100.0% | 70.0% | – | 0.176 | – |
| zh | wideband | male, female | 40 | 6.9% | – | 36.3% | 27.9% | 17.6% | – | 15.5 | 95.0% | 72.5% | – | 0.214 | PER 0.069 (need ≤ 0.05)<br>sound WER 0.279 (need ≤ 0.1)<br>tone error 0.176 (need ≤ 0.1)<br>sentence mark match share 0.725 (need ≥ 0.9) |
| zh | wideband | male | 20 | 6.0% | – | 38.2% | 29.0% | 19.8% | – | 6.6 | 90.0% | 75.0% | – | 0.218 | – |
| zh | wideband | female | 20 | 7.7% | – | 34.4% | 26.7% | 15.3% | – | 24.5 | 100.0% | 70.0% | – | 0.209 | – |
| zh | minimal | male, female | 40 | 6.7% | – | 35.5% | 27.1% | 17.2% | – | 15.5 | 95.0% | 72.5% | – | 0.224 | PER 0.067 (need ≤ 0.05)<br>sound WER 0.271 (need ≤ 0.1)<br>tone error 0.172 (need ≤ 0.1)<br>sentence mark match share 0.725 (need ≥ 0.9) |
| zh | minimal | male | 20 | 5.7% | – | 36.6% | 27.5% | 18.3% | – | 6.5 | 90.0% | 75.0% | – | 0.227 | – |
| zh | minimal | female | 20 | 7.7% | – | 34.4% | 26.7% | 16.0% | – | 24.7 | 100.0% | 70.0% | – | 0.222 | – |

## voices

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | any | 5 | 5.4% | 25.0% | 11.2% | 25.0% | – | 100.0% | 7.5 | 100.0% | 60.0% | – | 0.185 | sound WER 0.250 (need ≤ 0.2)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| en | telephone | child | 5 | 12.4% | 44.4% | 19.9% | 41.7% | – | 100.0% | 7.0 | 100.0% | 60.0% | – | 0.214 | PER 0.124 (need ≤ 0.1)<br>sound WER 0.417 (need ≤ 0.2)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| en | wideband | any | 5 | 5.4% | 19.4% | 8.1% | 19.4% | – | 100.0% | 6.2 | 100.0% | 60.0% | – | 0.225 | sentence mark match share 0.600 (need ≥ 0.9) |
| en | wideband | child | 5 | 27.1% | 52.8% | 39.8% | 61.1% | – | 100.0% | 5.9 | 80.0% | 40.0% | – | 0.283 | PER 0.271 (need ≤ 0.1)<br>sound WER 0.611 (need ≤ 0.2)<br>language match share 0.800 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| ru | telephone | any | 5 | 19.6% | 68.2% | 33.0% | 59.1% | – | 100.0% | 8.5 | 80.0% | 80.0% | – | 0.245 | PER 0.196 (need ≤ 0.1)<br>sound WER 0.591 (need ≤ 0.2)<br>language match share 0.800 (need ≥ 0.9)<br>sentence mark match share 0.800 (need ≥ 0.85) |
| ru | telephone | child | 5 | 25.0% | 63.6% | 29.4% | 59.1% | – | 100.0% | 6.3 | 80.0% | 40.0% | – | 0.216 | PER 0.250 (need ≤ 0.1)<br>sound WER 0.591 (need ≤ 0.2)<br>language match share 0.800 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.85) |
| ru | wideband | any | 5 | 18.8% | 68.2% | 33.0% | 59.1% | – | 100.0% | 9.5 | 80.0% | 80.0% | – | 0.287 | PER 0.188 (need ≤ 0.1)<br>sound WER 0.591 (need ≤ 0.2)<br>language match share 0.800 (need ≥ 0.9)<br>sentence mark match share 0.800 (need ≥ 0.9) |
| ru | wideband | child | 5 | 22.3% | 54.5% | 30.3% | 50.0% | – | 100.0% | 7.4 | 80.0% | 40.0% | – | 0.273 | PER 0.223 (need ≤ 0.1)<br>sound WER 0.500 (need ≤ 0.2)<br>language match share 0.800 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| hi | telephone | any | 5 | 12.3% | 33.3% | 15.4% | 29.2% | – | – | 8.3 | 100.0% | 80.0% | – | 0.239 | PER 0.123 (need ≤ 0.1)<br>sound WER 0.292 (need ≤ 0.2)<br>sentence mark match share 0.800 (need ≥ 0.85) |
| hi | telephone | child | 5 | 14.8% | 25.0% | 16.7% | 25.0% | – | – | 7.1 | 100.0% | 80.0% | – | 0.292 | PER 0.148 (need ≤ 0.1)<br>sound WER 0.250 (need ≤ 0.2)<br>sentence mark match share 0.800 (need ≥ 0.85) |
| hi | wideband | any | 5 | 9.9% | 20.8% | 11.5% | 20.8% | – | – | 7.7 | 100.0% | 80.0% | – | 0.268 | sound WER 0.208 (need ≤ 0.2)<br>sentence mark match share 0.800 (need ≥ 0.9) |
| hi | wideband | child | 5 | 13.6% | 25.0% | 14.1% | 25.0% | – | – | 7.1 | 100.0% | 80.0% | – | 0.311 | PER 0.136 (need ≤ 0.1)<br>sound WER 0.250 (need ≤ 0.2)<br>sentence mark match share 0.800 (need ≥ 0.9) |
| zh | telephone | any | 5 | 1.1% | – | 15.2% | 9.1% | 9.1% | – | 6.0 | 100.0% | 60.0% | – | 0.118 | sentence mark match share 0.600 (need ≥ 0.85) |
| zh | telephone | child | 5 | 7.9% | – | 30.3% | 24.2% | 24.2% | – | 7.1 | 100.0% | 60.0% | – | 0.125 | sound WER 0.242 (need ≤ 0.2)<br>tone error 0.242 (need ≤ 0.15)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| zh | wideband | any | 5 | 5.6% | – | 24.2% | 18.2% | 12.1% | – | 5.4 | 100.0% | 60.0% | – | 0.190 | sentence mark match share 0.600 (need ≥ 0.9) |
| zh | wideband | child | 5 | 9.0% | – | 30.3% | 24.2% | 12.1% | – | 7.9 | 100.0% | 60.0% | – | 0.195 | sound WER 0.242 (need ≤ 0.2)<br>sentence mark match share 0.600 (need ≥ 0.9) |

## tiers

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | low | male | 2 | 12.0% | 33.3% | 21.2% | 33.3% | – | – | 5.3 | 100.0% | 100.0% | – | 0.266 | PER 0.120 (need ≤ 0.1) |
| en | medium | male | 2 | 12.0% | 33.3% | 24.2% | 33.3% | – | – | 7.3 | 100.0% | 100.0% | – | 0.266 | PER 0.120 (need ≤ 0.1) |
| en | high | male | 2 | 96.0% | 100.0% | 100.0% | 111.1% | – | – | – | 0.0% | 100.0% | – | 0.737 | PER 0.960 (need ≤ 0.1) |
| en | ultra | male | 2 | 84.0% | 100.0% | 81.8% | 100.0% | – | – | – | 100.0% | 100.0% | – | 0.837 | PER 0.840 (need ≤ 0.1) |
| en | studio | male | 2 | 68.0% | 77.8% | 60.6% | 77.8% | – | – | 30.7 | 100.0% | 50.0% | – | 0.800 | PER 0.680 (need ≤ 0.1)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| ru | low | male | 2 | 26.7% | 50.0% | 20.0% | 50.0% | – | 50.0% | 8.4 | 50.0% | 100.0% | – | 0.368 | PER 0.267 (need ≤ 0.1)<br>stress hit share 0.500 (need ≥ 0.9) |
| ru | medium | male | 2 | 26.7% | 50.0% | 20.0% | 50.0% | – | 50.0% | 8.4 | 50.0% | 100.0% | – | 0.398 | PER 0.267 (need ≤ 0.1)<br>stress hit share 0.500 (need ≥ 0.9) |
| ru | high | male | 2 | 66.7% | 150.0% | 53.3% | 150.0% | – | 0.0% | – | 50.0% | 50.0% | – | 0.529 | PER 0.667 (need ≤ 0.1)<br>stress hit share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| ru | ultra | male | 2 | 40.0% | 50.0% | 40.0% | 50.0% | – | 50.0% | 11.8 | 50.0% | 100.0% | – | 0.562 | PER 0.400 (need ≤ 0.1)<br>stress hit share 0.500 (need ≥ 0.9) |
| ru | studio | male | 2 | 13.3% | 25.0% | 13.3% | 25.0% | – | 100.0% | 7.9 | 50.0% | 100.0% | – | 0.468 | PER 0.133 (need ≤ 0.1) |
| hi | low | male | 2 | 64.3% | 80.0% | 73.3% | 80.0% | – | – | 26.5 | 100.0% | 100.0% | – | 0.561 | PER 0.643 (need ≤ 0.1) |
| hi | medium | male | 2 | 42.9% | 60.0% | 53.3% | 60.0% | – | – | 11.5 | 100.0% | 100.0% | – | 0.612 | PER 0.429 (need ≤ 0.1) |
| hi | high | male | 2 | 78.6% | 100.0% | 86.7% | 100.0% | – | – | – | 100.0% | 100.0% | – | 1.256 | PER 0.786 (need ≤ 0.1) |
| hi | ultra | male | 2 | 78.6% | 100.0% | 73.3% | 100.0% | – | – | – | 100.0% | 100.0% | – | 0.896 | PER 0.786 (need ≤ 0.1) |
| hi | studio | male | 2 | 64.3% | 100.0% | 66.7% | 100.0% | – | – | – | 100.0% | 100.0% | – | 0.782 | PER 0.643 (need ≤ 0.1) |
| zh | low | male | 2 | 35.3% | – | 100.0% | 100.0% | 50.0% | – | 6.2 | 50.0% | 100.0% | – | 0.355 | PER 0.353 (need ≤ 0.1) |
| zh | medium | male | 2 | 11.8% | – | 116.7% | 100.0% | 33.3% | – | 5.0 | 50.0% | 100.0% | – | 0.324 | PER 0.118 (need ≤ 0.1) |
| zh | high | male | 2 | 35.3% | – | 83.3% | 66.7% | 33.3% | – | 6.2 | 50.0% | 50.0% | – | 0.630 | PER 0.353 (need ≤ 0.1)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| zh | ultra | male | 2 | 23.5% | – | 50.0% | 50.0% | 33.3% | – | 6.2 | 50.0% | 100.0% | – | 0.559 | PER 0.235 (need ≤ 0.1) |
| zh | studio | male | 2 | 29.4% | – | 50.0% | 50.0% | 16.7% | – | 6.2 | 50.0% | 100.0% | – | 0.497 | PER 0.294 (need ≤ 0.1) |

## whisper

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male, female | 20 | 14.6% | 38.6% | 20.3% | 38.6% | – | 100.0% | 9.7 | 100.0% | 60.0% | 75.0% | 0.211 | WER 0.386 (need ≤ 0.35) |
| en | telephone | male | 10 | 15.9% | 44.3% | 24.4% | 44.3% | – | 100.0% | 9.6 | 100.0% | 60.0% | 70.0% | 0.233 | – |
| en | telephone | female | 10 | 13.4% | 32.9% | 16.2% | 32.9% | – | 100.0% | 9.8 | 100.0% | 60.0% | 80.0% | 0.188 | – |
| en | narrowband | male, female | 20 | 11.2% | 25.9% | 13.4% | 25.9% | – | 100.0% | 8.9 | 100.0% | 70.0% | 95.0% | 0.202 | Pass |
| en | narrowband | male | 10 | 8.3% | 22.8% | 9.7% | 22.8% | – | 100.0% | 8.1 | 100.0% | 70.0% | 90.0% | 0.201 | – |
| en | narrowband | female | 10 | 14.1% | 29.1% | 17.1% | 29.1% | – | 100.0% | 9.9 | 100.0% | 70.0% | 100.0% | 0.202 | – |
| en | wideband | male, female | 20 | 12.5% | 29.1% | 15.3% | 29.1% | – | 100.0% | 9.6 | 100.0% | 65.0% | 80.0% | 0.230 | WER 0.291 (need ≤ 0.25) |
| en | wideband | male | 10 | 14.1% | 34.2% | 17.1% | 34.2% | – | 100.0% | 8.5 | 100.0% | 70.0% | 90.0% | 0.242 | – |
| en | wideband | female | 10 | 10.8% | 24.1% | 13.5% | 24.1% | – | 100.0% | 10.6 | 100.0% | 60.0% | 70.0% | 0.217 | – |
| en | minimal | male, female | 20 | 12.6% | 29.7% | 15.7% | 29.7% | – | 100.0% | 9.5 | 100.0% | 70.0% | 90.0% | 0.255 | WER 0.297 (need ≤ 0.25) |
| en | minimal | male | 10 | 14.1% | 34.2% | 17.1% | 34.2% | – | 100.0% | 8.2 | 100.0% | 70.0% | 90.0% | 0.264 | – |
| en | minimal | female | 10 | 11.2% | 25.3% | 14.4% | 25.3% | – | 100.0% | 10.7 | 100.0% | 70.0% | 90.0% | 0.247 | – |
| ru | telephone | male, female | 20 | 14.8% | 52.3% | 20.8% | 46.6% | – | 96.1% | 8.8 | 100.0% | 70.0% | 90.0% | 0.274 | WER 0.523 (need ≤ 0.35) |
| ru | telephone | male | 10 | 19.4% | 56.8% | 24.1% | 50.0% | – | 96.0% | 8.6 | 100.0% | 60.0% | 80.0% | 0.316 | – |
| ru | telephone | female | 10 | 10.2% | 47.7% | 17.5% | 43.2% | – | 96.2% | 9.0 | 100.0% | 80.0% | 100.0% | 0.232 | – |
| ru | narrowband | male, female | 20 | 15.5% | 59.1% | 22.9% | 56.8% | – | 93.3% | 9.1 | 100.0% | 80.0% | 100.0% | 0.294 | Pass |
| ru | narrowband | male | 10 | 16.7% | 56.8% | 24.5% | 56.8% | – | 90.9% | 8.7 | 100.0% | 80.0% | 100.0% | 0.333 | – |
| ru | narrowband | female | 10 | 14.4% | 61.4% | 21.2% | 56.8% | – | 95.7% | 9.5 | 100.0% | 80.0% | 100.0% | 0.255 | – |
| ru | wideband | male, female | 20 | 13.2% | 56.8% | 19.1% | 53.4% | – | 95.8% | 8.8 | 100.0% | 80.0% | 80.0% | 0.297 | WER 0.568 (need ≤ 0.25) |
| ru | wideband | male | 10 | 13.4% | 59.1% | 19.8% | 56.8% | – | 95.7% | 9.2 | 100.0% | 80.0% | 80.0% | 0.313 | – |
| ru | wideband | female | 10 | 13.0% | 54.5% | 18.4% | 50.0% | – | 96.0% | 8.3 | 100.0% | 80.0% | 80.0% | 0.280 | – |
| ru | minimal | male, female | 20 | 15.0% | 59.1% | 21.2% | 54.5% | – | 95.8% | 9.0 | 100.0% | 80.0% | 80.0% | 0.310 | PER 0.150 (need ≤ 0.15)<br>WER 0.591 (need ≤ 0.25) |
| ru | minimal | male | 10 | 16.2% | 59.1% | 23.1% | 54.5% | – | 95.8% | 9.4 | 100.0% | 80.0% | 80.0% | 0.322 | – |
| ru | minimal | female | 10 | 13.9% | 59.1% | 19.3% | 54.5% | – | 95.8% | 8.6 | 100.0% | 80.0% | 80.0% | 0.298 | – |
| hi | telephone | male, female | 20 | 19.7% | 42.0% | 22.6% | 41.0% | – | – | 14.0 | 95.0% | 80.0% | 95.0% | 0.395 | WER 0.420 (need ≤ 0.35) |
| hi | telephone | male | 10 | 25.8% | 50.0% | 28.6% | 48.0% | – | – | 13.8 | 90.0% | 80.0% | 90.0% | 0.448 | – |
| hi | telephone | female | 10 | 13.5% | 34.0% | 16.6% | 34.0% | – | – | 14.2 | 100.0% | 80.0% | 100.0% | 0.340 | – |
| hi | narrowband | male, female | 20 | 19.4% | 40.0% | 22.9% | 39.0% | – | – | 17.7 | 100.0% | 80.0% | 100.0% | 0.371 | Pass |
| hi | narrowband | male | 10 | 27.0% | 52.0% | 30.9% | 50.0% | – | – | 20.4 | 100.0% | 80.0% | 100.0% | 0.393 | – |
| hi | narrowband | female | 10 | 11.8% | 28.0% | 14.9% | 28.0% | – | – | 15.4 | 100.0% | 80.0% | 100.0% | 0.349 | – |
| hi | wideband | male, female | 20 | 20.2% | 39.0% | 22.9% | 39.0% | – | – | 19.0 | 100.0% | 80.0% | 95.0% | 0.386 | PER 0.202 (need ≤ 0.15)<br>WER 0.390 (need ≤ 0.25) |
| hi | wideband | male | 10 | 24.7% | 48.0% | 28.0% | 48.0% | – | – | 16.7 | 100.0% | 80.0% | 90.0% | 0.398 | – |
| hi | wideband | female | 10 | 15.7% | 30.0% | 17.7% | 30.0% | – | – | 21.1 | 100.0% | 80.0% | 100.0% | 0.374 | – |
| hi | minimal | male, female | 20 | 18.8% | 36.0% | 21.7% | 36.0% | – | – | 17.7 | 100.0% | 80.0% | 95.0% | 0.427 | PER 0.188 (need ≤ 0.15)<br>WER 0.360 (need ≤ 0.25) |
| hi | minimal | male | 10 | 20.8% | 40.0% | 24.0% | 40.0% | – | – | 14.1 | 100.0% | 80.0% | 90.0% | 0.456 | – |
| hi | minimal | female | 10 | 16.9% | 32.0% | 19.4% | 32.0% | – | – | 21.2 | 100.0% | 80.0% | 100.0% | 0.397 | – |
| zh | telephone | male, female | 20 | 17.7% | – | 59.4% | 60.2% | 34.4% | – | 22.3 | 90.0% | 70.0% | 85.0% | 0.316 | CER 0.594 (need ≤ 0.35)<br>tone error 0.344 (need ≤ 0.3) |
| zh | telephone | male | 10 | 20.7% | – | 60.9% | 62.5% | 37.5% | – | 18.1 | 90.0% | 70.0% | 80.0% | 0.358 | – |
| zh | telephone | female | 10 | 14.6% | – | 57.8% | 57.8% | 31.3% | – | 26.0 | 90.0% | 70.0% | 90.0% | 0.274 | – |
| zh | narrowband | male, female | 20 | 27.7% | – | 85.2% | 85.9% | 41.4% | – | 10.0 | 80.0% | 60.0% | 95.0% | 0.341 | tone error 0.414 (need ≤ 0.25) |
| zh | narrowband | male | 10 | 32.3% | – | 95.3% | 98.4% | 46.9% | – | 13.0 | 80.0% | 50.0% | 90.0% | 0.405 | – |
| zh | narrowband | female | 10 | 23.2% | – | 75.0% | 73.4% | 35.9% | – | 8.0 | 80.0% | 70.0% | 100.0% | 0.275 | – |
| zh | wideband | male, female | 20 | 15.2% | – | 60.9% | 59.4% | 32.8% | – | 12.0 | 90.0% | 60.0% | 90.0% | 0.330 | PER 0.152 (need ≤ 0.15)<br>CER 0.609 (need ≤ 0.25)<br>tone error 0.328 (need ≤ 0.25) |
| zh | wideband | male | 10 | 15.2% | – | 57.8% | 57.8% | 32.8% | – | 14.5 | 90.0% | 60.0% | 90.0% | 0.351 | – |
| zh | wideband | female | 10 | 15.2% | – | 64.1% | 60.9% | 32.8% | – | 9.3 | 90.0% | 60.0% | 90.0% | 0.309 | – |
| zh | minimal | male, female | 20 | 14.6% | – | 57.8% | 55.5% | 28.9% | – | 13.6 | 90.0% | 60.0% | 90.0% | 0.345 | CER 0.578 (need ≤ 0.25)<br>tone error 0.289 (need ≤ 0.25) |
| zh | minimal | male | 10 | 15.2% | – | 56.3% | 54.7% | 29.7% | – | 14.0 | 90.0% | 60.0% | 90.0% | 0.368 | – |
| zh | minimal | female | 10 | 14.0% | – | 59.4% | 56.3% | 28.1% | – | 13.1 | 90.0% | 60.0% | 90.0% | 0.322 | – |

## modes

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male | 2 | 13.2% | 50.0% | 17.1% | 50.0% | – | 100.0% | 9.0 | 100.0% | 100.0% | 100.0% | 0.489 | – |
| ru | telephone | male | 2 | 14.9% | 40.0% | 19.6% | 30.0% | – | 100.0% | 9.8 | 100.0% | 100.0% | 100.0% | 0.319 | – |
| hi | telephone | male | 2 | 0.0% | 0.0% | 0.0% | 0.0% | – | – | 8.6 | 100.0% | 100.0% | 100.0% | 0.608 | – |
| zh | telephone | male | 2 | 6.8% | – | 12.5% | 25.0% | 6.3% | – | 7.5 | 100.0% | 100.0% | 100.0% | 0.518 | – |
| all | telephone | male | 8 | 11.0% | 37.0% | 15.4% | 30.6% | 6.3% | 100.0% | 9.0 | 100.0% | 100.0% | 100.0% | 0.457 | Pass |
| en | narrowband | male | 2 | 13.2% | 50.0% | 15.7% | 50.0% | – | 100.0% | 7.7 | 100.0% | 100.0% | 100.0% | 0.151 | – |
| ru | narrowband | male | 2 | 16.0% | 55.0% | 26.1% | 50.0% | – | 100.0% | 6.9 | 100.0% | 100.0% | 100.0% | 0.225 | – |
| hi | narrowband | male | 2 | 6.7% | 12.5% | 10.0% | 12.5% | – | – | 13.3 | 100.0% | 100.0% | 100.0% | 0.252 | – |
| zh | narrowband | male | 2 | 34.1% | – | 137.5% | 137.5% | 62.5% | – | 5.3 | 50.0% | 50.0% | 100.0% | 0.228 | – |
| all | narrowband | male | 8 | 17.4% | 45.7% | 28.8% | 67.7% | 62.5% | 100.0% | 8.3 | 87.5% | 87.5% | 100.0% | 0.211 | – |
| en | wideband | male | 2 | 11.8% | 50.0% | 14.3% | 50.0% | – | 100.0% | 6.1 | 100.0% | 100.0% | 100.0% | 0.770 | – |
| ru | wideband | male | 2 | 14.9% | 70.0% | 21.7% | 60.0% | – | 100.0% | 9.5 | 100.0% | 100.0% | 100.0% | 0.556 | – |
| hi | wideband | male | 2 | 6.7% | 12.5% | 10.0% | 12.5% | – | – | 7.6 | 100.0% | 100.0% | 100.0% | 0.945 | – |
| zh | wideband | male | 2 | 0.0% | – | 6.3% | 18.8% | 6.3% | – | 7.1 | 100.0% | 100.0% | 100.0% | 0.664 | – |
| all | wideband | male | 8 | 10.2% | 52.2% | 16.3% | 40.3% | 6.3% | 100.0% | 7.9 | 100.0% | 100.0% | 100.0% | 0.700 | Pass |
| en | minimal | male | 2 | 11.8% | 50.0% | 14.3% | 50.0% | – | 100.0% | 6.1 | 100.0% | 100.0% | 100.0% | 0.222 | – |
| ru | minimal | male | 2 | 21.3% | 75.0% | 28.3% | 65.0% | – | 100.0% | 9.4 | 100.0% | 100.0% | 100.0% | 0.258 | – |
| hi | minimal | male | 2 | 0.0% | 0.0% | 0.0% | 0.0% | – | – | 7.7 | 100.0% | 100.0% | 100.0% | 0.269 | – |
| zh | minimal | male | 2 | 0.0% | – | 6.3% | 18.8% | 6.3% | – | 7.1 | 100.0% | 100.0% | 100.0% | 0.199 | – |
| all | minimal | male | 8 | 11.9% | 52.2% | 17.8% | 40.3% | 6.3% | 100.0% | 7.8 | 100.0% | 100.0% | 100.0% | 0.236 | Pass |
| en | low | male | 2 | 13.2% | 61.1% | 34.3% | 61.1% | – | – | 4.5 | 100.0% | 100.0% | 100.0% | 0.356 | – |
| ru | low | male | 2 | 22.3% | 95.0% | 34.8% | 90.0% | – | 100.0% | 11.5 | 100.0% | 100.0% | 100.0% | 0.301 | – |
| hi | low | male | 2 | 0.0% | 0.0% | 0.0% | 0.0% | – | – | 9.5 | 100.0% | 100.0% | 100.0% | 0.351 | – |
| zh | low | male | 2 | 2.3% | – | 12.5% | 25.0% | 12.5% | – | 6.7 | 100.0% | 100.0% | 100.0% | 0.276 | – |
| all | low | male | 8 | 13.1% | 65.2% | 27.9% | 53.2% | 12.5% | 100.0% | 8.6 | 100.0% | 100.0% | 100.0% | 0.317 | Pass |
| en | medium | male | 2 | 17.6% | 61.1% | 34.3% | 61.1% | – | 100.0% | 11.4 | 100.0% | 100.0% | 100.0% | 0.306 | – |
| ru | medium | male | 2 | 18.1% | 70.0% | 23.9% | 60.0% | – | 90.9% | 9.3 | 100.0% | 100.0% | 100.0% | 0.296 | – |
| hi | medium | male | 2 | 16.7% | 37.5% | 20.0% | 37.5% | – | – | 12.8 | 100.0% | 50.0% | 50.0% | 0.404 | – |
| zh | medium | male | 2 | 25.0% | – | 143.8% | 143.8% | 62.5% | – | 5.4 | 50.0% | 50.0% | 50.0% | 0.372 | – |
| all | medium | male | 8 | 19.1% | 60.9% | 36.1% | 79.0% | 62.5% | 91.7% | 9.9 | 87.5% | 75.0% | 75.0% | 0.334 | mode match share 0.750 (need ≥ 0.9) |
| en | high | male | 2 | 61.8% | 77.8% | 67.1% | 77.8% | – | 100.0% | 13.5 | 100.0% | 50.0% | 50.0% | 0.639 | – |
| ru | high | male | 2 | 78.7% | 145.0% | 94.6% | 145.0% | – | 50.0% | 30.7 | 50.0% | 100.0% | 50.0% | 0.552 | – |
| hi | high | male | 2 | 86.7% | 150.0% | 90.0% | 150.0% | – | – | 74.8 | 50.0% | 0.0% | 50.0% | 0.982 | – |
| zh | high | male | 2 | 70.5% | – | 237.5% | 243.8% | 87.5% | – | 10.7 | 50.0% | 50.0% | 50.0% | 0.970 | – |
| all | high | male | 8 | 73.3% | 119.6% | 95.7% | 151.6% | 87.5% | 80.0% | 24.9 | 62.5% | 50.0% | 50.0% | 0.743 | mode match share 0.500 (need ≥ 0.9) |
| en | ultra | male | 2 | 35.3% | 61.1% | 42.9% | 61.1% | – | 100.0% | 7.8 | 100.0% | 100.0% | 50.0% | 0.443 | – |
| ru | ultra | male | 2 | 57.4% | 130.0% | 63.0% | 130.0% | – | 33.3% | 21.0 | 100.0% | 100.0% | 50.0% | 0.492 | – |
| hi | ultra | male | 2 | 36.7% | 62.5% | 40.0% | 62.5% | – | – | 21.8 | 100.0% | 50.0% | 50.0% | 0.675 | – |
| zh | ultra | male | 2 | 13.6% | – | 43.8% | 56.3% | 31.3% | – | 9.7 | 100.0% | 100.0% | 50.0% | 0.521 | – |
| all | ultra | male | 8 | 40.3% | 91.3% | 51.4% | 82.3% | 31.3% | 60.0% | 14.1 | 100.0% | 87.5% | 50.0% | 0.516 | mode match share 0.500 (need ≥ 0.9) |
| en | studio | male | 2 | 23.5% | 44.4% | 32.9% | 44.4% | – | 100.0% | 7.9 | 100.0% | 100.0% | 100.0% | 0.406 | – |
| ru | studio | male | 2 | 38.3% | 85.0% | 44.6% | 85.0% | – | 100.0% | 12.9 | 100.0% | 100.0% | 50.0% | 0.429 | – |
| hi | studio | male | 2 | 33.3% | 75.0% | 30.0% | 75.0% | – | – | 10.6 | 100.0% | 0.0% | 50.0% | 0.558 | – |
| zh | studio | male | 2 | 15.9% | – | 43.8% | 56.3% | 25.0% | – | 7.0 | 100.0% | 100.0% | 50.0% | 0.454 | – |
| all | studio | male | 8 | 29.2% | 67.4% | 38.5% | 64.5% | 25.0% | 100.0% | 9.7 | 100.0% | 75.0% | 62.5% | 0.450 | mode match share 0.625 (need ≥ 0.9) |

## 20 worst round trips by phone error rate

| Set | Language | Tier | Preset | Sentence | Mode | PER | Reference text | Heard text | Reference IPA | Heard IPA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main | ru | minimal | female | 20 | – | 200.0% | Да. | बैर। | da . | bɛːɾə. |
| tiers | ru | ultra | male | 20 | – | 150.0% | Да. | बैर। | da . | bɛːɾ. |
| whisper | zh | narrowband | male | 6 | W | 120.0% | 妈妈骂马吗？ | Man and an end of. | {W ma˥ ma ma˥˩ ma˨˩ ma W} ? | {W mˈæn ˈænd ˈæn ˈɛnd əv W} . |
| whisper | zh | telephone | male | 6 | W | 110.0% | 妈妈骂马吗？ | नाम मारना नैना। | {W ma˥ ma ma˥˩ ma˨˩ ma W} ? | {W naːm maːɾnaː nɛːnaː W} . |
| whisper | zh | wideband | male | 6 | W | 110.0% | 妈妈骂马吗？ | Ma'am and an end of. | {W ma˥ ma ma˥˩ ma˨˩ ma W} ? | {W mˈæm ˈænd ˈæn ˈɛnd əv W} . |
| whisper | zh | minimal | male | 6 | W | 110.0% | 妈妈骂马吗？ | Ma'am and an end of. | {W ma˥ ma ma˥˩ ma˨˩ ma W} ? | {W mˈæm ˈænd ˈæn ˈɛnd əv W} . |
| whisper | hi | telephone | male | 10 | W | 107.1% | घोड़ा तेज़ दौड़ता है। | Go at his door to their. | {W ɡʱoːɽaː t̪eːz d̪ɔːɽt̪aː ɦɛː W} . | {allegro {W ɡˈoʊ W} allegro} {W ət hˈɪz dˈɔɹ tə W} {lento ðˈɛɹ lento} . |
| whisper | zh | telephone | female | 6 | W | 100.0% | 妈妈骂马吗？ | Man and when emma? | {W ma˥ ma ma˥˩ ma˨˩ ma W} ? | {W {wh mˈæn ˈænd wˈɛn ˈɛmə wh} W} ? |
| whisper | zh | wideband | female | 6 | W | 100.0% | 妈妈骂马吗？ | Man am elemental. | {W ma˥ ma ma˥˩ ma˨˩ ma W} ? | {lento {W mˈæn W} lento} {W ˈæm ˌɛləmˈɛnəl W} . |
| main | en | narrowband | female | 15 | – | 100.0% | Stop! | Stored l. | ˈstɑp ! | stˈɔɹd l. |
| main | hi | telephone | female | 17 | – | 100.0% | रुको! | इतै। | ɾʊkoː ! | ɪt̪ɛː. |
| main | hi | wideband | female | 17 | – | 100.0% | रुको! | इतै। | ɾʊkoː ! | ɪt̪ɛː. |
| main | zh | narrowband | male | 20 | – | 100.0% | 对。 | पड़े। | tweɪ˥˩ . | pəɽeː. |
| main | zh | wideband | male | 20 | – | 100.0% | 对。 | पड़े। | tweɪ˥˩ . | pəɽeː. |
| main | zh | minimal | male | 20 | – | 100.0% | 对。 | पड़े। | tweɪ˥˩ . | pəɽeː. |
| tiers | zh | low | male | 20 | – | 100.0% | 对。 | पड़े। | tweɪ˥˩ . | pəɽeː. |
| tiers | zh | high | male | 20 | – | 100.0% | 对。 | है। | tweɪ˥˩ . | ɦɛː. |
| tiers | zh | ultra | male | 20 | – | 100.0% | 对。 | हुए। | tweɪ˥˩ . | ɦʊeː. |
| tiers | zh | studio | male | 20 | – | 100.0% | 对。 | वे। | tweɪ˥˩ . | ʋeː. |
| tiers | en | high | male | 20 | – | 100.0% | Yes. | 鲁死。 | ˈjɛs . | lu˧˥ sɹ̩˨˩˦ |

## Word recogniser diagnostics

### Single-core smoke

`taskset -c 0 node --test tests/roundtrip-smoke.test.js` passed all three
cases on 2026-11-24 at `6b429fe`, in 24.4 seconds of wall time (en 19.3 s,
which includes loading the model, ru 2.0 s and zh 2.1 s). Each case is
telephone, male, seed 1, and needs PER ≤ 0.1, sound WER 0 and the right
language.

### Per-language pruning

The word decoder used to prune all four language trees against one best
token, so audio that fits the models poorly could lose the right language
early in a sentence. Each language is now pruned against its own best token
(beam 120), and a language is dropped only once it falls `languageBeam`
(400) behind the best of all (`src/recognition/hmm-decode.js`,
`languageThresholds`). Telephone, sentences 1–20, male and female
(`node experiments/issue-75-hmm-eval.mjs telephone <langs> male,female 0 20`):

| Language | PER before | PER after | Sound WER before | Sound WER after | Language right before | Language right after |
| --- | --- | --- | --- | --- | --- | --- |
| en | 12.5% | 12.5% | 29.9% | 29.9% | 100% | 100% |
| ru | 17.8% | 17.3% | 45.5% | 46.3% | 93% | 95% |
| hi | 20.8% | 18.8% | 37.4% | 35.9% | 97% | 100% |
| zh | 6.9% | 6.9% | 28.1% | 28.1% | 97% | 97% |

The full commands and the tiers-set comparison are in
`experiments/issue-75-tiers-sweep.txt`.

### Tiers set

The higher tiers (sentences 2 and 20, male, random head seed 1) fail PER at
every tier. On the 3D tiers (high, ultra, studio) the models score the audio
at about −51 to −60 log-likelihood per frame, against −37 at medium, so English
sentence 2 reaches a PER of 77–96%. The one-word answers of sentence 20 (Yes.,
Да., हाँ।, 对。) are often heard in another language.

A candidate model trained with high, ultra, studio, low and medium renders
added (`/tmp/hmm6`, 20 more files) improved the tiers set from a mean PER of
0.490 to 0.305 and from 35 to 41 of 48 right languages
(`node experiments/issue-75-tiers-sweep.mjs`). It was not shipped because
its Mandarin telephone sound WER rose from 0.281 to 0.431.

### Sibilants

`node experiments/issue-75-sibilant-band.mjs wideband` shows that the
simulator's /ʃ/ gathers its noise at 5–6 kHz (centroid 5.0–5.3 kHz, male),
while /s/ spreads it over 4.5–7 kHz (centroid 4.2–4.8 kHz). Natural /ʃ/ peaks near 2.5–3.5 kHz (Stevens
1998, chapter 8; Jongman, Wayland and Wong 2000), below /s/. At the telephone band
limit of 3.4 kHz neither keeps much in-band noise, which fits the "sells" →
"shells" and "sea" → "she" confusions. Moving the postalveolar place back
alone lowers the /ʃ/ centroid only to 4.4–4.5 kHz at location 0.83. Any change to the
sibilant noise needs a fresh training corpus and a retrained model.
Results: `experiments/issue-75-sibilant-band.txt`.

## Earlier phone-decoder diagnostics

The sections below were measured before the HMM word decoder, with what is
now `decoder: 'phones'`. They are kept as the record of the methods tried.

### Decoder diagnosis

`taskset -c 3 node experiments/issue-75-stage-trace.mjs --seeded-preset`
compares the IPA after acoustic decoding with the IPA after text and
prosody recovery. Each stage returned the same number of errors for each
language as the smoke tests. The simulation matcher accepts English
proposals from 22.05 and 48 kHz input only. Telephone input uses the general
tract-inversion decoder.

Acoustic decoding used 2.79, 23.26, and 1.18 CPU seconds for English, Russian,
and Mandarin. Text and prosody used 13.16, 0.31, and 0.32 CPU seconds in that
order. The Russian input was spoken without whisper markup, but a 360 ms
interval was classified as a whisper and triggered a cold build of the
whisper reference models.

In a local trial, rendering those reference models at the telephone tier
reduced the Russian acoustic stage from 23.26 to 16.39 CPU seconds.
It increased Russian phone errors from 7 to 9 of 13, and the three cases
still took 39.8 seconds to run. The trial used the same command after
changing the reference render tier in `renderWhisperReference` from
`minimal` to `telephone` at 8 kHz. The benchmark uses the original renderer.

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

`node experiments/issue-75-decoder-costs.mjs --seeded-preset --planned-articulation`
substituted the planner's articulatory controls for inferred controls while
holding the boundary graph, durations, and landmark costs fixed. The
reference controls reduced phone edits from 43 to 39 out of 54. The scoring
and search still lost most phones even with access to the known controls.

`node experiments/issue-75-telephone-templates.mjs --search` uses the seeded
male voice to render generic phones in three contexts at 8 kHz. Even on the
known phone boundaries and within the correct language inventory, the best
scoring variant ranked only 22 of the 54 reference phones first. Adding
spectral distance to the acoustic search changed the total from 44 phone
errors to 42 in its best trial. The other weights produced 43 and 44 errors.
All of those search trials used the correct language and disabled automatic
whisper detection. The public benchmark uses its normal settings.

### Decoder diagnostics after merging `main`

On `cfc0ec9`, `taskset -c 1 node --test tests/roundtrip-smoke.test.js`
took 19 seconds. English made 12 phone edits out of 16 and six sound word
edits out of six, Russian made 8 out of 13 and three out of three, and
Mandarin made 13 out of 13 and 11 out of five. Only Russian returned the
correct top language. The same errors reproduced in Node.js, Bun, and Deno
on Ubuntu. [Checks and release](https://github.com/konard/voice-simulator/actions/runs/44920846059).

`taskset -c 1 node experiments/issue-75-lexicon-search.mjs` scores the
dictionary directly on the acoustic span graph for the three smoke inputs
and Hindi sentence 2. The probe used the known language and allowed word
boundaries within 45 ms of the planner times. With acoustic costs alone,
none of the 17 reference words ranked in the top three. Adding unigram costs
put one word in the top three. Subtracting the cheapest cost on each span
(`--relative`) also put only one word in the top three with unigram costs.
All four Hindi words were in the dictionary. They had no feasible paths at
those boundaries until the probe accepted both short and long phones.

`taskset -c 1 node experiments/issue-75-decoder-costs.mjs --seeded-preset --language-templates`
used the planner's language-specific duration rules to generate acoustic
templates. Across the same four recordings, phone edits increased from 43
to 44 out of 54. The Russian case accounted for the increase.

`taskset -c 1 node experiments/issue-75-reference-ipa.mjs` supplied the
planner's IPA and boundaries in place of acoustic decoding for all 80
sentences. With acoustic prosody disabled, the text and language stages
identified the language correctly in all 80 recordings. These stages made
2/142 sound word edits in English, 3/87 in Russian, 2/98 in Hindi and 5/131
in Mandarin. In the English smoke case, the text stage returned all six
words. The missing question mark changes how the pronunciation used for
Sound WER stresses “or.”

`taskset -c 0 node experiments/issue-75-decoder-reachability.mjs` found a
complete path through the acoustic span graph for all 160 telephone
recordings with the seeded male and female voices.

`taskset -c 0 node experiments/issue-75-decoder-costs.mjs --seeded-preset --reference-spans`
evaluated the default acoustic costs at the planner's phone boundaries
for the three smoke recordings and Hindi sentence 2. It restricted the
candidates to the correct language and ignored phone transitions and length
labels. The correct phone was in the inventory for all 54 spans. Using
articulation inferred from the audio, it ranked first in 6 and in the first
five in 23. Replacing the inferred controls with the planner's controls
raised those counts to 27 and 44. The second run kept the inferred broad
phone classes and all cost weights.

| Language | Phones | Inferred, first | Inferred, top five | Planned, first | Planned, top five |
| --- | --- | --- | --- | --- | --- |
| en | 16 | 0 | 4 | 7 | 14 |
| ru | 13 | 4 | 10 | 8 | 11 |
| hi | 12 | 2 | 3 | 4 | 7 |
| zh | 13 | 0 | 6 | 8 | 12 |

`taskset -c 3 node experiments/issue-75-decoder-costs.mjs --seeded-preset --reference-spans --span-costs`
repeated that probe with offsets of ±10 and ±20 ms and with individual
scoring terms removed. Offset trials with inferred controls ranked at most
8 of 54 phones first and at most 23 in the first five. Removing the class
and duration penalties together ranked 9 phones first and 18 in the first
five. Giving that variant the planned controls raised the counts to 33
and 46. The original acoustic scores remain in production.

### Rendered vowel calibration

`node experiments/issue-75-inversion-calibration.mjs --wideband --held-out`
compares two ways to bring the acoustic codebook closer to the measured
waveguide output. One subtracts the spectral difference between an analytic
neutral tract and a rendered neutral tract. The other scores voiced frames
against waveguide renders of the existing vowel seeds at five pitches.
The second method applies only while the recent spectrum is stable.

At 16 kHz the baseline recovered 7 of 31 steady vowels in both presets.
Rendered references with 40 ms of continuous voicing and at most 16 dB² of
spectral drift recovered 31 of 31 male vowels and 30 of 31 female vowels.
An 80 ms window and an 8 dB² limit recovered 29 of 31 in each preset.

The sentence probe uses four initial and four held-out sentences, the
acoustic graph with all four languages enabled, and no automatic whisper
detection. The counts below are edits divided by reference phone counts
before transcription. Omit `--wideband` to run the telephone probe.

| Method | Wideband initial | Wideband held-out | Telephone initial | Telephone held-out |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 46/54 | 63/79 | 43/54 | 70/79 |
| Half of neutral response difference | 42/54 | 64/79 | 44/54 | 66/79 |
| Rendered vowels, 40 ms and 16 dB² | 47/54 | 72/79 | 50/54 | 69/79 |
| Rendered vowels, 80 ms and 8 dB² | 44/54 | 66/79 | 49/54 | 63/79 |

Every tested rendered-reference setting increased errors on the held-out
wideband sentences. The steady vowels had 300 ms targets. The shorter
vowels and transitions in running speech need a model of how the spectrum
changes as the articulators move. The measured calibration settings remain
in the experiment.

### Inversion within the tier passband

`node experiments/issue-75-band-limited-inversion.mjs` tests whether the tier's
band limit or the source's spectral tilt explains the poor fit. Use
`--wideband` for the 16 kHz probe. It searches the same codebook exhaustively
with the production score, then limits scoring to the tier passband, removes
the average level difference, and optionally fits out tilt in dB per octave. All
four languages remain eligible during decoding. The synthesis IPA enters
only when counting edits, and automatic whisper detection is disabled to
isolate the voiced decoder.

| Inversion query | Telephone male | Telephone female | Wideband male | Wideband female |
| --- | ---: | ---: | ---: | ---: |
| Production shortlist | 43/54 | 66/79 | 44/54 | 67/79 |
| Exhaustive, all measured bands | 44/54 | 69/79 | 48/54 | 66/79 |
| Exhaustive, within the passband | 48/54 | 67/79 | 48/54 | 62/79 |
| Exhaustive, within the passband with tilt removed | 43/54 | 64/79 | 46/54 | 67/79 |

The male and female columns use different sets of four sentences. The lowest
telephone count for the held-out female sentences improved by two edits out
of 79. That setting increased wideband male errors by two. Every setting
left more than 60% phone error in all four columns.

### Telephone whisper correction

In the Russian smoke case, the detector found a span at 0.49–0.85 s. Its
high-to-low band energy ratio was −26.95 dB, which crossed the relaxed edge
threshold. The pitch tracker returned no F0 there, but 30 of 36 frames had
normalized autocorrelation of at least 0.6. The corrected detector requires
the absolute band ratio to pass for a similarly periodic telephone edge.
The `weak periodic gap` test also exercises frames supplied without
periodicity. They retain the original spectral decision, consistent with
the older WebAssembly frame packet.

`node experiments/issue-75-whisper-evidence.mjs --corpus` renders all 80
sentences at 8 kHz in plain speech and again followed by the same sentence
in a whisper. The correction reduced plain-speech false positives from 1
of 80 to 0 of 80 and removed the same false span from the mixed Russian
recording. In both runs 67 of 80 mixed recordings had a span overlapping
the planned whisper, and 44 of 80 overlapped at least half of that span.

After the correction, `taskset -c 4 node --test tests/roundtrip-smoke.test.js`
took 22.7 seconds wall time. English and Mandarin returned the same results
as the baseline. Russian recovered the top language and lowered its sound
word errors from 4 to 3, while phone errors increased from 7 to 8 of 13.
All three cases missed the 10% phone and zero sound-word error gates.

`node experiments/issue-75-whisper-evidence.mjs --mode-cases` compared
the front-end detector with the spans returned by the public recognizer
for the four whispered telephone mode cases. The Russian case returned
spans at 0.04–3.02 s and 4.32–5.72 s for a planned span at 0.06–6.22 s.
The longer recognition span covered 48.1% of the planned span, below the
50% overlap requirement. The speech run between those spans had no
tracked pitch and a band ratio of −31.15 dB, below the −26.63 dB threshold.

At 8 kHz the detector now joins two fully classified whisper runs across
one unvoiced, mostly aperiodic run when the combined interval passes the
regular whisper test. A regression verifies that periodic speech in the
middle keeps the spans separate. The Rust test compares the span boundaries
and confidence with JavaScript.

With this change, the `--corpus` probe still detected no whispers in 80
plain recordings. Of the 80 mixed recordings, 67 still had a detected
whisper, and the number with at least half of the planned whisper covered
increased from 44 to 46. A focused run of the mode gate measured four of
eight matches instead of three, recovering the Russian whisper. The gate
requires six of eight. The smoke suite took 24.64 seconds on one core and
reported the same three accuracy failures shown above.

```sh
HEAVY_OUT=/tmp/roundtrip-modes node --test --test-name-pattern='^modes telephone$' tests/heavy/roundtrip-sentences.test.js
taskset -c 3 node --test tests/roundtrip-smoke.test.js
```

### Narrowband whisper correction

`node experiments/issue-75-whisper-evidence.mjs --narrowband --mode-cases`
reproduced an English whisper split into 0.04–1.81 s and 3.03–4.26 s.
The input was rendered at 11.025 kHz and analysed at 8 kHz by the tier's
recognition level. The intervening speech run had five tracked pitches
but only 20 ms of consecutive pitch with periodicity of at least 0.6.

The bridge now requires 30 ms of consecutive pitch with that periodicity
to veto a join. The surrounding spans still have to cover their runs,
fewer than 75% of the intervening run's frames may be strongly periodic,
and the combined interval must pass the existing whisper test. The recognizer
returned a single span from 0.04 to 4.26 s. The other three language cases
returned the same spans. The JavaScript regression checks both the
recovered span and a sustained voiced interruption. The WebAssembly
regression compares the span bounds and confidence with JavaScript.

The before and after `--narrowband --corpus --front-end-only` runs returned
identical span boundaries on 80 plain-speech and 80 mixed recordings.

### Limited local benchmark

`npm run test:heavy -- --suite roundtrip --limit 2` at `83bd563` wrote
`reports/heavy/roundtrip.md` in 48 minutes and 24 seconds. Four rows passed
and 73 failed. Telephone phone error was 85.7% in English, 76.7% in Russian,
94.4% in Hindi, and 85.7% in Mandarin.

After the whisper correction, the command below still failed all four
telephone rows. Russian top-language matches increased from 1 of 4 to 2 of 4,
and phone errors increased from 92 to 93 of 120. The other three languages
had the same telephone phone error. The post-merge check on `bb58f70`
reproduced all four results on one core in 63 seconds and wrote both the
Markdown and JSON reports.

```sh
HEAVY_LIMIT=2 node --test --test-name-pattern='^main (en|ru|hi|zh) telephone$' tests/heavy/roundtrip-sentences.test.js
```

### Whole-sentence loudness

In the initial full benchmark, 0 of 36 loud spans matched. Three of four
whisper spans matched at telephone, and four of four matched at each tier
from wideband through studio. The mode gate requires 6 of 8 at telephone
and 8 of 8 at each of those higher tiers.

`node experiments/issue-75-effort-baseline.mjs` repeated the loudness check
on telephone and wideband using the planned span labelled `f` as the reference.
The audio-only stage recovered 0 of 4 spans in each tier, as did the stage
given only the synthesis word timings. Giving it the synthesis voice with
decoded word timings recovered 0 of 4 telephone spans and 1 of 4 wideband
spans. Giving it both the synthesis voice and synthesis word timings recovered
2 of 4 telephone and 1 of 4 wideband spans. Without a supplied voice, the
detector compares effort with the rest of the same utterance.

The benchmark requires `recognize` to work with audio, sample rate, and tier
level. The existing mode specification requires whole-utterance `f` to
produce zero effort spans without `options.voice`, and its regression tests
enforce that behavior. Even detecting all four whispers yields 4 of 8 spans
at each tier, below both mode thresholds.
[Mode specification](https://github.com/konard/voice-simulator/issues/71).

### Scoring consonants in a rendered phrase

`node experiments/issue-75-contextual-templates.mjs` ranked the initial
consonant in four short IPA phrases. Each phrase was spoken by two voices
at telephone and wideband. The experiment rendered seven substitutions
for each onset and gave each candidate the reference phone durations.
It compared normalized waveform correlation and squared distance between
mel-frequency cepstra over the onset, excluding the energy coefficient.

The table counts first-place reference phones out of eight per tier. The
timing change shifts the candidate window 10 ms later. The voice change
uses seed 2 for the same preset. The last row combines all four changes.

| Candidate change | Telephone waveform | Telephone cepstra | Wideband waveform | Wideband cepstra |
| --- | ---: | ---: | ---: | ---: |
| Control with reference context | 8 | 8 | 8 | 8 |
| Question tune | 8 | 8 | 8 | 8 |
| Next vowel | 2 | 6 | 2 | 7 |
| Voice seed | 2 | 8 | 2 | 8 |
| Timing | 1 | 6 | 1 | 8 |
| All changes | 1 | 3 | 2 | 4 |

The run took 55 seconds. Changing a neighboring vowel had a larger effect
than changing the final punctuation. Cepstral distance retained more
correct onsets when the renderer used a different voice seed or a shifted
window. With all changes, it lost five of eight telephone onsets and four
of eight wideband onsets despite the known language, phone durations and
remaining IPA. The probe was restricted to four initial consonants and
does not measure recognition or establish a threshold for full utterances.

### Stop closure detection

The inversion front end marked all 122 frames with a spectral centroid
below 50 Hz as speech in the stop intervals and their release windows.
These frames occurred in 33 of 36 renders of /p t k/ between /a i u/ with
male and female voices at telephone and wideband. The inversion scores
frames marked as speech against tract envelopes. In short gaps its
closure candidates have equal acoustic cost, so their scores depend on
the movement between tract states.

```sh
node experiments/issue-75-stop-release.mjs
node experiments/issue-75-stop-release.mjs --full-codebook
node experiments/issue-75-stop-release.mjs --recognition
```

The 36 renders recovered whether the closure was labial in 23 cases
using the original analysis, 22 when treating frames below 50 Hz as
gaps, 21 after a 70 Hz high-pass filter, and 28 after a 140 Hz filter.
The probe counted /p/ as correct when inferred lip amount at the
planned closure midpoint exceeded 0.5 and /t k/ when it did not.

The full-codebook probe reproduced the inherited inversion gate on
16 kHz /apa ata aka/. Inferred lip amount for /apa/ was 0.137 against
the gate of 0.5. The gap override gave 0.013, and the two filters gave
0.161 and 0.095. The recognizer made 44 edits over 54 reference phones
on four telephone sentences, one per language. Each high-pass filter
increased that total to 47 edits.

### Scoring vowels at pitch harmonics

`node experiments/issue-75-vowel-harmonics.mjs` rendered steady vowel
references at quarter-semitone pitch steps using the same seed-1 head
as each recording. It scored the candidates by their level-normalized
harmonic energy in a 40 ms window around each known vowel midpoint.
The score used frequencies between 300 Hz and the tier's passband limit,
capped at 4800 Hz. The test set includes all 31 sustained vowels and 35
vowels from four running sentences, one in each language.

The table uses pitch tracked from the audio. Each count gives the
number of reference vowels ranked first or among the first five.

| Tier | Preset | Sustained first | Sustained top five | Running first | Running top five |
| --- | --- | ---: | ---: | ---: | ---: |
| telephone | male | 20/31 | 26/31 | 18/35 | 26/35 |
| telephone | female | 13/31 | 24/31 | 12/35 | 24/35 |
| wideband | male | 27/31 | 31/31 | 19/35 | 30/35 |
| wideband | female | 22/31 | 29/31 | 14/35 | 30/35 |

Replacing the tracked pitch with the planned pitch raised the first-place
count in two sustained groups by one each. It matched or reduced all four
running counts. Removing a linear spectral tilt reduced or preserved the
first-place count in each of the eight tracked-pitch groups. The harmonic
score relies on the known head and boundaries and still ranked at most
19 of 35 running vowels first. The probe does not change the recognizer.

### Punctuation from the pitch contour

`node experiments/issue-75-prosody-contours.mjs` measured all 80 sentences
at telephone and wideband with both seeded voices. It first gave the
existing punctuation classifier the transcript and exact timings. It
then fitted the measured vowel pitch to three synthesis plans with the
same text ending in a period, question mark or exclamation point. The
score removes a constant pitch offset in semitones. Two variants shift
the sample times by 20 ms or use seed 2 for the candidate head. A tied
score counts as unresolved.

Results were the same at both tiers. Each language has 40 cases per tier.

| Language | Existing classifier | Contour fit | Shifted 20 ms | Different head | Identical audio |
| --- | ---: | ---: | ---: | ---: | ---: |
| en | 32 | 40 | 40 | 40 | 0 |
| ru | 29 | 40 | 37 | 37 | 0 |
| hi | 36 | 34 | 34 | 6 | 6 |
| zh | 26 | 34 | 32 | 6 | 4 |

Replacing the question mark with a period produced identical sample
counts and sample values in three Hindi sentences and two Mandarin
sentences with each preset. Examples include `तुम्हारा भाई कहाँ रहता है?`
and `你叫什么名字？`. Word cues can still restore a question mark in those
cases. The contour fit also requires the correct words and their vowel
times. It has no production wiring.

### Isolated sustained vowels at 16 kHz

`node experiments/issue-75-isolated-vowels.mjs` compares 25 ms cepstral
frames against duration-matched waveguide renders of the IPA vowel
inventory. The renders exclude the gain coefficient and use the supplied
head. Across 31 vowels each at 240, 300, and 380 ms with male, female,
and child presets, each group ranked 30 of 31 first and all 31 in the
top five. This held with the same render seed and with an independent
seed. The largest best-match error with the independent seed was 0.107
mean squared cepstral units. The batch decoder uses the vowel readings
when the error is at most 0.15 and the recording has a sustained voiced
interval and quiet tail.

The two existing decoder checks now place 30 of 31 first and all 31 in
the top five for each voice. A separate regression uses a changed pitch,
370 ms duration, and a third seed. Before the fix it decoded /ɯ/ as /aa/.
With the fix it returns /ɯ/, the planned timing within 1 ms, and ranked
alternatives in the lattice. The same test compares a two-vowel transition
against the regular decoder. Scalar Rust WebAssembly and JavaScript
rank the same three alternatives for a 330 ms test vowel.

```sh
node --test --test-name-pattern='decodes single vowels|verifies a sustained vowel' tests/recognition-decode.test.js
REQUIRE_WASM=1 node --test --test-name-pattern='ranks an isolated vowel' tests/recognition-parity.test.js
```

The round-trip corpus measures audio-only recognition. These vowel
measurements apply to decoding with an explicit head.

### Stop release templates across voices and vowels

`node experiments/issue-75-release-templates.mjs` compares 10 ms
cepstral frames around the planned release of /p t k/ between vowels.
For each tier it compares 48 recordings against references made with an
independent render seed. Rankings depend on knowing each release time.

| Reference conditions | Telephone correct | Wideband correct |
| --- | ---: | ---: |
| Same head and surrounding vowels | 46/48 | 46/48 |
| Different head, same surrounding vowels | 35/48 | 29/48 |
| Different head and surrounding vowels | 28/48 | 26/48 |

Allowing ±10 ms shifts in the last row reduced telephone accuracy to
25/48 and left wideband at 26/48. Subtracting the following vowel's
cepstra gave 22/48 at telephone and 27/48 at wideband before shifting.
This score has no production wiring.

### Centered averaging of sustained vowel spectra

`node experiments/issue-75-inversion-calibration.mjs` and the same
command with `--wideband --held-out` check a variant of the inversion
that sets a vowel target when the spectral drift in a centered window is
small. At 180 ms and a squared drift threshold of 16 dB² it recovered
28/31 and 25/31 known-voice sustained vowel targets. In four telephone
sentences it made 46 edits in 54 phones, up from 43 with the usual
inversion. In wideband it made the same 46 edits in the initial 54
phones and increased edits from 63 to 66 in the 79 held-out phones.
Longer windows dropped steady vowel recovery to 21/31 and 19/31.
The variant has no production wiring.

### Copying intact 16 kHz recordings

The inherited synthetic copy test on `0ab27bc` measured 77.8% phone
error, 436.23 cents of pitch error and 107.5 ms of syllable timing error.
The render verifier previously excluded native 16 kHz input. At that rate,
the breathy stock female preset also crossed the old onset threshold
within the first millisecond. Using 1% of peak for the leading edge puts
its audible onset at about 48.5 ms. The trailing-edge threshold is unchanged.

`node experiments/issue-75-short-render-match.mjs --copy` and the same
command with `--rust` compared the two waveguide engines, using only the
samples and sampling rate as input to copy. Both engines returned the
following measurements. Timing is measured by decoding the replayed score.

| Phrase | Voice | Phone error | Pitch error | Timing error |
| --- | --- | ---: | ---: | ---: |
| Hello world. | Female | 0% | 0.047 cents | 0 ms |
| Hello world. | Male | 0% | 0.212 cents | 0 ms |
| Pass me. | Male | 0% | 6.391 cents | 26.8 ms |

The short render verifier did not find a waveform match for the female
“Pass me.” or either “We see rain.” recording. Those inputs went through
ordinary voice fitting and recognition and retained substantial phone errors.
The telephone benchmark does not use the short-recording copy path.

### Cepstral vowel references in connected speech

The probe compares 12 cepstral coefficients in an 80 ms window around
each planned vowel midpoint. References are waveguide renders at three
pitches with the same stock head as the input. The score excludes the
gain coefficient and includes a pitch term from the tracked F0. The table
reports the top-ranked result at pitch weight 2. A match requires tongue
height within 0.15 and backness within 0.2 of the planned state.

```sh
node experiments/issue-75-vowel-cepstra.mjs --steady --connected
node experiments/issue-75-vowel-cepstra.mjs --steady --telephone --connected
```

| Rate | Head | Sustained | Reordered and lengthened | Connected |
| --- | --- | ---: | ---: | ---: |
| 16 kHz | Male | 31/31 | 31/31 | 15/21 |
| 16 kHz | Female | 31/31 | 31/31 | 15/21 |
| 8 kHz | Male | 31/31 | 31/31 | 12/21 |
| 8 kHz | Female | 30/31 | 30/31 | 13/21 |

The connected sample uses the English, Russian, and Mandarin smoke
sentences and Hindi sentence 2. The counts include vowels supported by
the steady reference inventory. Even with the supplied voice and midpoint,
the best-scoring reference misses six of 21 vowels at 16 kHz for each voice.
Short vowels and transitions can share the measurement window with their
neighbors.

A prototype used trailing spectral stability to choose the windows without
reference timings. With a supplied voice, it recovered 29 and 27 of the 31
steady vowels in the inherited inversion test, up from seven per voice.
It took 0.891 times the audio duration on the first 16 kHz call to `audioToIpa`,
above the 0.35 limit. The prototype was omitted from production. The
cepstral comparison remains available for testing new observation models.
