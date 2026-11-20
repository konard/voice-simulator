# Synthetic speech round trips

Measured 2026-11-20 on benchmark commit `83bd5633e3322d80d1c0863372f751f8a42092a8`.
The [full benchmark run](https://github.com/konard/voice-simulator/actions/runs/44799632294) finished with 4 passing and 73 failing rows.

Command: `npm run test:heavy -- --suite roundtrip`.

All renders use seed 1 and select their voice preset with the seeded head generator. Recognition receives audio and the level for its tier. The reference tier is excluded because of its run time.

Edit rates divide summed edits by summed reference length. Stress covers aligned words of equal syllable count. Timing covers start and end boundaries of aligned syllables with identical IPA. A dash indicates an inapplicable metric or no matches. Recognition RTF divides total recognition time by total audio time.

Mandarin uses character error rate in place of orthographic word error, including for the whisper gate. Sound WER compares Mandarin character pronunciations in context.

The mode tests measure the share of reference spans with matching notation and at least half of their duration overlapped by a recognition span. The gate uses all four languages at each tier.

## main

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male, female | 40 | 86.4% | 98.9% | 95.0% | 99.3% | – | 33.3% | 110.6 | 27.5% | 62.5% | – | 0.193 | PER 0.864 (need ≤ 0.1)<br>sound WER 0.993 (need ≤ 0.2)<br>mean syllable time error (ms) 110.599 (need ≤ 40)<br>language match share 0.275 (need ≥ 0.9)<br>sentence mark match share 0.625 (need ≥ 0.85) |
| en | narrowband | male, female | 40 | 85.0% | 99.6% | 91.4% | 99.6% | – | 33.3% | 266.8 | 52.5% | 60.0% | – | 0.172 | PER 0.850 (need ≤ 0.08)<br>sound WER 0.996 (need ≤ 0.15)<br>mean syllable time error (ms) 266.842 (need ≤ 35)<br>language match share 0.525 (need ≥ 0.92)<br>stress hit share 0.333 (need ≥ 0.9) |
| en | wideband | male, female | 40 | 83.9% | 101.8% | 90.5% | 101.8% | – | 0.0% | 254.8 | 50.0% | 60.0% | – | 0.316 | PER 0.839 (need ≤ 0.05)<br>sound WER 1.018 (need ≤ 0.1)<br>mean syllable time error (ms) 254.836 (need ≤ 30)<br>language match share 0.500 (need ≥ 0.95)<br>stress hit share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.9) |
| en | minimal | male, female | 40 | 84.2% | 100.7% | 92.4% | 100.7% | – | 40.0% | 118.5 | 40.0% | 67.5% | – | 0.516 | PER 0.842 (need ≤ 0.05)<br>sound WER 1.007 (need ≤ 0.1)<br>mean syllable time error (ms) 118.469 (need ≤ 30)<br>language match share 0.400 (need ≥ 0.95)<br>stress hit share 0.400 (need ≥ 0.9)<br>sentence mark match share 0.675 (need ≥ 0.9) |
| ru | telephone | male, female | 40 | 84.0% | 104.0% | 94.7% | 107.5% | – | 14.3% | 52.9 | 30.0% | 55.0% | – | 0.342 | PER 0.840 (need ≤ 0.1)<br>sound WER 1.075 (need ≤ 0.2)<br>mean syllable time error (ms) 52.918 (need ≤ 40)<br>language match share 0.300 (need ≥ 0.9)<br>sentence mark match share 0.550 (need ≥ 0.85) |
| ru | narrowband | male, female | 40 | 85.4% | 106.3% | 92.5% | 108.0% | – | 28.6% | 203.2 | 42.5% | 55.0% | – | 0.361 | PER 0.854 (need ≤ 0.08)<br>sound WER 1.080 (need ≤ 0.15)<br>mean syllable time error (ms) 203.244 (need ≤ 35)<br>language match share 0.425 (need ≥ 0.92)<br>stress hit share 0.286 (need ≥ 0.9) |
| ru | wideband | male, female | 40 | 83.3% | 110.9% | 92.3% | 113.8% | – | 71.4% | 136.6 | 40.0% | 62.5% | – | 0.514 | PER 0.833 (need ≤ 0.05)<br>sound WER 1.138 (need ≤ 0.1)<br>mean syllable time error (ms) 136.596 (need ≤ 30)<br>language match share 0.400 (need ≥ 0.95)<br>stress hit share 0.714 (need ≥ 0.9)<br>sentence mark match share 0.625 (need ≥ 0.9) |
| ru | minimal | male, female | 40 | 83.7% | 118.4% | 92.8% | 121.3% | – | 16.7% | 201.9 | 35.0% | 62.5% | – | 0.826 | PER 0.837 (need ≤ 0.05)<br>sound WER 1.213 (need ≤ 0.1)<br>mean syllable time error (ms) 201.927 (need ≤ 30)<br>language match share 0.350 (need ≥ 0.95)<br>stress hit share 0.167 (need ≥ 0.9)<br>sentence mark match share 0.625 (need ≥ 0.9) |
| hi | telephone | male, female | 40 | 94.0% | 101.0% | 100.0% | 101.0% | – | – | – | 2.5% | 70.0% | – | 0.188 | PER 0.940 (need ≤ 0.1)<br>sound WER 1.010 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.025 (need ≥ 0.9)<br>sentence mark match share 0.700 (need ≥ 0.85) |
| hi | narrowband | male, female | 40 | 94.4% | 101.5% | 100.0% | 101.5% | – | – | – | 0.0% | 60.0% | – | 0.280 | PER 0.944 (need ≤ 0.08)<br>sound WER 1.015 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 35)<br>language match share 0.000 (need ≥ 0.92) |
| hi | wideband | male, female | 40 | 92.0% | 104.6% | 100.0% | 104.6% | – | – | – | 5.0% | 57.5% | – | 0.434 | PER 0.920 (need ≤ 0.05)<br>sound WER 1.046 (need ≤ 0.1)<br>mean syllable time error (ms) unavailable (need ≤ 30)<br>language match share 0.050 (need ≥ 0.95)<br>sentence mark match share 0.575 (need ≥ 0.9) |
| hi | minimal | male, female | 40 | 92.0% | 106.1% | 99.7% | 106.1% | – | – | – | 0.0% | 60.0% | – | 1.000 | PER 0.920 (need ≤ 0.05)<br>sound WER 1.061 (need ≤ 0.1)<br>mean syllable time error (ms) unavailable (need ≤ 30)<br>language match share 0.000 (need ≥ 0.95)<br>sentence mark match share 0.600 (need ≥ 0.9) |
| zh | telephone | male, female | 40 | 87.4% | – | 150.4% | 150.4% | 77.9% | – | – | 37.5% | 60.0% | – | 0.175 | PER 0.874 (need ≤ 0.1)<br>sound WER 1.504 (need ≤ 0.2)<br>tone error 0.779 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.375 (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| zh | narrowband | male, female | 40 | 86.5% | – | 152.3% | 152.3% | 82.1% | – | – | 12.5% | 60.0% | – | 0.184 | PER 0.865 (need ≤ 0.08)<br>sound WER 1.523 (need ≤ 0.15)<br>tone error 0.821 (need ≤ 0.12)<br>mean syllable time error (ms) unavailable (need ≤ 35)<br>language match share 0.125 (need ≥ 0.92) |
| zh | wideband | male, female | 40 | 88.7% | – | 180.9% | 180.9% | 85.1% | – | – | 17.5% | 67.5% | – | 0.326 | PER 0.887 (need ≤ 0.05)<br>sound WER 1.809 (need ≤ 0.1)<br>tone error 0.851 (need ≤ 0.1)<br>mean syllable time error (ms) unavailable (need ≤ 30)<br>language match share 0.175 (need ≥ 0.95)<br>sentence mark match share 0.675 (need ≥ 0.9) |
| zh | minimal | male, female | 40 | 86.7% | – | 185.9% | 185.9% | 87.0% | – | – | 20.0% | 72.5% | – | 0.622 | PER 0.867 (need ≤ 0.05)<br>sound WER 1.859 (need ≤ 0.1)<br>tone error 0.870 (need ≤ 0.1)<br>mean syllable time error (ms) unavailable (need ≤ 30)<br>language match share 0.200 (need ≥ 0.95)<br>sentence mark match share 0.725 (need ≥ 0.9) |

## voices

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | any | 5 | 85.3% | 100.0% | 97.5% | 100.0% | – | 0.0% | – | 20.0% | 20.0% | – | 0.166 | PER 0.853 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.200 (need ≥ 0.9)<br>sentence mark match share 0.200 (need ≥ 0.85) |
| en | telephone | child | 5 | 88.4% | 100.0% | 91.9% | 100.0% | – | – | – | 40.0% | 40.0% | – | 0.154 | PER 0.884 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.400 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.85) |
| en | wideband | any | 5 | 82.9% | 97.2% | 93.8% | 97.2% | – | 100.0% | 84.5 | 20.0% | 40.0% | – | 0.313 | PER 0.829 (need ≤ 0.1)<br>sound WER 0.972 (need ≤ 0.2)<br>mean syllable time error (ms) 84.462 (need ≤ 40)<br>language match share 0.200 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| en | wideband | child | 5 | 84.5% | 105.6% | 94.4% | 108.3% | – | – | – | 40.0% | 60.0% | – | 0.312 | PER 0.845 (need ≤ 0.1)<br>sound WER 1.083 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.400 (need ≥ 0.9)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.9) |
| ru | telephone | any | 5 | 85.7% | 104.5% | 98.2% | 118.2% | – | 0.0% | – | 0.0% | 20.0% | – | 0.742 | PER 0.857 (need ≤ 0.1)<br>sound WER 1.182 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.200 (need ≥ 0.85) |
| ru | telephone | child | 5 | 85.7% | 113.6% | 98.2% | 131.8% | – | – | – | 0.0% | 60.0% | – | 0.742 | PER 0.857 (need ≤ 0.1)<br>sound WER 1.318 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| ru | wideband | any | 5 | 83.9% | 127.3% | 85.3% | 127.3% | – | – | – | 80.0% | 40.0% | – | 0.942 | PER 0.839 (need ≤ 0.1)<br>sound WER 1.273 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.800 (need ≥ 0.9)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| ru | wideband | child | 5 | 83.9% | 127.3% | 94.5% | 136.4% | – | 0.0% | 10.2 | 40.0% | 40.0% | – | 0.326 | PER 0.839 (need ≤ 0.1)<br>sound WER 1.364 (need ≤ 0.2)<br>language match share 0.400 (need ≥ 0.9)<br>stress hit share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| hi | telephone | any | 5 | 96.3% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 60.0% | – | 0.182 | PER 0.963 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.600 (need ≥ 0.85) |
| hi | telephone | child | 5 | 92.6% | 104.2% | 100.0% | 108.3% | – | – | – | 0.0% | 40.0% | – | 0.186 | PER 0.926 (need ≤ 0.1)<br>sound WER 1.083 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.85) |
| hi | wideband | any | 5 | 93.8% | 104.2% | 98.7% | 104.2% | – | – | – | 0.0% | 80.0% | – | 0.307 | PER 0.938 (need ≤ 0.1)<br>sound WER 1.042 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.800 (need ≥ 0.9) |
| hi | wideband | child | 5 | 91.4% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 40.0% | – | 0.334 | PER 0.914 (need ≤ 0.1)<br>sound WER 1.000 (need ≤ 0.2)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |
| zh | telephone | any | 5 | 88.8% | – | 175.8% | 175.8% | 87.9% | – | – | 20.0% | 20.0% | – | 0.171 | PER 0.888 (need ≤ 0.1)<br>sound WER 1.758 (need ≤ 0.2)<br>tone error 0.879 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.200 (need ≥ 0.9)<br>sentence mark match share 0.200 (need ≥ 0.85) |
| zh | telephone | child | 5 | 87.6% | – | 142.4% | 142.4% | 69.7% | – | – | 60.0% | 40.0% | – | 0.167 | PER 0.876 (need ≤ 0.1)<br>sound WER 1.424 (need ≤ 0.2)<br>tone error 0.697 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.600 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.85) |
| zh | wideband | any | 5 | 86.5% | – | 203.0% | 203.0% | 90.9% | – | – | 0.0% | 20.0% | – | 0.333 | PER 0.865 (need ≤ 0.1)<br>sound WER 2.030 (need ≤ 0.2)<br>tone error 0.909 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.000 (need ≥ 0.9)<br>sentence mark match share 0.200 (need ≥ 0.9) |
| zh | wideband | child | 5 | 85.4% | – | 206.1% | 206.1% | 87.9% | – | – | 20.0% | 40.0% | – | 0.316 | PER 0.854 (need ≤ 0.1)<br>sound WER 2.061 (need ≤ 0.2)<br>tone error 0.879 (need ≤ 0.15)<br>mean syllable time error (ms) unavailable (need ≤ 40)<br>language match share 0.200 (need ≥ 0.9)<br>sentence mark match share 0.400 (need ≥ 0.9) |

