# Golden-set articulation render-back

Each head is fitted on all available utterances by that speaker without a transcript, using pass 1 without its optional refinement. Inversion uses a 5,000-row codebook. The distortion uses the original and rendered signals on the same time grid.

| Utterance | Language | Speaker | Reviewed | MCD (dB) |
| --- | --- | --- | --- | ---: |
| ru-01 | ru | librivox-1593 | pending | 59.000 |
| ru-02 | ru | librivox-1593 | pending | 55.949 |
| ru-03 | ru | librivox-1593 | pending | 60.745 |
| en-05 | en | librivox-19 | pending | 56.015 |
| hi-01 | hi | librivox-19651 | pending | 58.430 |
| hi-02 | hi | librivox-19651 | pending | 56.185 |
| hi-03 | hi | librivox-19651 | pending | 56.503 |
| hi-04 | hi | librivox-19651 | pending | 52.977 |
| hi-05 | hi | librivox-19651 | pending | 51.468 |
| hi-06 | hi | librivox-19651 | pending | 57.600 |
| en-02 | en | librivox-201 | pending | 69.859 |
| en-01 | en | librivox-215 | pending | 60.613 |
| zh-01 | zh | librivox-2245 | pending | 70.632 |
| zh-02 | zh | librivox-2245 | pending | 63.483 |
| zh-03 | zh | librivox-2245 | pending | 67.932 |
| zh-04 | zh | librivox-2245 | pending | 66.858 |
| zh-05 | zh | librivox-2245 | pending | 66.056 |
| zh-06 | zh | librivox-2245 | pending | 66.442 |
| en-03 | en | librivox-246 | pending | 68.732 |
| en-04 | en | librivox-246 | pending | 62.225 |
| ru-04 | ru | librivox-2826 | pending | 67.888 |
| en-06 | en | librivox-30 | pending | 68.474 |
| ru-05 | ru | librivox-3056 | pending | 68.253 |
| ru-06 | ru | librivox-3056 | pending | 65.239 |

Mean **62.398 dB** across 24 utterances. Research target 9 dB.

Reproduce with `node --test tests/heavy/recognition-inversion.test.js`.
