## Formant tracker on the golden set (issue 60)

`trackFormants` (tract length estimated, f0 of `trackPitch`) on the
golden recordings of tests/fixtures/golden/, over the voiced speech
frames (speech in the frame set, f0 above 0). Valid: F1, F2 and F3
all valid (target 95.0 %). F2 jumps: steps between
adjacent voiced frames with F2 valid on both sides where F2 moves by
more than 300 Hz (target below 2.0 %).
Targets to be measured, not gates. Command:
`npm run test:heavy -- --suite recognition`.

| Language | Utterances | Voiced frames | Valid | F2 steps | F2 jumps |
| -------- | ---------- | ------------- | ----- | -------- | -------- |
| en | 6 | 2332 | 99.2 % | 2264 | 0.1 % |
| ru | 6 | 2337 | 100.0 % | 2276 | 0.1 % |
| hi | 6 | 2821 | 99.8 % | 2747 | 0.4 % |
| zh | 6 | 2780 | 99.6 % | 2698 | 0.9 % |
| all | 24 | 10270 | 99.6 % | 9985 | 0.4 % |

Valid target met: yes.
F2 jump target met: yes.

| Utterance | Rate (Hz) | Tract length (cm) | Voiced frames | Valid | F2 jumps |
| --------- | --------- | ----------------- | ------------- | ----- | -------- |
| en-01 | 16000 | 14.43 | 249 | 99.6 % | 0.0 % |
| en-02 | 16000 | 16.73 | 495 | 97.0 % | 0.0 % |
| en-03 | 16000 | 13.29 | 380 | 100.0 % | 0.5 % |
| en-04 | 16000 | 14.47 | 373 | 99.2 % | 0.0 % |
| en-05 | 16000 | 14.84 | 465 | 100.0 % | 0.0 % |
| en-06 | 16000 | 14.51 | 370 | 100.0 % | 0.0 % |
| ru-01 | 16000 | 14.34 | 289 | 100.0 % | 0.0 % |
| ru-02 | 16000 | 13.54 | 463 | 99.8 % | 0.0 % |
| ru-03 | 16000 | 15.97 | 222 | 100.0 % | 0.5 % |
| ru-04 | 16000 | 17.3 | 449 | 100.0 % | 0.2 % |
| ru-05 | 16000 | 13.18 | 310 | 100.0 % | 0.0 % |
| ru-06 | 16000 | 13.24 | 604 | 100.0 % | 0.2 % |
| hi-01 | 16000 | 12.99 | 689 | 99.6 % | 1.2 % |
| hi-02 | 16000 | 13.65 | 452 | 100.0 % | 0.5 % |
| hi-03 | 16000 | 14.33 | 524 | 100.0 % | 0.0 % |
| hi-04 | 16000 | 14.06 | 426 | 99.8 % | 0.0 % |
| hi-05 | 16000 | 12.94 | 361 | 100.0 % | 0.0 % |
| hi-06 | 16000 | 12.37 | 369 | 99.5 % | 0.3 % |
| zh-01 | 16000 | 13.27 | 443 | 99.1 % | 0.5 % |
| zh-02 | 16000 | 13.28 | 473 | 99.8 % | 2.2 % |
| zh-03 | 16000 | 14.16 | 455 | 100.0 % | 0.0 % |
| zh-04 | 16000 | 14.01 | 471 | 100.0 % | 0.2 % |
| zh-05 | 16000 | 14.72 | 486 | 99.4 % | 0.2 % |
| zh-06 | 16000 | 14.23 | 452 | 99.1 % | 2.1 % |

The golden set has no formant reference, so the error per formant is
not measured. The [VTR Formants Database](https://www.seas.ucla.edu/spapl/VTRFormants.html) (Deng et
al. 2006) of hand-checked formants is refused by the licence policy
of docs/CONTRIBUTING.md (datasets/refused.json): All rights reserved;
"(c) Portions hereof copyright UC Regents. All Rights Reserved."; formant labels of 538 TIMIT sentences, whose audio needs the paid LDC licence.