## tiers

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | low | male | 2 | 84.0% | 111.1% | 90.9% | 111.1% | – | – | – | 0.0% | 100.0% | – | 0.354 | PER 0.840 (need ≤ 0.1) |
| en | medium | male | 2 | 88.0% | 100.0% | 100.0% | 100.0% | – | – | – | 50.0% | 100.0% | – | 0.567 | PER 0.880 (need ≤ 0.1) |
| en | high | male | 2 | 92.0% | 100.0% | 103.0% | 100.0% | – | – | – | 50.0% | 100.0% | – | 0.631 | PER 0.920 (need ≤ 0.1) |
| en | ultra | male | 2 | 96.0% | 111.1% | 103.0% | 111.1% | – | – | – | 50.0% | 100.0% | – | 0.673 | PER 0.960 (need ≤ 0.1) |
| en | studio | male | 2 | 80.0% | 111.1% | 103.0% | 111.1% | – | – | – | 0.0% | 100.0% | – | 0.693 | PER 0.800 (need ≤ 0.1) |
| ru | low | male | 2 | 73.3% | 125.0% | 100.0% | 125.0% | – | – | – | 50.0% | 0.0% | – | 3.148 | PER 0.733 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.000 (need ≥ 0.9) |
| ru | medium | male | 2 | 86.7% | 175.0% | 106.7% | 175.0% | – | – | – | 0.0% | 50.0% | – | 3.379 | PER 0.867 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| ru | high | male | 2 | 100.0% | 100.0% | 106.7% | 100.0% | – | – | – | 50.0% | 100.0% | – | 3.765 | PER 1.000 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9) |
| ru | ultra | male | 2 | 100.0% | 125.0% | 100.0% | 150.0% | – | – | – | 50.0% | 50.0% | – | 3.609 | PER 1.000 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| ru | studio | male | 2 | 93.3% | 125.0% | 93.3% | 125.0% | – | – | – | 50.0% | 100.0% | – | 3.372 | PER 0.933 (need ≤ 0.1)<br>stress hit share unavailable (need ≥ 0.9) |
| hi | low | male | 2 | 92.9% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 100.0% | – | 0.400 | PER 0.929 (need ≤ 0.1) |
| hi | medium | male | 2 | 92.9% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 50.0% | – | 1.635 | PER 0.929 (need ≤ 0.1)<br>sentence mark match share 0.500 (need ≥ 0.9) |
| hi | high | male | 2 | 100.0% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 100.0% | – | 1.692 | PER 1.000 (need ≤ 0.1) |
| hi | ultra | male | 2 | 92.9% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 100.0% | – | 1.688 | PER 0.929 (need ≤ 0.1) |
| hi | studio | male | 2 | 92.9% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 100.0% | – | 1.635 | PER 0.929 (need ≤ 0.1) |
| zh | low | male | 2 | 100.0% | – | 216.7% | 216.7% | 116.7% | – | – | 0.0% | 100.0% | – | 0.368 | PER 1.000 (need ≤ 0.1) |
| zh | medium | male | 2 | 88.2% | – | 133.3% | 133.3% | 100.0% | – | – | 50.0% | 100.0% | – | 2.071 | PER 0.882 (need ≤ 0.1) |
| zh | high | male | 2 | 94.1% | – | 183.3% | 183.3% | 100.0% | – | – | 50.0% | 100.0% | – | 2.260 | PER 0.941 (need ≤ 0.1) |
| zh | ultra | male | 2 | 88.2% | – | 183.3% | 183.3% | 116.7% | – | – | 50.0% | 100.0% | – | 2.129 | PER 0.882 (need ≤ 0.1) |
| zh | studio | male | 2 | 94.1% | – | 283.3% | 283.3% | 100.0% | – | – | 0.0% | 50.0% | – | 2.095 | PER 0.941 (need ≤ 0.1)<br>sentence mark match share 0.500 (need ≥ 0.9) |

