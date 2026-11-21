# Synthetic speech round trips

Measured 2026-11-21 on benchmark commit `8a1d734b43cbcb71ffe41fbfdaff90fb7738a18b`.
The [full round-trip run](https://github.com/konard/voice-simulator/actions/runs/44942169457)
finished with 4 passing and 73 failing tests. It covers 640 main, 80 extra
voice, 40 higher-tier, 320 whisper, and 72 mode cases. The mode totals
reuse 16 whisper cases, for 1,136 distinct round trips.
The per-preset rows and the deduplicated ranking use the JSON measurements
from that run.

All 16 main rows missed their phone error limits. Telephone phone error
ranged from 84.1% to 94.0%, and top-language matches ranged from 2.5% to 37.5%.
The telephone mode test recovered all four whispered spans and zero loud
spans, for 4 of 8 matches against the required 6 of 8.

Compared with the [previous full benchmark](https://github.com/konard/voice-simulator/actions/runs/44937340473),
narrowband English whisper recovery increased from 34 to 36 of 40 spans and
phone edits fell from 467 to 464 of 554. Narrowband mode matches increased
from 2 to 3 of 8. All main, voice, and higher-tier accuracy metrics were
identical. No measured whisper threshold qualifies for tightening under #72.

Run `npm run test:heavy -- --suite roundtrip` to reproduce the full report.

All renders use seed 1 and select their voice preset with the seeded head generator. Recognition receives audio and the level for its tier. The reference tier is excluded because of its run time.

Edit rates divide summed edits by summed reference length. Stress covers aligned words of equal syllable count. Timing covers start and end boundaries of aligned syllables with identical IPA. A dash indicates an inapplicable metric or no matches. Recognition RTF divides total recognition time by total audio time.

Mandarin uses character error rate in place of orthographic word error, including for the whisper gate. Sound WER compares Mandarin character pronunciations in context.

The mode tests measure the share of reference spans with matching notation and at least half of their duration overlapped by a recognition span. The gate uses all four languages at each tier.

Rows for male and female presets show their separate measurements when the gates use their combined results.

## main

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male, female | 40 | 86.4% | 98.9% | 95.0% | 99.3% | – | 33.3% | 110.6 | 27.5% | 62.5% | – | 0.204 | PER 0.864 (need ≤ 0.1)<br>sound WER 0.993 (need ≤ 0.2)<br>mean syllable time error (ms) 110.599 (need ≤ 40)<br>language match share 0.275 (need ≥ 0.9)<br>sentence mark match share 0.625 (need ≥ 0.85) |
| en | telephone | male | 20 | 85.3% | 100.0% | 96.2% | 100.0% | – | 33.3% | 68.2 | 25.0% | 60.0% | – | 0.242 | – |
| en | telephone | female | 20 | 87.4% | 97.9% | 93.8% | 98.6% | – | – | 131.8 | 30.0% | 65.0% | – | 0.165 | – |
| en | narrowband | male, female | 40 | 85.0% | 99.6% | 91.4% | 99.6% | – | 33.3% | 266.8 | 52.5% | 60.0% | – | 0.168 | PER 0.850 (need ≤ 0.08)<br>sound WER 0.996 (need ≤ 0.15)<br>mean syllable time error (ms) 266.842 (need ≤ 35)<br>language match share 0.525 (need ≥ 0.92)<br>stress hit share 0.333 (need ≥ 0.9) |
| en | narrowband | male | 20 | 84.1% | 97.9% | 90.2% | 97.9% | – | 0.0% | 266.8 | 60.0% | 55.0% | – | 0.161 | – |
| en | narrowband | female | 20 | 86.0% | 101.4% | 92.6% | 101.4% | – | 100.0% | – | 45.0% | 65.0% | – | 0.176 | – |
| en | wideband | male, female | 40 | 83.9% | 101.8% | 90.5% | 101.8% | – | 0.0% | 254.8 | 50.0% | 60.0% | – | 0.289 | PER 0.839 (need ≤ 0.05)<br>sound WER 1.018 (need ≤ 0.1)<br>mean syllable time error (ms) 254.836 (need ≤ 30)<br>language match share 0.500 (need ≥ 0.95)<br>stress hit share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.9) |
| en | wideband | male | 20 | 82.2% | 103.5% | 88.5% | 103.5% | – | 0.0% | 74.7 | 55.0% | 65.0% | – | 0.290 | – |
| en | wideband | female | 20 | 85.5% | 100.0% | 92.5% | 100.0% | – | 0.0% | 435.0 | 45.0% | 55.0% | – | 0.287 | – |
| en | minimal | male, female | 40 | 84.2% | 100.7% | 92.4% | 100.7% | – | 40.0% | 118.5 | 40.0% | 67.5% | – | 0.559 | PER 0.842 (need ≤ 0.05)<br>sound WER 1.007 (need ≤ 0.1)<br>mean syllable time error (ms) 118.469 (need ≤ 30)<br>language match share 0.400 (need ≥ 0.95)<br>stress hit share 0.400 (need ≥ 0.9)<br>sentence mark match share 0.675 (need ≥ 0.9) |
| en | minimal | male | 20 | 84.1% | 102.1% | 93.0% | 102.1% | – | 50.0% | – | 35.0% | 70.0% | – | 0.801 | – |
| en | minimal | female | 20 | 84.3% | 99.3% | 91.8% | 99.3% | – | 33.3% | 118.5 | 45.0% | 65.0% | – | 0.313 | – |
| ru | telephone | male, female | 40 | 84.1% | 103.4% | 94.3% | 106.9% | – | 14.3% | 52.9 | 32.5% | 55.0% | – | 0.288 | PER 0.841 (need ≤ 0.1)<br>sound WER 1.069 (need ≤ 0.2)<br>mean syllable time error (ms) 52.918 (need ≤ 40)<br>language match share 0.325 (need ≥ 0.9)<br>sentence mark match share 0.550 (need ≥ 0.85) |
| ru | telephone | male | 20 | 85.6% | 102.3% | 92.5% | 105.7% | – | 0.0% | – | 45.0% | 55.0% | – | 0.173 | – |
| ru | telephone | female | 20 | 82.7% | 104.6% | 96.0% | 108.0% | – | 50.0% | 52.9 | 20.0% | 55.0% | – | 0.406 | – |
| ru | narrowband | male, female | 40 | 85.4% | 106.3% | 92.5% | 108.0% | – | 28.6% | 203.2 | 42.5% | 55.0% | – | 0.418 | PER 0.854 (need ≤ 0.08)<br>sound WER 1.080 (need ≤ 0.15)<br>mean syllable time error (ms) 203.244 (need ≤ 35)<br>language match share 0.425 (need ≥ 0.92)<br>stress hit share 0.286 (need ≥ 0.9) |
| ru | narrowband | male | 20 | 85.6% | 105.7% | 92.8% | 109.2% | – | 0.0% | 42.9 | 50.0% | 45.0% | – | 0.400 | – |
| ru | narrowband | female | 20 | 85.1% | 106.9% | 92.3% | 106.9% | – | 66.7% | 256.7 | 35.0% | 65.0% | – | 0.437 | – |
| ru | wideband | male, female | 40 | 83.3% | 110.9% | 92.3% | 113.8% | – | 71.4% | 136.6 | 40.0% | 62.5% | – | 0.550 | PER 0.833 (need ≤ 0.05)<br>sound WER 1.138 (need ≤ 0.1)<br>mean syllable time error (ms) 136.596 (need ≤ 30)<br>language match share 0.400 (need ≥ 0.95)<br>stress hit share 0.714 (need ≥ 0.9)<br>sentence mark match share 0.625 (need ≥ 0.9) |
| ru | wideband | male | 20 | 83.9% | 110.3% | 93.3% | 111.5% | – | 50.0% | 29.2 | 40.0% | 60.0% | – | 0.520 | – |
| ru | wideband | female | 20 | 82.7% | 111.5% | 91.3% | 116.1% | – | 100.0% | 158.1 | 40.0% | 65.0% | – | 0.581 | – |
| ru | minimal | male, female | 40 | 83.7% | 118.4% | 92.8% | 121.3% | – | 16.7% | 201.9 | 35.0% | 62.5% | – | 0.977 | PER 0.837 (need ≤ 0.05)<br>sound WER 1.213 (need ≤ 0.1)<br>mean syllable time error (ms) 201.927 (need ≤ 30)<br>language match share 0.350 (need ≥ 0.95)<br>stress hit share 0.167 (need ≥ 0.9)<br>sentence mark match share 0.625 (need ≥ 0.9) |
| ru | minimal | male | 20 | 83.2% | 116.1% | 91.5% | 118.4% | – | 0.0% | 174.6 | 40.0% | 60.0% | – | 1.348 | – |
| ru | minimal | female | 20 | 84.1% | 120.7% | 94.0% | 124.1% | – | 50.0% | 256.5 | 30.0% | 65.0% | – | 0.598 | – |
| hi | telephone | male, female | 40 | 94.0% | 101.0% | 100.0% | 101.0% | – | – | – | 2.5% | 70.0% | – | 0.184 | PER 0.940 (need ≤ 0.1)<br>sound WER 1.010 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.025 (need ≥ 0.9)<br>sentence mark match share 0.700 (need ≥ 0.85) |
| hi | telephone | male | 20 | 94.5% | 102.0% | 100.0% | 102.0% | – | – | – | 5.0% | 85.0% | – | 0.177 | – |
| hi | telephone | female | 20 | 93.4% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 55.0% | – | 0.192 | – |
| hi | narrowband | male, female | 40 | 94.4% | 101.5% | 100.0% | 101.5% | – | – | – | 0.0% | 60.0% | – | 0.309 | PER 0.944 (need ≤ 0.08)<br>sound WER 1.015 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 35)<br>language match share 0.000 (need ≥ 0.92) |
| hi | narrowband | male | 20 | 94.3% | 102.0% | 100.0% | 102.0% | – | – | – | 0.0% | 60.0% | – | 0.416 | – |
| hi | narrowband | female | 20 | 94.5% | 101.0% | 100.0% | 101.0% | – | – | – | 0.0% | 60.0% | – | 0.200 | – |
| hi | wideband | male, female | 40 | 92.0% | 104.6% | 100.0% | 104.6% | – | – | – | 5.0% | 57.5% | – | 0.450 | PER 0.920 (need ≤ 0.05)<br>sound WER 1.046 (need ≤ 0.1)<br>mean syllable time error (ms) unavailable (need ≤ 30)<br>language match share 0.050 (need ≥ 0.95)<br>sentence mark match share 0.575 (need ≥ 0.9) |
| hi | wideband | male | 20 | 92.2% | 104.1% | 100.0% | 104.1% | – | – | – | 5.0% | 60.0% | – | 0.583 | – |
| hi | wideband | female | 20 | 91.7% | 105.1% | 100.0% | 105.1% | – | – | – | 5.0% | 55.0% | – | 0.313 | – |
| hi | minimal | male, female | 40 | 92.0% | 106.1% | 99.7% | 106.1% | – | – | – | 0.0% | 60.0% | – | 1.213 | PER 0.920 (need ≤ 0.05)<br>sound WER 1.061 (need ≤ 0.1)<br>mean syllable time error (ms) unavailable (need ≤ 30)<br>language match share 0.000 (need ≥ 0.95)<br>sentence mark match share 0.600 (need ≥ 0.9) |
| hi | minimal | male | 20 | 91.1% | 108.2% | 100.0% | 108.2% | – | – | – | 0.0% | 60.0% | – | 2.068 | – |
| hi | minimal | female | 20 | 92.8% | 104.1% | 99.4% | 104.1% | – | – | – | 0.0% | 60.0% | – | 0.342 | – |
| zh | telephone | male, female | 40 | 87.4% | – | 150.4% | 150.4% | 77.9% | – | – | 37.5% | 60.0% | – | 0.173 | PER 0.874 (need ≤ 0.1)<br>sound WER 1.504 (need ≤ 0.2)<br>tone error 0.779 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.375 (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| zh | telephone | male | 20 | 86.5% | – | 151.9% | 151.9% | 80.2% | – | – | 30.0% | 65.0% | – | 0.173 | – |
| zh | telephone | female | 20 | 88.3% | – | 148.9% | 148.9% | 75.6% | – | – | 45.0% | 55.0% | – | 0.172 | – |
| zh | narrowband | male, female | 40 | 86.5% | – | 152.3% | 152.3% | 82.1% | – | – | 12.5% | 60.0% | – | 0.180 | PER 0.865 (need ≤ 0.08)<br>sound WER 1.523 (need ≤ 0.15)<br>tone error 0.821 (need ≤ 0.12)<br>mean syllable time error (ms) unavailable (need ≤ 35)<br>language match share 0.125 (need ≥ 0.92) |
| zh | narrowband | male | 20 | 86.2% | – | 159.5% | 159.5% | 83.2% | – | – | 10.0% | 55.0% | – | 0.180 | – |
| zh | narrowband | female | 20 | 86.8% | – | 145.0% | 145.0% | 80.9% | – | – | 15.0% | 65.0% | – | 0.179 | – |
| zh | wideband | male, female | 40 | 88.7% | – | 180.9% | 180.9% | 85.1% | – | – | 17.5% | 67.5% | – | 0.300 | PER 0.887 (need ≤ 0.05)<br>sound WER 1.809 (need ≤ 0.1)<br>tone error 0.851 (need ≤ 0.1)<br>mean syllable time error (ms) unavailable (need ≤ 30)<br>language match share 0.175 (need ≥ 0.95)<br>sentence mark match share 0.675 (need ≥ 0.9) |
| zh | wideband | male | 20 | 90.8% | – | 184.0% | 184.0% | 85.5% | – | – | 15.0% | 65.0% | – | 0.299 | – |
| zh | wideband | female | 20 | 86.5% | – | 177.9% | 177.9% | 84.7% | – | – | 20.0% | 70.0% | – | 0.301 | – |
| zh | minimal | male, female | 40 | 86.7% | – | 185.9% | 185.9% | 87.0% | – | – | 20.0% | 72.5% | – | 0.700 | PER 0.867 (need ≤ 0.05)<br>sound WER 1.859 (need ≤ 0.1)<br>tone error 0.870 (need ≤ 0.1)<br>mean syllable time error (ms) unavailable (need ≤ 30)<br>language match share 0.200 (need ≥ 0.95)<br>sentence mark match share 0.725 (need ≥ 0.9) |
| zh | minimal | male | 20 | 88.3% | – | 203.8% | 203.8% | 89.3% | – | – | 5.0% | 65.0% | – | 1.067 | – |
| zh | minimal | female | 20 | 85.1% | – | 167.9% | 167.9% | 84.7% | – | – | 35.0% | 80.0% | – | 0.326 | – |

## voices

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | any | 5 | 85.3% | 100.0% | 97.5% | 100.0% | – | 0.0% | – | 20.0% | 20.0% | – | 0.156 | PER 0.853 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.200 (need ≥ 0.9)<br>sentence mark match share 0.200 (need ≥ 0.85) |
| en | telephone | child | 5 | 88.4% | 100.0% | 91.9% | 100.0% | – | – | – | 40.0% | 40.0% | – | 0.148 | PER 0.884 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.400 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.85) |
| en | wideband | any | 5 | 82.9% | 97.2% | 93.8% | 97.2% | – | 100.0% | 84.5 | 20.0% | 40.0% | – | 0.284 | PER 0.829 (need ≤ 0.1)<br>sound WER 0.972 (need ≤ 0.2)<br>mean syllable time error (ms) 84.462 (need ≤ 40)<br>language match share 0.200 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| en | wideband | child | 5 | 84.5% | 105.6% | 94.4% | 108.3% | – | – | – | 40.0% | 60.0% | – | 0.276 | PER 0.845 (need ≤ 0.1)<br>sound WER 1.083 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.400 (need ≥ 0.9)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.9) |
| ru | telephone | any | 5 | 85.7% | 104.5% | 98.2% | 118.2% | – | 0.0% | – | 0.0% | 20.0% | – | 0.945 | PER 0.857 (need ≤ 0.1)<br>sound WER 1.182 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.200 (need ≥ 0.85) |
| ru | telephone | child | 5 | 85.7% | 113.6% | 98.2% | 131.8% | – | – | – | 0.0% | 60.0% | – | 0.936 | PER 0.857 (need ≤ 0.1)<br>sound WER 1.318 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| ru | wideband | any | 5 | 83.9% | 127.3% | 85.3% | 127.3% | – | – | – | 80.0% | 40.0% | – | 1.134 | PER 0.839 (need ≤ 0.1)<br>sound WER 1.273 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.800 (need ≥ 0.9)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| ru | wideband | child | 5 | 83.9% | 127.3% | 94.5% | 136.4% | – | 0.0% | 10.2 | 40.0% | 40.0% | – | 0.284 | PER 0.839 (need ≤ 0.1)<br>sound WER 1.364 (need ≤ 0.2)<br>language match share 0.400 (need ≥ 0.9)<br>stress hit share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| hi | telephone | any | 5 | 96.3% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 60.0% | – | 0.182 | PER 0.963 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| hi | telephone | child | 5 | 92.6% | 104.2% | 100.0% | 108.3% | – | – | – | 0.0% | 40.0% | – | 0.186 | PER 0.926 (need ≤ 0.1)<br>sound WER 1.083 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.85) |
| hi | wideband | any | 5 | 93.8% | 104.2% | 98.7% | 104.2% | – | – | – | 0.0% | 80.0% | – | 0.290 | PER 0.938 (need ≤ 0.1)<br>sound WER 1.042 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.800 (need ≥ 0.9) |
| hi | wideband | child | 5 | 91.4% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 40.0% | – | 0.324 | PER 0.914 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| zh | telephone | any | 5 | 88.8% | – | 175.8% | 175.8% | 87.9% | – | – | 20.0% | 20.0% | – | 0.163 | PER 0.888 (need ≤ 0.1)<br>sound WER 1.758 (need ≤ 0.2)<br>tone error 0.879 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.200 (need ≥ 0.9)<br>sentence mark match share 0.200 (need ≥ 0.85) |
| zh | telephone | child | 5 | 87.6% | – | 142.4% | 142.4% | 69.7% | – | – | 60.0% | 40.0% | – | 0.162 | PER 0.876 (need ≤ 0.1)<br>sound WER 1.424 (need ≤ 0.2)<br>tone error 0.697 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.600 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.85) |
| zh | wideband | any | 5 | 86.5% | – | 203.0% | 203.0% | 90.9% | – | – | 0.0% | 20.0% | – | 0.282 | PER 0.865 (need ≤ 0.1)<br>sound WER 2.030 (need ≤ 0.2)<br>tone error 0.909 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.200 (need ≥ 0.9) |
| zh | wideband | child | 5 | 85.4% | – | 206.1% | 206.1% | 87.9% | – | – | 20.0% | 40.0% | – | 0.305 | PER 0.854 (need ≤ 0.1)<br>sound WER 2.061 (need ≤ 0.2)<br>tone error 0.879 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.200 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |

