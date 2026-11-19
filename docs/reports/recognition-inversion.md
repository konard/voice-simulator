# Golden-set articulation render-back

Each head is fitted on all available utterances by that speaker without a transcript, using pass 1 without its optional refinement. Inversion uses a 5,000-row codebook. The distortion uses the original and rendered signals on the same time grid.

| Utterance | Language | Speaker | Reviewed | MCD (dB) |
| --- | --- | --- | --- | ---: |
| ru-01 | ru | librivox-1593 | pending | 57.085 |
| ru-02 | ru | librivox-1593 | pending | 53.036 |
| ru-03 | ru | librivox-1593 | pending | 58.327 |
| en-05 | en | librivox-19 | pending | 55.924 |
| hi-01 | hi | librivox-19651 | pending | 54.649 |
| hi-02 | hi | librivox-19651 | pending | 54.726 |
| hi-03 | hi | librivox-19651 | pending | 54.676 |
| hi-04 | hi | librivox-19651 | pending | 51.195 |
| hi-05 | hi | librivox-19651 | pending | 51.702 |
| hi-06 | hi | librivox-19651 | pending | 53.715 |
| en-02 | en | librivox-201 | pending | 69.326 |
| en-01 | en | librivox-215 | pending | 57.730 |
| zh-01 | zh | librivox-2245 | pending | 70.607 |
| zh-02 | zh | librivox-2245 | pending | 62.736 |
| zh-03 | zh | librivox-2245 | pending | 68.517 |
| zh-04 | zh | librivox-2245 | pending | 64.949 |
| zh-05 | zh | librivox-2245 | pending | 63.817 |
| zh-06 | zh | librivox-2245 | pending | 64.598 |
| en-03 | en | librivox-246 | pending | 67.995 |
| en-04 | en | librivox-246 | pending | 61.252 |
| ru-04 | ru | librivox-2826 | pending | 65.917 |
| en-06 | en | librivox-30 | pending | 66.930 |
| ru-05 | ru | librivox-3056 | pending | 65.487 |
| ru-06 | ru | librivox-3056 | pending | 63.071 |

Mean **60.749 dB** across 24 utterances. Research target 9 dB.

Reproduce with `node --test tests/heavy/recognition-inversion.test.js`.