## whisper

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male, female | 20 | 88.4% | 104.4% | 96.0% | 107.0% | – | – | 166.4 | 25.0% | 60.0% | 65.0% | 0.227 | PER 0.884 (need ≤ 0.25)<br>WER 1.044 (need ≤ 0.35) |
| en | narrowband | male, female | 20 | 84.3% | 101.3% | 89.6% | 102.5% | – | – | 26.9 | 40.0% | 60.0% | 80.0% | 0.152 | Pass |
| en | wideband | male, female | 20 | 83.0% | 105.1% | 90.4% | 105.7% | – | 100.0% | 28.1 | 35.0% | 60.0% | 80.0% | 0.538 | PER 0.830 (need ≤ 0.15)<br>WER 1.051 (need ≤ 0.25) |
| en | minimal | male, female | 20 | 81.8% | 99.4% | 86.2% | 99.4% | – | – | 25.8 | 45.0% | 60.0% | 90.0% | 0.452 | PER 0.818 (need ≤ 0.15)<br>WER 0.994 (need ≤ 0.25) |
| ru | telephone | male, female | 20 | 82.6% | 112.5% | 83.3% | 115.9% | – | – | 34.9 | 75.0% | 60.0% | 80.0% | 0.127 | PER 0.826 (need ≤ 0.25)<br>WER 1.125 (need ≤ 0.35) |
| ru | narrowband | male, female | 20 | 86.8% | 101.1% | 88.4% | 103.4% | – | – | 42.6 | 60.0% | 60.0% | 90.0% | 0.145 | Pass |
| ru | wideband | male, female | 20 | 86.1% | 112.5% | 82.8% | 115.9% | – | – | – | 90.0% | 60.0% | 70.0% | 0.244 | PER 0.861 (need ≤ 0.15)<br>WER 1.125 (need ≤ 0.25) |
| ru | minimal | male, female | 20 | 85.2% | 117.0% | 84.2% | 119.3% | – | – | 12.7 | 90.0% | 60.0% | 70.0% | 0.481 | PER 0.852 (need ≤ 0.15)<br>WER 1.170 (need ≤ 0.25) |
| hi | telephone | male, female | 20 | 94.1% | 104.0% | 99.7% | 111.0% | – | – | – | 5.0% | 60.0% | 95.0% | 0.163 | PER 0.941 (need ≤ 0.25)<br>WER 1.040 (need ≤ 0.35) |
| hi | narrowband | male, female | 20 | 96.3% | 102.0% | 100.0% | 103.0% | – | – | – | 0.0% | 60.0% | 100.0% | 0.145 | Pass |
| hi | wideband | male, female | 20 | 95.2% | 103.0% | 100.0% | 106.0% | – | – | – | 0.0% | 60.0% | 95.0% | 0.271 | PER 0.952 (need ≤ 0.15)<br>WER 1.030 (need ≤ 0.25) |
| hi | minimal | male, female | 20 | 96.1% | 113.0% | 99.1% | 115.0% | – | – | – | 5.0% | 60.0% | 90.0% | 0.352 | PER 0.961 (need ≤ 0.15)<br>WER 1.130 (need ≤ 0.25) |
| zh | telephone | male, female | 20 | 87.2% | – | 146.9% | 147.7% | 101.6% | – | – | 55.0% | 50.0% | 85.0% | 0.416 | PER 0.872 (need ≤ 0.25)<br>CER 1.469 (need ≤ 0.35)<br>tone error 1.016 (need ≤ 0.3) |
| zh | narrowband | male, female | 20 | 85.4% | – | 147.7% | 149.2% | 90.6% | – | – | 35.0% | 45.0% | 90.0% | 0.158 | tone error 0.906 (need ≤ 0.25) |
| zh | wideband | male, female | 20 | 86.9% | – | 149.2% | 149.2% | 89.8% | – | 22.3 | 30.0% | 45.0% | 95.0% | 0.606 | PER 0.869 (need ≤ 0.15)<br>CER 1.492 (need ≤ 0.25)<br>tone error 0.898 (need ≤ 0.25) |
| zh | minimal | male, female | 20 | 87.8% | – | 141.4% | 141.4% | 89.1% | – | 12.7 | 40.0% | 45.0% | 95.0% | 0.618 | PER 0.878 (need ≤ 0.15)<br>CER 1.414 (need ≤ 0.25)<br>tone error 0.891 (need ≤ 0.25) |