## tiers

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | low | male | 2 | 84.0% | 111.1% | 90.9% | 111.1% | – | – | – | 0.0% | 100.0% | – | 0.324 | PER 0.840 (need ≤ 0.1) |
| en | medium | male | 2 | 88.0% | 100.0% | 100.0% | 100.0% | – | – | – | 50.0% | 100.0% | – | 0.472 | PER 0.880 (need ≤ 0.1) |
| en | high | male | 2 | 92.0% | 100.0% | 103.0% | 100.0% | – | – | – | 50.0% | 100.0% | – | 0.650 | PER 0.920 (need ≤ 0.1) |
| en | ultra | male | 2 | 96.0% | 111.1% | 103.0% | 111.1% | – | – | – | 50.0% | 100.0% | – | 0.525 | PER 0.960 (need ≤ 0.1) |
| en | studio | male | 2 | 80.0% | 111.1% | 103.0% | 111.1% | – | – | – | 0.0% | 100.0% | – | 0.595 | PER 0.800 (need ≤ 0.1) |
| ru | low | male | 2 | 73.3% | 125.0% | 100.0% | 125.0% | – | – | – | 50.0% | 0.0% | – | 4.125 | PER 0.733 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.000 (need ≥ 0.9) |
| ru | medium | male | 2 | 86.7% | 175.0% | 106.7% | 175.0% | – | – | – | 0.0% | 50.0% | – | 4.191 | PER 0.867 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| ru | high | male | 2 | 100.0% | 100.0% | 106.7% | 100.0% | – | – | – | 50.0% | 100.0% | – | 4.899 | PER 1.000 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9) |
| ru | ultra | male | 2 | 100.0% | 125.0% | 100.0% | 150.0% | – | – | – | 50.0% | 50.0% | – | 4.614 | PER 1.000 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| ru | studio | male | 2 | 93.3% | 125.0% | 93.3% | 125.0% | – | – | – | 50.0% | 100.0% | – | 4.318 | PER 0.933 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9) |
| hi | low | male | 2 | 92.9% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 100.0% | – | 0.399 | PER 0.929 (need ≤ 0.1) |
| hi | medium | male | 2 | 92.9% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 50.0% | – | 2.059 | PER 0.929 (need ≤ 0.1)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| hi | high | male | 2 | 100.0% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 100.0% | – | 2.085 | PER 1.000 (need ≤ 0.1) |
| hi | ultra | male | 2 | 92.9% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 100.0% | – | 2.115 | PER 0.929 (need ≤ 0.1) |
| hi | studio | male | 2 | 92.9% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 100.0% | – | 2.050 | PER 0.929 (need ≤ 0.1) |
| zh | low | male | 2 | 100.0% | – | 216.7% | 216.7% | 116.7% | – | – | 0.0% | 100.0% | – | 0.354 | PER 1.000 (need ≤ 0.1) |
| zh | medium | male | 2 | 88.2% | – | 133.3% | 133.3% | 100.0% | – | – | 50.0% | 100.0% | – | 2.592 | PER 0.882 (need ≤ 0.1) |
| zh | high | male | 2 | 94.1% | – | 183.3% | 183.3% | 100.0% | – | – | 50.0% | 100.0% | – | 2.636 | PER 0.941 (need ≤ 0.1) |
| zh | ultra | male | 2 | 88.2% | – | 183.3% | 183.3% | 116.7% | – | – | 50.0% | 100.0% | – | 2.689 | PER 0.882 (need ≤ 0.1) |
| zh | studio | male | 2 | 94.1% | – | 283.3% | 283.3% | 100.0% | – | – | 0.0% | 50.0% | – | 2.604 | PER 0.941 (need ≤ 0.1)<br>sentence mark match share 0.500 (need ≥ 0.9) |

