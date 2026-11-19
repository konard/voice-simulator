# Golden-set articulation render-back

Each head is fitted on all available utterances by that speaker without a transcript, using pass 1 without its optional refinement. Inversion uses a 5,000-row codebook. The distortion uses the original and rendered signals on the same time grid.

The research target is 9 dB ([issue 150](https://github.com/konard/voice-simulator/issues/150)). *Gap* is the MCD minus the target. *Constant* is the MCD of the recording from its own mean cepstrum (`constantCepstrumDistortion`): the score of a render whose spectrum never changes but has the mean shape of the recording. A render-back above it has not followed the spectral changes of the recording.

| Utterance | Language | Speaker | Reviewed | MCD (dB) | Gap (dB) | Constant (dB) |
| --- | --- | --- | --- | ---: | ---: | ---: |
| ru-01 | ru | librivox-1593 | pending | 57.085 | 48.085 | 60.195 |
| ru-02 | ru | librivox-1593 | pending | 53.036 | 44.036 | 59.200 |
| ru-03 | ru | librivox-1593 | pending | 58.327 | 49.327 | 55.488 |
| en-05 | en | librivox-19 | pending | 55.924 | 46.924 | 53.228 |
| hi-01 | hi | librivox-19651 | pending | 54.649 | 45.649 | 57.581 |
| hi-02 | hi | librivox-19651 | pending | 54.726 | 45.726 | 59.570 |
| hi-03 | hi | librivox-19651 | pending | 54.676 | 45.676 | 51.395 |
| hi-04 | hi | librivox-19651 | pending | 51.195 | 42.195 | 52.900 |
| hi-05 | hi | librivox-19651 | pending | 51.702 | 42.702 | 52.712 |
| hi-06 | hi | librivox-19651 | pending | 53.715 | 44.715 | 61.223 |
| en-02 | en | librivox-201 | pending | 69.326 | 60.326 | 66.504 |
| en-01 | en | librivox-215 | pending | 57.730 | 48.730 | 59.637 |
| zh-01 | zh | librivox-2245 | pending | 70.607 | 61.607 | 70.424 |
| zh-02 | zh | librivox-2245 | pending | 62.736 | 53.736 | 68.090 |
| zh-03 | zh | librivox-2245 | pending | 68.517 | 59.517 | 62.831 |
| zh-04 | zh | librivox-2245 | pending | 64.949 | 55.949 | 66.539 |
| zh-05 | zh | librivox-2245 | pending | 63.817 | 54.817 | 64.898 |
| zh-06 | zh | librivox-2245 | pending | 64.598 | 55.598 | 66.360 |
| en-03 | en | librivox-246 | pending | 67.995 | 58.995 | 64.059 |
| en-04 | en | librivox-246 | pending | 61.252 | 52.252 | 55.507 |
| ru-04 | ru | librivox-2826 | pending | 65.917 | 56.917 | 66.053 |
| en-06 | en | librivox-30 | pending | 66.930 | 57.930 | 62.461 |
| ru-05 | ru | librivox-3056 | pending | 65.487 | 56.487 | 66.701 |
| ru-06 | ru | librivox-3056 | pending | 63.071 | 54.071 | 61.425 |

Mean **60.749 dB** across 24 utterances: 51.749 dB above the 9 dB research target, 0 of 24 utterances at or below it. The constant-spectrum reference averages 61.041 dB; 14 of 24 render-backs are below their reference.

This cepstrum is the orthonormal DCT of the natural logarithm of 26 mel filter powers. Its coefficients are about 2 sqrt(2 × 26) ≈ 14 times the cepstral coefficients of the log amplitude spectrum that conventional mel-cepstral distortion uses. A ±3 dB linear spectral tilt measures 11.3 dB here and 0.87 dB conventionally (`node experiments/issue-150-metric-scale.mjs`). See [the issue 150 case study](https://github.com/konard/voice-simulator/blob/main/docs/case-studies/issue-150/README.md).

Reproduce with `node --test tests/heavy/recognition-inversion.test.js`.
