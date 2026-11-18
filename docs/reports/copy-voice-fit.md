Measured revision: [5cb68e7](https://github.com/konard/voice-simulator/commit/5cb68e76928db34a01d3edd4ecd4772506ced1ab).
Workflow: [44280732497](https://github.com/konard/voice-simulator/actions/runs/44280732497).

These are measurements of that revision, not a claim that the current revision passes.
The archived rows retain their original values and SDs. The gate table uses the
arithmetic mean of the middle two values for even-sized medians.

# Voice configuration fit (issue 63)

Command: `npm run test:heavy -- --suite copy`. Seed 1, maxRenders 40.
All fitted uncertainties are rough indicators, not confidence intervals.
An asterisk marks a golden transcript or IPA not confirmed by a human. No audio is replayed.

## Gates

| Mode | Metric | Measured | Requirement | Pass |
| --- | --- | --- | --- | --- |
| transcript | median vocalTractLength error | 0.0066 | <= 0.0400 | true |
| transcript | median pitch error | 0.0183 | <= 0.0200 | true |
| transcript | median speechRate error | 0.0199 | <= 0.0800 | true |
| transcript | median tenseness error | 0.0342 | <= 0.1500 | true |
| transcript | median breathiness error | 0.0426 | <= 0.2000 | true |
| transcript | maximum tract error | 0.0245 | <= 0.1000 | true |
| transcript | tract 3 SD coverage | 20.0000 | >= 16.0000 | true |
| no transcript | median vocalTractLength error | 0.0272 | <= 0.0600 | true |
| no transcript | median pitch error | 0.0166 | <= 0.0200 | true |
| no transcript | median speechRate error | 0.0769 | <= 0.0800 | true |
| no transcript | median tenseness error | 0.0562 | <= 0.1500 | true |
| no transcript | median breathiness error | 0.0713 | <= 0.2000 | true |
| no transcript | maximum tract error | 0.0750 | <= 0.1000 | true |
| no transcript | tract 3 SD coverage | 20.0000 | >= 16.0000 | true |
| transcript | en-01 distance | 17.9184 | <= 21.8815 | true |
| no transcript | en-01 distance | 1.7109 | <= 2.9348 | true |
| transcript | en-02 distance | 20.1124 | <= 22.1717 | true |
| no transcript | en-02 distance | 1.7308 | <= 2.9209 | true |
| transcript | en-03 distance | 20.3299 | <= 25.1040 | true |
| no transcript | en-03 distance | 1.8113 | <= 4.6546 | true |
| transcript | en-04 distance | 19.4006 | <= 21.7486 | true |
| no transcript | en-04 distance | 6.6360 | <= 9.2431 | true |
| transcript | en-05 distance | 16.7246 | <= 20.5009 | true |
| no transcript | en-05 distance | 6.6498 | <= 9.0753 | true |
| transcript | en-06 distance | 20.8510 | <= 21.7342 | true |
| no transcript | en-06 distance | 1.7114 | <= 3.4149 | true |
| transcript | ru-01 distance | 17.1194 | <= 20.5724 | true |
| no transcript | ru-01 distance | 2.1189 | <= 3.3831 | true |
| transcript | ru-02 distance | 17.3452 | <= 20.4764 | true |
| no transcript | ru-02 distance | 1.6903 | <= 3.6044 | true |
| transcript | ru-03 distance | 17.8700 | <= 20.5043 | true |
| no transcript | ru-03 distance | 1.9423 | <= 3.2278 | true |
| transcript | ru-04 distance | 18.7031 | <= 21.4272 | true |
| no transcript | ru-04 distance | 1.9154 | <= 3.2682 | true |
| transcript | ru-05 distance | 24.8085 | <= 28.5912 | true |
| no transcript | ru-05 distance | 2.0998 | <= 4.2277 | true |
| transcript | ru-06 distance | 19.4404 | <= 23.3451 | true |
| no transcript | ru-06 distance | 1.9960 | <= 3.2068 | true |
| transcript | hi-01 distance | 17.9320 | <= 19.9808 | true |
| no transcript | hi-01 distance | 1.9094 | <= 3.1321 | true |
| transcript | hi-02 distance | 17.2559 | <= 17.8929 | true |
| no transcript | hi-02 distance | 1.3089 | <= 2.2372 | true |
| transcript | hi-03 distance | 17.3540 | <= 20.4460 | true |
| no transcript | hi-03 distance | 1.8797 | <= 3.3747 | true |
| transcript | hi-04 distance | 17.3149 | <= 17.8180 | true |
| no transcript | hi-04 distance | 1.1707 | <= 3.0228 | true |
| transcript | hi-05 distance | 14.7563 | <= 17.1351 | true |
| no transcript | hi-05 distance | 2.4566 | <= 3.9866 | true |
| transcript | hi-06 distance | 16.4524 | <= 16.6843 | true |
| no transcript | hi-06 distance | 1.8354 | <= 3.6501 | true |
| transcript | zh-01 distance | 20.1877 | <= 24.3300 | true |
| no transcript | zh-01 distance | 1.5390 | <= 3.4230 | true |
| transcript | zh-02 distance | 19.4064 | <= 22.1423 | true |
| no transcript | zh-02 distance | 2.3582 | <= 3.6343 | true |
| transcript | zh-03 distance | 19.6498 | <= 24.4984 | true |
| no transcript | zh-03 distance | 2.8027 | <= 5.1408 | true |
| transcript | zh-04 distance | 18.6224 | <= 25.3560 | true |
| no transcript | zh-04 distance | 1.7883 | <= 3.3374 | true |
| transcript | zh-05 distance | 20.0304 | <= 25.3159 | true |
| no transcript | zh-05 distance | 2.0739 | <= 3.5887 | true |
| transcript | zh-06 distance | 17.8824 | <= 21.0517 | true |
| no transcript | zh-06 distance | 4.1901 | <= 6.1095 | true |

## Synthetic recordings

| Seed | Transcript | Tract error | Pitch error | Rate error | Tenseness error | Breathiness error | Tract 3 SD covers truth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | true | 0.0046 | 0.1665 | 0.0044 | 0.0330 | 0.0753 | true |
| 1 | false | 0.0314 | 0.0411 | 0.2008 | 0.0811 | 0.0253 | true |
| 2 | true | 0.0079 | 0.0097 | 0.0081 | 0.0188 | 0.0804 | true |
| 2 | false | 0.0138 | 0.0191 | 0.1243 | 0.0465 | 0.0489 | true |
| 3 | true | 0.0245 | 0.2619 | 0.0238 | 0.3707 | 0.0829 | true |
| 3 | false | 0.0275 | 0.0310 | 0.1325 | 0.1851 | 0.0042 | true |
| 4 | true | 0.0077 | 0.0351 | 0.0393 | 0.1134 | 0.0368 | true |
| 4 | false | 0.0505 | 0.0181 | 0.0160 | 0.0787 | 0.0587 | true |
| 5 | true | 0.0223 | 0.0127 | 0.0247 | 0.1289 | 0.1461 | true |
| 5 | false | 0.0380 | 0.0030 | 0.0500 | 0.0696 | 0.0132 | true |
| 6 | true | 0.0104 | 0.0235 | 0.0122 | 0.0177 | 0.0029 | true |
| 6 | false | 0.0165 | 0.0130 | 0.0080 | 0.0232 | 0.1029 | true |
| 7 | true | 0.0066 | 0.0182 | 0.0109 | 0.0923 | 0.0782 | true |
| 7 | false | 0.0750 | 0.0196 | 0.1567 | 0.0561 | 0.1707 | true |
| 8 | true | 0.0048 | 0.0018 | 0.0071 | 0.0775 | 0.0133 | true |
| 8 | false | 0.0155 | 0.0301 | 0.3270 | 0.0863 | 0.0696 | true |
| 9 | true | 0.0001 | 0.0185 | 0.0013 | 0.0040 | 0.0154 | true |
| 9 | false | 0.0027 | 0.0288 | 0.0252 | 0.0034 | 0.0926 | true |
| 10 | true | 0.0056 | 0.0134 | 0.0449 | 0.0114 | 0.0620 | true |
| 10 | false | 0.0514 | 0.0039 | 0.0185 | 0.0405 | 0.1587 | true |
| 11 | true | 0.0108 | 0.0114 | 0.0134 | 0.0189 | 0.0746 | true |
| 11 | false | 0.0179 | 0.0142 | 0.0721 | 0.0949 | 0.1523 | true |
| 12 | true | 0.0033 | 0.0130 | 0.0051 | 0.0344 | 0.0283 | true |
| 12 | false | 0.0033 | 0.0000 | 0.1029 | 0.0182 | 0.0192 | true |
| 13 | true | 0.0128 | 0.0120 | 0.0323 | 0.0780 | 0.1056 | true |
| 13 | false | 0.0193 | 0.0104 | 0.0818 | 0.1023 | 0.1369 | true |
| 14 | true | 0.0065 | 0.0176 | 0.0223 | 0.0340 | 0.0399 | true |
| 14 | false | 0.0335 | 0.0117 | 0.0052 | 0.0073 | 0.0601 | true |
| 15 | true | 0.0006 | 0.0355 | 0.0174 | 0.0407 | 0.0537 | true |
| 15 | false | 0.0270 | 0.0282 | 0.0661 | 0.0142 | 0.1380 | true |
| 16 | true | 0.0001 | 0.0431 | 0.0251 | 0.0060 | 0.0452 | true |
| 16 | false | 0.0383 | 0.0025 | 0.1213 | 0.0024 | 0.0730 | true |
| 17 | true | 0.0053 | 0.0417 | 0.0287 | 0.0220 | 0.0276 | true |
| 17 | false | 0.0040 | 0.0206 | 0.1653 | 0.0563 | 0.0835 | true |
| 18 | true | 0.0232 | 0.0050 | 0.0317 | 0.0861 | 0.0243 | true |
| 18 | false | 0.0568 | 0.0150 | 0.0573 | 0.0679 | 0.1524 | true |
| 19 | true | 0.0002 | 0.0618 | 0.0003 | 0.0980 | 0.0041 | true |
| 19 | false | 0.0501 | 0.0192 | 0.0033 | 0.1197 | 0.0503 | true |
| 20 | true | 0.0090 | 0.0215 | 0.0527 | 0.0239 | 0.0081 | true |
| 20 | false | 0.0062 | 0.0068 | 0.1489 | 0.0336 | 0.0428 | true |

## Golden recordings

| Recording | Speaker | Sex | Transcript | Tract (cm ± SD) | Distance | Preset distance | MCD (dB) | Preset MCD (dB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en-01* | librivox-215 | unknown | true | 18.6640 ± 0.7285 | 17.9184 | 21.8815 | 56.4334 | 68.6245 |
| en-01* | librivox-215 | unknown | false | 14.4787 ± 0.5894 | 1.7109 | 2.9348 | 62.9885 | 68.6311 |
| en-02* | librivox-201 | unknown | true | 20.0000 ± 0.2642 | 20.1124 | 22.1717 | 62.8631 | 69.6782 |
| en-02* | librivox-201 | unknown | false | 16.2731 ± 0.5097 | 1.7308 | 2.9209 | 77.8843 | 77.4302 |
| en-03* | librivox-246 | unknown | true | 11.3140 ± 0.4372 | 20.3299 | 25.1040 | 62.4218 | 76.4076 |
| en-03* | librivox-246 | unknown | false | 13.0838 ± 0.5716 | 1.8113 | 4.6546 | 65.0753 | 77.7009 |
| en-04* | librivox-246 | unknown | true | 15.3359 ± 0.3798 | 19.4006 | 21.7486 | 61.0090 | 68.1861 |
| en-04* | librivox-246 | unknown | false | 14.3835 ± 0.5373 | 6.6360 | 9.2431 | 62.9217 | 70.3357 |
| en-05* | librivox-19 | unknown | true | 13.9293 ± 0.3618 | 16.7246 | 20.5009 | 52.6080 | 64.1238 |
| en-05* | librivox-19 | unknown | false | 14.9054 ± 0.5339 | 6.6498 | 9.0753 | 57.8069 | 65.3816 |
| en-06* | librivox-30 | unknown | true | 13.7252 ± 0.2448 | 20.8510 | 21.7342 | 65.6576 | 68.0156 |
| en-06* | librivox-30 | unknown | false | 12.8732 ± 0.4546 | 1.7114 | 3.4149 | 58.7364 | 60.9829 |
| ru-01* | librivox-1593 | unknown | true | 14.7874 ± 0.3252 | 17.1194 | 20.5724 | 53.9146 | 64.4421 |
| ru-01* | librivox-1593 | unknown | false | 13.9682 ± 0.4933 | 2.1189 | 3.3831 | 65.0055 | 65.4304 |
| ru-02* | librivox-1593 | unknown | true | 15.1910 ± 0.3533 | 17.3452 | 20.4764 | 54.5814 | 64.3440 |
| ru-02* | librivox-1593 | unknown | false | 13.2836 ± 0.5074 | 1.6903 | 3.6044 | 64.8648 | 75.0267 |
| ru-03* | librivox-1593 | unknown | true | 15.3126 ± 0.4790 | 17.8700 | 20.5043 | 56.3798 | 64.4971 |
| ru-03* | librivox-1593 | unknown | false | 13.5418 ± 0.6052 | 1.9423 | 3.2278 | 63.8962 | 67.0285 |
| ru-04* | librivox-2826 | unknown | true | 19.9614 ± 0.3893 | 18.7031 | 21.4272 | 58.9165 | 67.3226 |
| ru-04* | librivox-2826 | unknown | false | 15.3902 ± 0.5836 | 1.9154 | 3.2682 | 70.5520 | 68.1555 |
| ru-05* | librivox-3056 | unknown | true | 13.4902 ± 0.2625 | 24.8085 | 28.5912 | 76.1352 | 87.3008 |
| ru-05* | librivox-3056 | unknown | false | 13.0168 ± 0.4444 | 2.0998 | 4.2277 | 82.2005 | 80.2935 |
| ru-06* | librivox-3056 | unknown | true | 13.5357 ± 0.2420 | 19.4404 | 23.3451 | 61.2148 | 73.2368 |
| ru-06* | librivox-3056 | unknown | false | 13.2133 ± 0.4326 | 1.9960 | 3.2068 | 67.6830 | 70.3794 |
| hi-01* | librivox-19651 | unknown | true | 13.8307 ± 0.2815 | 17.9320 | 19.9808 | 56.4240 | 62.6311 |
| hi-01* | librivox-19651 | unknown | false | 13.0728 ± 0.4224 | 1.9094 | 3.1321 | 62.9410 | 65.9491 |
| hi-02* | librivox-19651 | unknown | true | 13.7612 ± 0.2220 | 17.2559 | 17.8929 | 54.3921 | 56.3648 |
| hi-02* | librivox-19651 | unknown | false | 13.6435 ± 0.4344 | 1.3089 | 2.2372 | 64.7437 | 62.5019 |
| hi-03* | librivox-19651 | unknown | true | 15.2296 ± 0.2227 | 17.3540 | 20.4460 | 54.4768 | 64.1213 |
| hi-03* | librivox-19651 | unknown | false | 13.7811 ± 0.4366 | 1.8797 | 3.3747 | 62.9750 | 65.1523 |
| hi-04* | librivox-19651 | unknown | true | 13.7062 ± 0.1352 | 17.3149 | 17.8180 | 54.5184 | 56.0498 |
| hi-04* | librivox-19651 | unknown | false | 12.8668 ± 0.4055 | 1.1707 | 3.0228 | 62.8372 | 60.8064 |
| hi-05* | librivox-19651 | unknown | true | 16.4333 ± 1.0478 | 14.7563 | 17.1351 | 46.1054 | 53.6718 |
| hi-05* | librivox-19651 | unknown | false | 12.8996 ± 0.4281 | 2.4566 | 3.9866 | 61.5269 | 60.8012 |
| hi-06* | librivox-19651 | unknown | true | 14.0415 ± 0.5320 | 16.4524 | 16.6843 | 51.8311 | 52.3480 |
| hi-06* | librivox-19651 | unknown | false | 12.4122 ± 0.3896 | 1.8354 | 3.6501 | 63.2001 | 65.7891 |
| zh-01* | librivox-2245 | unknown | true | 13.4000 ± 0.3265 | 20.1877 | 24.3300 | 61.9100 | 76.0542 |
| zh-01* | librivox-2245 | unknown | false | 12.2554 ± 0.4953 | 1.5390 | 3.4230 | 73.2477 | 77.7489 |
| zh-02* | librivox-2245 | unknown | true | 12.3246 ± 0.2510 | 19.4064 | 22.1423 | 61.0126 | 69.3071 |
| zh-02* | librivox-2245 | unknown | false | 12.8713 ± 0.4359 | 2.3582 | 3.6343 | 78.0476 | 75.7235 |
| zh-03* | librivox-2245 | unknown | true | 14.2401 ± 0.3095 | 19.6498 | 24.4984 | 61.8445 | 76.8315 |
| zh-03* | librivox-2245 | unknown | false | 13.5733 ± 0.4874 | 2.8027 | 5.1408 | 68.2791 | 78.3034 |
| zh-04* | librivox-2245 | unknown | true | 13.8928 ± 0.3533 | 18.6224 | 25.3560 | 58.6937 | 79.6011 |
| zh-04* | librivox-2245 | unknown | false | 13.2941 ± 0.5145 | 1.7883 | 3.3374 | 79.6472 | 79.8209 |
| zh-05* | librivox-2245 | unknown | true | 13.7501 ± 0.2736 | 20.0304 | 25.3159 | 62.8675 | 79.2751 |
| zh-05* | librivox-2245 | unknown | false | 13.8216 ± 0.4587 | 2.0739 | 3.5887 | 80.6329 | 71.7990 |
| zh-06* | librivox-2245 | unknown | true | 14.0641 ± 0.2361 | 17.8824 | 21.0517 | 56.2002 | 65.8588 |
| zh-06* | librivox-2245 | unknown | false | 12.0458 ± 0.4505 | 4.1901 | 6.1095 | 70.0580 | 75.0520 |

All fitted values and SDs are in the JSON report. Plausibility reference:
female tract 14–15 cm; male tract 16–18 cm. These are descriptive references, not gates.
Manifest sex is retained verbatim, including unknown; it is not inferred from the fit.
Ungated targets: distance at most half the preset for 80% of recordings;
MCD at least 0.5 dB better than the preset.
Measured half-distance share: 0.1042.
Measured MCD improvement share: 0.7917.