## modes

| Language | Tier | Presets | Cases | PER | WER | CER | Sound WER | Tone error | Stress hits | Time (ms) | Language right | Mark right | Mode hits | RTF | Gates |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en | telephone | male | 2 | 89.7% | 100.0% | 98.6% | 105.6% | – | 0.0% | – | 0.0% | 100.0% | 50.0% | 1.032 | – |
| ru | telephone | male | 2 | 80.9% | 100.0% | 81.5% | 100.0% | – | – | – | 100.0% | 50.0% | 0.0% | 0.132 | – |
| hi | telephone | male | 2 | 100.0% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 0.0% | 50.0% | 0.149 | – |
| zh | telephone | male | 2 | 88.6% | – | 181.3% | 181.3% | 106.3% | – | – | 50.0% | 0.0% | 50.0% | 0.151 | – |
| all | telephone | male | 8 | 87.3% | 100.0% | 97.6% | 122.6% | 106.3% | 0.0% | – | 37.5% | 37.5% | 37.5% | 0.374 | mode match share 0.375 (need ≥ 0.75) |
| en | narrowband | male | 2 | 89.7% | 100.0% | 92.9% | 100.0% | – | – | – | 50.0% | 50.0% | 0.0% | 0.144 | – |
| ru | narrowband | male | 2 | 83.0% | 100.0% | 90.2% | 100.0% | – | – | – | 50.0% | 100.0% | 0.0% | 0.145 | – |
| hi | narrowband | male | 2 | 96.7% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 0.0% | 50.0% | 0.158 | – |
| zh | narrowband | male | 2 | 88.6% | – | 181.3% | 187.5% | 93.8% | – | – | 50.0% | 0.0% | 50.0% | 0.159 | – |
| all | narrowband | male | 8 | 87.7% | 100.0% | 99.5% | 122.6% | 93.8% | – | – | 37.5% | 37.5% | 25.0% | 0.150 | – |
| en | wideband | male | 2 | 83.8% | 100.0% | 94.3% | 100.0% | – | – | – | 50.0% | 50.0% | 50.0% | 1.238 | – |
| ru | wideband | male | 2 | 85.1% | 100.0% | 85.9% | 100.0% | – | – | – | 100.0% | 50.0% | 50.0% | 0.267 | – |
| hi | wideband | male | 2 | 90.0% | 100.0% | 93.3% | 125.0% | – | – | – | 50.0% | 0.0% | 50.0% | 0.288 | – |
| zh | wideband | male | 2 | 84.1% | – | 218.8% | 218.8% | 93.8% | – | – | 0.0% | 50.0% | 50.0% | 1.832 | – |
| all | wideband | male | 8 | 85.2% | 100.0% | 100.0% | 133.9% | 93.8% | – | – | 50.0% | 37.5% | 50.0% | 0.892 | mode match share 0.500 (need ≥ 0.9) |
| en | minimal | male | 2 | 79.4% | 100.0% | 94.3% | 100.0% | – | – | 42.3 | 50.0% | 50.0% | 50.0% | 0.308 | – |
| ru | minimal | male | 2 | 79.8% | 115.0% | 87.0% | 115.0% | – | – | – | 50.0% | 100.0% | 50.0% | 0.334 | – |
| hi | minimal | male | 2 | 90.0% | 112.5% | 100.0% | 137.5% | – | – | – | 0.0% | 0.0% | 50.0% | 1.020 | – |
| zh | minimal | male | 2 | 90.9% | – | 225.0% | 225.0% | 100.0% | – | – | 0.0% | 0.0% | 50.0% | 1.881 | – |
| all | minimal | male | 8 | 83.1% | 108.7% | 101.9% | 141.9% | 100.0% | – | 42.3 | 25.0% | 37.5% | 50.0% | 0.802 | mode match share 0.500 (need ≥ 0.9) |
| en | low | male | 2 | 76.5% | 94.4% | 95.7% | 94.4% | – | – | 29.8 | 0.0% | 100.0% | 50.0% | 0.476 | – |
| ru | low | male | 2 | 80.9% | 100.0% | 85.9% | 100.0% | – | 100.0% | – | 50.0% | 50.0% | 50.0% | 0.313 | – |
| hi | low | male | 2 | 93.3% | 125.0% | 100.0% | 125.0% | – | – | – | 0.0% | 0.0% | 50.0% | 0.308 | – |
| zh | low | male | 2 | 81.8% | – | 193.8% | 193.8% | 93.8% | – | – | 0.0% | 0.0% | 50.0% | 0.340 | – |
| all | low | male | 8 | 81.4% | 102.2% | 99.5% | 125.8% | 93.8% | 100.0% | 29.8 | 12.5% | 37.5% | 50.0% | 0.361 | mode match share 0.500 (need ≥ 0.9) |
| en | medium | male | 2 | 83.8% | 100.0% | 88.6% | 100.0% | – | – | – | 100.0% | 50.0% | 50.0% | 0.670 | – |
| ru | medium | male | 2 | 79.8% | 100.0% | 82.6% | 100.0% | – | – | – | 100.0% | 50.0% | 50.0% | 0.515 | – |
| hi | medium | male | 2 | 100.0% | 125.0% | 100.0% | 125.0% | – | – | – | 0.0% | 50.0% | 50.0% | 1.132 | – |
| zh | medium | male | 2 | 93.2% | – | 193.8% | 193.8% | 87.5% | – | – | 0.0% | 0.0% | 50.0% | 2.342 | – |
| all | medium | male | 8 | 86.0% | 104.3% | 95.7% | 127.4% | 87.5% | – | – | 50.0% | 37.5% | 50.0% | 1.085 | mode match share 0.500 (need ≥ 0.9) |
| en | high | male | 2 | 88.2% | 111.1% | 92.9% | 111.1% | – | – | – | 50.0% | 100.0% | 50.0% | 0.667 | – |
| ru | high | male | 2 | 91.5% | 100.0% | 90.2% | 100.0% | – | – | – | 50.0% | 100.0% | 50.0% | 0.624 | – |
| hi | high | male | 2 | 96.7% | 100.0% | 100.0% | 100.0% | – | – | – | 0.0% | 0.0% | 50.0% | 1.151 | – |
| zh | high | male | 2 | 93.2% | – | 243.8% | 243.8% | 100.0% | – | – | 0.0% | 50.0% | 50.0% | 0.452 | – |
| all | high | male | 8 | 91.5% | 104.3% | 104.3% | 140.3% | 100.0% | – | – | 25.0% | 62.5% | 50.0% | 0.680 | mode match share 0.500 (need ≥ 0.9) |
| en | ultra | male | 2 | 88.2% | 105.6% | 90.0% | 105.6% | – | – | – | 50.0% | 50.0% | 50.0% | 0.694 | – |
| ru | ultra | male | 2 | 89.4% | 115.0% | 87.0% | 115.0% | – | 0.0% | – | 100.0% | 100.0% | 50.0% | 0.661 | – |
| hi | ultra | male | 2 | 86.7% | 125.0% | 100.0% | 125.0% | – | – | – | 0.0% | 50.0% | 50.0% | 1.138 | – |
| zh | ultra | male | 2 | 84.1% | – | 268.8% | 268.8% | 100.0% | – | – | 0.0% | 0.0% | 50.0% | 0.502 | – |
| all | ultra | male | 8 | 87.7% | 113.0% | 103.8% | 153.2% | 100.0% | 0.0% | – | 37.5% | 50.0% | 50.0% | 0.710 | mode match share 0.500 (need ≥ 0.9) |
| en | studio | male | 2 | 88.2% | 105.6% | 92.9% | 105.6% | – | – | – | 50.0% | 50.0% | 50.0% | 0.667 | – |
| ru | studio | male | 2 | 89.4% | 120.0% | 91.3% | 120.0% | – | – | – | 50.0% | 100.0% | 50.0% | 0.596 | – |
| hi | studio | male | 2 | 100.0% | 125.0% | 103.3% | 125.0% | – | – | – | 0.0% | 0.0% | 50.0% | 1.133 | – |
| zh | studio | male | 2 | 88.6% | – | 256.3% | 256.3% | 100.0% | – | – | 0.0% | 0.0% | 50.0% | 0.486 | – |
| all | studio | male | 8 | 90.3% | 115.2% | 106.3% | 151.6% | 100.0% | – | – | 25.0% | 37.5% | 50.0% | 0.676 | mode match share 0.500 (need ≥ 0.9) |