## whisper

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male, female | 20 | 88.3% | 104.4% | 96.0% | 107.6% | – | – | 166.4 | 25.0% | 60.0% | 70.0% | 0.252 | PER 0.883 (need ≤ 0.25)<br>WER 1.044 (need ≤ 0.35) |
| en | telephone | male | 10 | 89.5% | 103.8% | 95.3% | 106.3% | – | – | – | 30.0% | 60.0% | 70.0% | 0.375 | – |
| en | telephone | female | 10 | 87.0% | 105.1% | 96.8% | 108.9% | – | – | 166.4 | 20.0% | 60.0% | 70.0% | 0.127 | – |
| en | narrowband | male, female | 20 | 83.8% | 101.3% | 89.6% | 102.5% | – | – | 26.9 | 40.0% | 60.0% | 90.0% | 0.151 | Pass |
| en | narrowband | male | 10 | 76.9% | 103.8% | 85.3% | 103.8% | – | – | 26.9 | 50.0% | 60.0% | 90.0% | 0.151 | – |
| en | narrowband | female | 10 | 90.6% | 98.7% | 93.8% | 101.3% | – | – | – | 30.0% | 60.0% | 90.0% | 0.152 | – |
| en | wideband | male, female | 20 | 83.0% | 105.1% | 90.4% | 105.7% | – | 100.0% | 28.1 | 35.0% | 60.0% | 80.0% | 0.577 | PER 0.830 (need ≤ 0.15)<br>WER 1.051 (need ≤ 0.25) |
| en | wideband | male | 10 | 80.5% | 97.5% | 90.3% | 98.7% | – | – | 27.2 | 40.0% | 60.0% | 90.0% | 0.918 | – |
| en | wideband | female | 10 | 85.6% | 112.7% | 90.6% | 112.7% | – | 100.0% | 30.9 | 30.0% | 60.0% | 70.0% | 0.230 | – |
| en | minimal | male, female | 20 | 81.8% | 99.4% | 86.2% | 99.4% | – | – | 25.8 | 45.0% | 60.0% | 90.0% | 0.470 | PER 0.818 (need ≤ 0.15)<br>WER 0.994 (need ≤ 0.25) |
| en | minimal | male | 10 | 82.7% | 94.9% | 84.1% | 94.9% | – | – | 29.1 | 60.0% | 60.0% | 90.0% | 0.668 | – |
| en | minimal | female | 10 | 80.9% | 103.8% | 88.2% | 103.8% | – | – | 12.5 | 30.0% | 60.0% | 90.0% | 0.268 | – |
| ru | telephone | male, female | 20 | 82.9% | 112.5% | 83.3% | 115.9% | – | – | 34.9 | 75.0% | 60.0% | 90.0% | 0.122 | PER 0.829 (need ≤ 0.25)<br>WER 1.125 (need ≤ 0.35) |
| ru | telephone | male | 10 | 83.3% | 115.9% | 81.6% | 115.9% | – | – | 34.9 | 90.0% | 60.0% | 80.0% | 0.116 | – |
| ru | telephone | female | 10 | 82.4% | 109.1% | 84.9% | 115.9% | – | – | – | 60.0% | 60.0% | 100.0% | 0.128 | – |
| ru | narrowband | male, female | 20 | 86.8% | 101.1% | 88.4% | 103.4% | – | – | 42.6 | 60.0% | 60.0% | 90.0% | 0.136 | Pass |
| ru | narrowband | male | 10 | 84.3% | 97.7% | 88.2% | 97.7% | – | – | 42.6 | 60.0% | 60.0% | 90.0% | 0.131 | – |
| ru | narrowband | female | 10 | 89.4% | 104.5% | 88.7% | 109.1% | – | – | – | 60.0% | 60.0% | 90.0% | 0.141 | – |
| ru | wideband | male, female | 20 | 86.1% | 112.5% | 82.8% | 115.9% | – | – | – | 90.0% | 60.0% | 70.0% | 0.206 | PER 0.861 (need ≤ 0.15)<br>WER 1.125 (need ≤ 0.25) |
| ru | wideband | male | 10 | 84.7% | 113.6% | 84.9% | 120.5% | – | – | – | 90.0% | 60.0% | 70.0% | 0.205 | – |
| ru | wideband | female | 10 | 87.5% | 111.4% | 80.7% | 111.4% | – | – | – | 90.0% | 60.0% | 70.0% | 0.208 | – |
| ru | minimal | male, female | 20 | 85.2% | 117.0% | 84.2% | 119.3% | – | – | 12.7 | 90.0% | 60.0% | 70.0% | 0.527 | PER 0.852 (need ≤ 0.15)<br>WER 1.170 (need ≤ 0.25) |
| ru | minimal | male | 10 | 85.6% | 122.7% | 84.4% | 127.3% | – | – | 12.7 | 90.0% | 60.0% | 70.0% | 0.218 | – |
| ru | minimal | female | 10 | 84.7% | 111.4% | 84.0% | 111.4% | – | – | – | 90.0% | 60.0% | 70.0% | 0.842 | – |
| hi | telephone | male, female | 20 | 94.1% | 104.0% | 99.7% | 111.0% | – | – | – | 5.0% | 60.0% | 95.0% | 0.157 | PER 0.941 (need ≤ 0.25)<br>WER 1.040 (need ≤ 0.35) |
| hi | telephone | male | 10 | 91.6% | 108.0% | 99.4% | 114.0% | – | – | – | 10.0% | 60.0% | 90.0% | 0.175 | – |
| hi | telephone | female | 10 | 96.6% | 100.0% | 100.0% | 108.0% | – | – | – | 0.0% | 60.0% | 100.0% | 0.137 | – |
| hi | narrowband | male, female | 20 | 96.3% | 102.0% | 100.0% | 103.0% | – | – | – | 0.0% | 60.0% | 100.0% | 0.142 | Pass |
| hi | narrowband | male | 10 | 95.5% | 102.0% | 100.0% | 104.0% | – | – | – | 0.0% | 60.0% | 100.0% | 0.142 | – |
| hi | narrowband | female | 10 | 97.2% | 102.0% | 100.0% | 102.0% | – | – | – | 0.0% | 60.0% | 100.0% | 0.142 | – |
| hi | wideband | male, female | 20 | 95.2% | 103.0% | 100.0% | 106.0% | – | – | – | 0.0% | 60.0% | 95.0% | 0.238 | PER 0.952 (need ≤ 0.15)<br>WER 1.030 (need ≤ 0.25) |
| hi | wideband | male | 10 | 94.9% | 102.0% | 100.0% | 108.0% | – | – | – | 0.0% | 60.0% | 90.0% | 0.233 | – |
| hi | wideband | female | 10 | 95.5% | 104.0% | 100.0% | 104.0% | – | – | – | 0.0% | 60.0% | 100.0% | 0.244 | – |
| hi | minimal | male, female | 20 | 96.1% | 113.0% | 99.1% | 115.0% | – | – | – | 5.0% | 60.0% | 90.0% | 0.345 | PER 0.961 (need ≤ 0.15)<br>WER 1.130 (need ≤ 0.25) |
| hi | minimal | male | 10 | 95.5% | 122.0% | 98.3% | 126.0% | – | – | – | 10.0% | 60.0% | 80.0% | 0.248 | – |
| hi | minimal | female | 10 | 96.6% | 104.0% | 100.0% | 104.0% | – | – | – | 0.0% | 60.0% | 100.0% | 0.443 | – |
| zh | telephone | male, female | 20 | 87.2% | – | 146.9% | 147.7% | 101.6% | – | – | 55.0% | 50.0% | 85.0% | 0.501 | PER 0.872 (need ≤ 0.25)<br>CER 1.469 (need ≤ 0.35)<br>tone error 1.016 (need ≤ 0.3) |
| zh | telephone | male | 10 | 89.0% | – | 153.1% | 154.7% | 103.1% | – | – | 50.0% | 50.0% | 80.0% | 0.855 | – |
| zh | telephone | female | 10 | 85.4% | – | 140.6% | 140.6% | 100.0% | – | – | 60.0% | 50.0% | 90.0% | 0.140 | – |
| zh | narrowband | male, female | 20 | 85.4% | – | 147.7% | 149.2% | 90.6% | – | – | 35.0% | 45.0% | 90.0% | 0.153 | tone error 0.906 (need ≤ 0.25) |
| zh | narrowband | male | 10 | 82.3% | – | 153.1% | 156.3% | 90.6% | – | – | 40.0% | 40.0% | 80.0% | 0.153 | – |
| zh | narrowband | female | 10 | 88.4% | – | 142.2% | 142.2% | 90.6% | – | – | 30.0% | 50.0% | 100.0% | 0.153 | – |
| zh | wideband | male, female | 20 | 86.9% | – | 149.2% | 149.2% | 89.8% | – | 22.3 | 30.0% | 45.0% | 95.0% | 0.667 | PER 0.869 (need ≤ 0.15)<br>CER 1.492 (need ≤ 0.25)<br>tone error 0.898 (need ≤ 0.25) |
| zh | wideband | male | 10 | 89.6% | – | 150.0% | 150.0% | 90.6% | – | – | 40.0% | 40.0% | 100.0% | 1.089 | – |
| zh | wideband | female | 10 | 84.1% | – | 148.4% | 148.4% | 89.1% | – | 22.3 | 20.0% | 50.0% | 90.0% | 0.236 | – |
| zh | minimal | male, female | 20 | 87.8% | – | 141.4% | 141.4% | 89.1% | – | 12.7 | 40.0% | 45.0% | 95.0% | 0.691 | PER 0.878 (need ≤ 0.15)<br>CER 1.414 (need ≤ 0.25)<br>tone error 0.891 (need ≤ 0.25) |
| zh | minimal | male | 10 | 89.6% | – | 134.4% | 134.4% | 87.5% | – | – | 50.0% | 40.0% | 100.0% | 0.929 | – |
| zh | minimal | female | 10 | 86.0% | – | 148.4% | 148.4% | 90.6% | – | 12.7 | 30.0% | 50.0% | 90.0% | 0.447 | – |