## 20 worst round trips by phone error rate

| Set | Language | Tier | Preset | Sentence | PER | Reference text | Heard text | Reference IPA | Heard IPA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main | ru | wideband | male | 20 | 150.0% | Да. | Act. | da . | ˈækt. |
| main | ru | minimal | male | 20 | 150.0% | Да. | Kite. | da . | kˈaɪt. |
| tiers | ru | high | male | 20 | 150.0% | Да. | Could. | da . | kəd. |
| tiers | ru | studio | male | 20 | 150.0% | Да. | क् अप। | da . | k əp. |
| main | hi | narrowband | male | 20 | 150.0% | हाँ। | Die. | ɦãː . | dˈaɪ. |
| tiers | en | ultra | male | 20 | 133.3% | Yes. | Gr ft. | ˈjɛs . | ɡɹ ft. |
| main | en | wideband | male | 15 | 125.0% | Stop! | च गप्प। | ˈstɑp ! | t͡ʃə ɡəpp. |
| main | ru | minimal | male | 16 | 125.0% | Стой! | Buffet. | stoj ! | bəfˈeɪ. |
| whisper | en | narrowband | female | 9 | 100.0% | Are the children playing outside now? | 啊哩欸呃欸此欸无。 | {W ɚ ðə ˈt͡ʃɪldɹən ˈpleɪɪŋ ˈaʊtˈsaɪd ˈnaʊ W} ? | {W æ˨˩˦d͡ʑiˈɛ̃˥oɛ̃˨˩˦d͡ʒʰẽ˨˩˦ɛ̃ũ˨˩˦ W} . |
| whisper | hi | wideband | male | 7 | 100.0% | मुझे एक गिलास ठंडा पानी चाहिए। | Аэбьбьазьжвоа м и а. | {W mʊd͡ʒʱeː eːk ɡɪlaːs ʈʰəɳɖaː paːniː t͡ʃaːɦɪeː W} . | {lento {W yt͡ʃʱebʲbʲɥazʲʐvoˈa W} lento} {W m ĩd͡ʒ a W} . ⸨inhale⸩ |
| whisper | hi | wideband | female | 7 | 100.0% | मुझे एक गिलास ठंडा पानी चाहिए। | Оэгьгезаабе и. | {W mʊd͡ʒʱeː eːk ɡɪlaːs ʈʰəɳɖaː paːniː t͡ʃaːɦɪeː W} . | {W õt͡ʃʱẽɡʲɡʲˈɛzɖʰɤæbʲe ĩd͡ʒʰɹ W} . ⸨inhale⸩ |
| whisper | hi | minimal | female | 7 | 100.0% | मुझे एक गिलास ठंडा पानी चाहिए। | Оэгьгезаабе и. | {W mʊd͡ʒʱeː eːk ɡɪlaːs ʈʰəɳɖaː paːniː t͡ʃaːɦɪeː W} . | {W õt͡ʃʱẽɡʲɡʲˈɛzɖʰɤæbʲe ĩd͡ʒʰɹ W} . ⸨inhale⸩ |
| main | zh | wideband | male | 12 | 100.0% | 火车站离这里远不远？ | Ко с к ичйакэийаи. | xwo˨˩ ʈ͡ʂʰɤ˥ ʈ͡ʂan˥˩ li˧˥ ʈ͡ʂɤ˥˩ li˧˥ ɥɛn˨˩ pu ɥɛn˨˩˦ ? | kə s k ɪt͡ɕjəŋkwˈeɪjaɪ. |
| main | zh | minimal | male | 12 | 100.0% | 火车站离这里远不远？ | To for quake were мы your? | xwo˨˩ ʈ͡ʂʰɤ˥ ʈ͡ʂan˥˩ li˧˥ ʈ͡ʂɤ˥˩ li˧˥ ɥɛn˨˩ pu ɥɛn˨˩˦ ? | {yesno tə fɚ kwˈeɪk wɚ mɨ jɚ yesno} ? |
| modes | zh | high | male | 1 | 100.0% | 你好，你今天怎么样？ | Ифовяаивэв жаиоуа. | {W ni˧˥ xɑʊ˨˩˦ , ni˨˩ t͡ɕin˥ tʰjɛn˥ t͡sən˨˩ mɤ jɑŋ˥˩ W} ↘ ? | {W ĩʋfõvʲyyʈ͡ʂʰĩvˈẽv ʐɤiˈouə W} . |
| main | hi | narrowband | male | 13 | 100.0% | ढोल की आवाज़ दूर तक जाती है। | But why date i я? | ɖʱoːl kiː aːʋaːz d̪uːɾ t̪ək d͡ʒaːt̪iː ɦɛː . | {lento {V͉ {wh bət wh} V͉} lento} {wh wˈaɪ dˈeɪt ˈaɪ ja wh} ? |
| main | hi | narrowband | female | 13 | 100.0% | ढोल की आवाज़ दूर तक जाती है। | Die when i why 雅? | ɖʱoːl kiː aːʋaːz d̪uːɾ t̪ək d͡ʒaːt̪iː ɦɛː . | {lento {V͉ {wh dˈaɪ wh} V͉} lento} {wh wˈɛn ˈaɪ wˈaɪ ja˨˩ wh} ? |
| main | zh | telephone | female | 18 | 100.0% | 老师让学生写日记。 | Been i were мать a why? | lɑʊ˨˩ ʂɻ̩˥ ʐɑŋ˥˩ ɕɥɛ˧˥ ʂəŋ ɕjɛ˨˩ ʐɻ̩˥˩ t͡ɕi˥˩ . | {wh bən ˈaɪ wɚ wh} {V͉ {wh matʲ ˈeɪ wˈaɪ wh} V͉} ? |
| whisper | ru | minimal | male | 3 | 100.0% | Сегодня хорошая погода. | 此热日呃呃。 | {W sʲɪˈvodʲnʲə xɐˈroʂəjə pɐˈɡodə W} . | {W d͡ʒʱɔ̃˨˩˦ɣɤ˥ʐɨˈɤɤ˨˩˦ W} . |
| whisper | hi | telephone | female | 9 | 100.0% | तुम्हारा भाई कहाँ रहता है? | 呃欸爱啊欸啊。 | {W t̪ʊmɦaːɾaː bʱaːiː kəɦãː ɾəɦt̪aː ɦɛː W} ↘ ? | {W ɤˈɛaɪ˨˩˦aɛa˥ W} . ⸨inhale⸩ |

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