## modes

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male | 2 | 89.7% | 100.0% | 98.6% | 105.6% | – | 0.0% | – | 0.0% | 100.0% | 50.0% | 1.306 | – |
| ru | telephone | male | 2 | 81.9% | 100.0% | 81.5% | 100.0% | – | – | – | 100.0% | 50.0% | 50.0% | 0.133 | – |
| hi | telephone | male | 2 | 100.0% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 0.0% | 50.0% | 0.149 | – |
| zh | telephone | male | 2 | 88.6% | – | 181.3% | 181.3% | 106.3% | – | – | 50.0% | 0.0% | 50.0% | 0.145 | – |
| all | telephone | male | 8 | 87.7% | 100.0% | 97.6% | 122.6% | 106.3% | 0.0% | – | 37.5% | 37.5% | 50.0% | 0.444 | mode match share 0.500 (need ≥ 0.75) |
| en | narrowband | male | 2 | 85.3% | 100.0% | 92.9% | 100.0% | – | – | – | 50.0% | 50.0% | 50.0% | 0.143 | – |
| ru | narrowband | male | 2 | 83.0% | 100.0% | 90.2% | 100.0% | – | – | – | 50.0% | 100.0% | 0.0% | 0.145 | – |
| hi | narrowband | male | 2 | 96.7% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 0.0% | 50.0% | 0.157 | – |
| zh | narrowband | male | 2 | 88.6% | – | 181.3% | 187.5% | 93.8% | – | – | 50.0% | 0.0% | 50.0% | 0.156 | – |
| all | narrowband | male | 8 | 86.4% | 100.0% | 99.5% | 122.6% | 93.8% | – | – | 37.5% | 37.5% | 37.5% | 0.149 | – |
| en | wideband | male | 2 | 83.8% | 100.0% | 94.3% | 100.0% | – | – | – | 50.0% | 50.0% | 50.0% | 1.512 | – |
| ru | wideband | male | 2 | 85.1% | 100.0% | 85.9% | 100.0% | – | – | – | 100.0% | 50.0% | 50.0% | 0.259 | – |
| hi | wideband | male | 2 | 90.0% | 100.0% | 93.3% | 125.0% | – | – | – | 50.0% | 0.0% | 50.0% | 0.269 | – |
| zh | wideband | male | 2 | 84.1% | – | 218.8% | 218.8% | 93.8% | – | – | 0.0% | 50.0% | 50.0% | 2.265 | – |
| all | wideband | male | 8 | 85.2% | 100.0% | 100.0% | 133.9% | 93.8% | – | – | 50.0% | 37.5% | 50.0% | 1.060 | mode match share 0.500 (need ≥ 0.9) |
| en | minimal | male | 2 | 79.4% | 100.0% | 94.3% | 100.0% | – | – | 42.3 | 50.0% | 50.0% | 50.0% | 0.306 | – |
| ru | minimal | male | 2 | 79.8% | 115.0% | 87.0% | 115.0% | – | – | – | 50.0% | 100.0% | 50.0% | 0.322 | – |
| hi | minimal | male | 2 | 90.0% | 112.5% | 100.0% | 137.5% | – | – | – | 0.0% | 0.0% | 50.0% | 1.237 | – |
| zh | minimal | male | 2 | 90.9% | – | 225.0% | 225.0% | 100.0% | – | – | 0.0% | 0.0% | 50.0% | 2.301 | – |
| all | minimal | male | 8 | 83.1% | 108.7% | 101.9% | 141.9% | 100.0% | – | 42.3 | 25.0% | 37.5% | 50.0% | 0.932 | mode match share 0.500 (need ≥ 0.9) |
| en | low | male | 2 | 76.5% | 94.4% | 95.7% | 94.4% | – | – | 29.8 | 0.0% | 100.0% | 50.0% | 0.479 | – |
| ru | low | male | 2 | 80.9% | 100.0% | 85.9% | 100.0% | – | 100.0% | – | 50.0% | 50.0% | 50.0% | 0.282 | – |
| hi | low | male | 2 | 93.3% | 125.0% | 100.0% | 125.0% | – | – | – | 0.0% | 0.0% | 50.0% | 0.280 | – |
| zh | low | male | 2 | 81.8% | – | 193.8% | 193.8% | 93.8% | – | – | 0.0% | 0.0% | 50.0% | 0.316 | – |
| all | low | male | 8 | 81.4% | 102.2% | 99.5% | 125.8% | 93.8% | 100.0% | 29.8 | 12.5% | 37.5% | 50.0% | 0.341 | mode match share 0.500 (need ≥ 0.9) |
| en | medium | male | 2 | 83.8% | 100.0% | 88.6% | 100.0% | – | – | – | 100.0% | 50.0% | 50.0% | 0.521 | – |
| ru | medium | male | 2 | 79.8% | 100.0% | 82.6% | 100.0% | – | – | – | 100.0% | 50.0% | 50.0% | 0.330 | – |
| hi | medium | male | 2 | 100.0% | 125.0% | 100.0% | 125.0% | – | – | – | 0.0% | 50.0% | 50.0% | 1.259 | – |
| zh | medium | male | 2 | 93.2% | – | 193.8% | 193.8% | 87.5% | – | – | 0.0% | 0.0% | 50.0% | 2.726 | – |
| all | medium | male | 8 | 86.0% | 104.3% | 95.7% | 127.4% | 87.5% | – | – | 50.0% | 37.5% | 50.0% | 1.094 | mode match share 0.500 (need ≥ 0.9) |
| en | high | male | 2 | 88.2% | 111.1% | 92.9% | 111.1% | – | – | – | 50.0% | 100.0% | 50.0% | 0.518 | – |
| ru | high | male | 2 | 91.5% | 100.0% | 90.2% | 100.0% | – | – | – | 50.0% | 100.0% | 50.0% | 0.331 | – |
| hi | high | male | 2 | 96.7% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 0.0% | 50.0% | 1.275 | – |
| zh | high | male | 2 | 93.2% | – | 243.8% | 243.8% | 100.0% | – | – | 0.0% | 50.0% | 50.0% | 0.319 | – |
| all | high | male | 8 | 91.5% | 104.3% | 104.3% | 140.3% | 100.0% | – | – | 25.0% | 62.5% | 50.0% | 0.530 | mode match share 0.500 (need ≥ 0.9) |
| en | ultra | male | 2 | 88.2% | 105.6% | 90.0% | 105.6% | – | – | – | 50.0% | 50.0% | 50.0% | 0.517 | – |
| ru | ultra | male | 2 | 89.4% | 115.0% | 87.0% | 115.0% | – | 0.0% | – | 100.0% | 100.0% | 50.0% | 0.352 | – |
| hi | ultra | male | 2 | 86.7% | 125.0% | 100.0% | 125.0% | – | – | – | 0.0% | 50.0% | 50.0% | 1.304 | – |
| zh | ultra | male | 2 | 84.1% | – | 268.8% | 268.8% | 100.0% | – | – | 0.0% | 0.0% | 50.0% | 0.352 | – |
| all | ultra | male | 8 | 87.7% | 113.0% | 103.8% | 153.2% | 100.0% | 0.0% | – | 37.5% | 50.0% | 50.0% | 0.549 | mode match share 0.500 (need ≥ 0.9) |
| en | studio | male | 2 | 88.2% | 105.6% | 92.9% | 105.6% | – | – | – | 50.0% | 50.0% | 50.0% | 0.516 | – |
| ru | studio | male | 2 | 89.4% | 120.0% | 91.3% | 120.0% | – | – | – | 50.0% | 100.0% | 50.0% | 0.330 | – |
| hi | studio | male | 2 | 100.0% | 125.0% | 103.3% | 125.0% | – | – | – | 0.0% | 0.0% | 50.0% | 1.304 | – |
| zh | studio | male | 2 | 88.6% | – | 256.3% | 256.3% | 100.0% | – | – | 0.0% | 0.0% | 50.0% | 0.350 | – |
| all | studio | male | 8 | 90.3% | 115.2% | 106.3% | 151.6% | 100.0% | – | – | 25.0% | 37.5% | 50.0% | 0.541 | mode match share 0.500 (need ≥ 0.9) |

## 20 worst round trips by phone error rate

| Set | Language | Tier | Preset | Sentence | Mode | PER | Reference text | Heard text | Reference IPA | Heard IPA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main | ru | wideband | male | 20 | – | 150.0% | Да. | Act. | da . | ˈækt. |
| main | ru | minimal | male | 20 | – | 150.0% | Да. | Kite. | da . | kˈaɪt. |
| tiers | ru | high | male | 20 | – | 150.0% | Да. | Could. | da . | kəd. |
| tiers | ru | studio | male | 20 | – | 150.0% | Да. | क् अप। | da . | k əp. |
| main | hi | narrowband | male | 20 | – | 150.0% | हाँ। | Die. | ɦãː . | dˈaɪ. |
| tiers | en | ultra | male | 20 | – | 133.3% | Yes. | Gr ft. | ˈjɛs . | ɡɹ ft. |
| main | en | wideband | male | 15 | – | 125.0% | Stop! | च गप्प। | ˈstɑp ! | t͡ʃə ɡəpp. |
| main | ru | minimal | male | 16 | – | 125.0% | Стой! | Buffet. | stoj ! | bəfˈeɪ. |
| whisper | en | narrowband | female | 9 | W | 100.0% | Are the children playing outside now? | 啊哩欸呃欸此欸无。 | {W ɚ ðə ˈt͡ʃɪldɹən ˈpleɪɪŋ ˈaʊtˈsaɪd ˈnaʊ W} ? | {W æ˨˩˦d͡ʑiˈɛ̃˥oɛ̃˨˩˦d͡ʒʰẽ˨˩˦ɛ̃ũ˨˩˦ W} . |
| whisper | hi | wideband | male | 7 | W | 100.0% | मुझे एक गिलास ठंडा पानी चाहिए। | Аэбьбьазьжвоа м и а. | {W mʊd͡ʒʱeː eːk ɡɪlaːs ʈʰəɳɖaː paːniː t͡ʃaːɦɪeː W} . | {lento {W yt͡ʃʱebʲbʲɥazʲʐvoˈa W} lento} {W m ĩd͡ʒ a W} . ⸨inhale⸩ |
| whisper | hi | wideband | female | 7 | W | 100.0% | मुझे एक गिलास ठंडा पानी चाहिए। | Оэгьгезаабе и. | {W mʊd͡ʒʱeː eːk ɡɪlaːs ʈʰəɳɖaː paːniː t͡ʃaːɦɪeː W} . | {W õt͡ʃʱẽɡʲɡʲˈɛzɖʰɤæbʲe ĩd͡ʒʰɹ W} . ⸨inhale⸩ |
| whisper | hi | minimal | female | 7 | W | 100.0% | मुझे एक गिलास ठंडा पानी चाहिए। | Оэгьгезаабе и. | {W mʊd͡ʒʱeː eːk ɡɪlaːs ʈʰəɳɖaː paːniː t͡ʃaːɦɪeː W} . | {W õt͡ʃʱẽɡʲɡʲˈɛzɖʰɤæbʲe ĩd͡ʒʰɹ W} . ⸨inhale⸩ |
| main | zh | wideband | male | 12 | – | 100.0% | 火车站离这里远不远？ | Ко с к ичйакэийаи. | xwo˨˩ ʈ͡ʂʰɤ˥ ʈ͡ʂan˥˩ li˧˥ ʈ͡ʂɤ˥˩ li˧˥ ɥɛn˨˩ pu ɥɛn˨˩˦ ? | kə s k ɪt͡ɕjəŋkwˈeɪjaɪ. |
| main | zh | minimal | male | 12 | – | 100.0% | 火车站离这里远不远？ | To for quake were мы your? | xwo˨˩ ʈ͡ʂʰɤ˥ ʈ͡ʂan˥˩ li˧˥ ʈ͡ʂɤ˥˩ li˧˥ ɥɛn˨˩ pu ɥɛn˨˩˦ ? | {yesno tə fɚ kwˈeɪk wɚ mɨ jɚ yesno} ? |
| modes | zh | high | male | 1 | W | 100.0% | 你好，你今天怎么样？ | Ифовяаивэв жаиоуа. | {W ni˧˥ xɑʊ˨˩˦ , ni˨˩ t͡ɕin˥ tʰjɛn˥ t͡sən˨˩ mɤ jɑŋ˥˩ W} ↘ ? | {W ĩʋfõvʲyyʈ͡ʂʰĩvˈẽv ʐɤiˈouə W} . |
| main | hi | narrowband | male | 13 | – | 100.0% | ढोल की आवाज़ दूर तक जाती है। | But why date i я? | ɖʱoːl kiː aːʋaːz d̪uːɾ t̪ək d͡ʒaːt̪iː ɦɛː . | {lento {V͉ {wh bət wh} V͉} lento} {wh wˈaɪ dˈeɪt ˈaɪ ja wh} ? |
| main | hi | narrowband | female | 13 | – | 100.0% | ढोल की आवाज़ दूर तक जाती है। | Die when i why 雅? | ɖʱoːl kiː aːʋaːz d̪uːɾ t̪ək d͡ʒaːt̪iː ɦɛː . | {lento {V͉ {wh dˈaɪ wh} V͉} lento} {wh wˈɛn ˈaɪ wˈaɪ ja˨˩ wh} ? |
| main | zh | telephone | female | 18 | – | 100.0% | 老师让学生写日记。 | Been i were мать a why? | lɑʊ˨˩ ʂɻ̩˥ ʐɑŋ˥˩ ɕɥɛ˧˥ ʂəŋ ɕjɛ˨˩ ʐɻ̩˥˩ t͡ɕi˥˩ . | {wh bən ˈaɪ wɚ wh} {V͉ {wh matʲ ˈeɪ wˈaɪ wh} V͉} ? |
| whisper | ru | minimal | male | 3 | W | 100.0% | Сегодня хорошая погода. | 此热日呃呃。 | {W sʲɪˈvodʲnʲə xɐˈroʂəjə pɐˈɡodə W} . | {W d͡ʒʱɔ̃˨˩˦ɣɤ˥ʐɨˈɤɤ˨˩˦ W} . |
| whisper | hi | telephone | female | 9 | W | 100.0% | तुम्हारा भाई कहाँ रहता है? | 呃欸爱啊欸啊。 | {W t̪ʊmɦaːɾaː bʱaːiː kəɦãː ɾəɦt̪aː ɦɛː W} ↘ ? | {W ɤˈɛaɪ˨˩˦aɛa˥ W} . ⸨inhale⸩ |

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

On `8a1d734`, `time -p taskset -c 4 node --test tests/roundtrip-smoke.test.js`
took 29.13 seconds of wall time and 20.26 seconds of user CPU time.
All three accuracy tests failed. English made 12 of 16 phone edits and 6
of 6 sound-word edits. Russian made 8 of 13 and 3 of 3, and Mandarin made
13 of 13 and 11 on 5 reference words. Only Russian returned the correct
top language. The nine hosted runtime jobs reproduced these edit counts.
[Checks and release](https://github.com/konard/voice-simulator/actions/runs/44942171855).

## Decoder diagnosis

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

## Telephone whisper correction

In the Russian smoke case, the detector found a span at 0.49–0.85 s. Its
high-to-low band energy ratio was −26.95 dB, which crossed the relaxed edge
threshold. The pitch tracker returned no F0 there, but 30 of 36 frames had
normalized autocorrelation of at least 0.6. The corrected detector requires
the absolute band ratio to pass for a similarly periodic telephone edge.

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

## Narrowband whisper correction

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

## Limited local benchmark

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

## Whole-sentence loudness

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
