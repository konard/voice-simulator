Measured revision: [4d0737d](https://github.com/konard/voice-simulator/commit/4d0737de2c56279de0c75cfc07005da6af6f37d0).
Workflow: [44062254770](https://github.com/konard/voice-simulator/actions/runs/44062254770).

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
| transcript | median vocalTractLength error | 0.0085 | <= 0.0400 | true |
| transcript | median pitch error | 0.0419 | <= 0.0200 | false |
| transcript | median speechRate error | 0.1875 | <= 0.0800 | false |
| transcript | median tenseness error | 0.0717 | <= 0.1500 | true |
| transcript | median breathiness error | 0.0840 | <= 0.2000 | true |
| transcript | maximum tract error | 0.0308 | <= 0.1000 | true |
| transcript | tract 3 SD coverage | 20.0000 | >= 16.0000 | true |
| no transcript | median vocalTractLength error | 0.0892 | <= 0.0600 | false |
| no transcript | median pitch error | 0.0277 | <= 0.0200 | false |
| no transcript | median speechRate error | 0.1271 | <= 0.0800 | false |
| no transcript | median tenseness error | 0.0723 | <= 0.1500 | true |
| no transcript | median breathiness error | 0.0999 | <= 0.2000 | true |
| no transcript | maximum tract error | 0.1360 | <= 0.1000 | false |
| no transcript | tract 3 SD coverage | 0.0000 | >= 16.0000 | false |
| transcript | en-01 distance | 18.3142 | <= 21.7829 | true |
| no transcript | en-01 distance | 0.9399 | <= 1.8855 | true |
| transcript | en-02 distance | 21.5559 | <= 23.1584 | true |
| no transcript | en-02 distance | 1.8057 | <= 2.7753 | true |
| transcript | en-03 distance | 20.4478 | <= 24.9105 | true |
| no transcript | en-03 distance | 1.7790 | <= 3.6332 | true |
| transcript | en-04 distance | 18.0120 | <= 21.8072 | true |
| no transcript | en-04 distance | 1.0835 | <= 2.2150 | true |
| transcript | en-05 distance | 16.1392 | <= 20.3935 | true |
| no transcript | en-05 distance | 1.6499 | <= 3.0649 | true |
| transcript | en-06 distance | 19.3030 | <= 21.5999 | true |
| no transcript | en-06 distance | 1.2658 | <= 2.4870 | true |
| transcript | ru-01 distance | 17.1201 | <= 20.9774 | true |
| no transcript | ru-01 distance | 1.4501 | <= 2.4357 | true |
| transcript | ru-02 distance | 17.3991 | <= 20.4038 | true |
| no transcript | ru-02 distance | 1.4250 | <= 2.8993 | true |
| transcript | ru-03 distance | 17.1975 | <= 20.4337 | true |
| no transcript | ru-03 distance | 0.8208 | <= 1.8754 | true |
| transcript | ru-04 distance | 17.2603 | <= 21.3690 | true |
| no transcript | ru-04 distance | 2.0216 | <= 2.1427 | true |
| transcript | ru-05 distance | 24.1931 | <= 28.4313 | true |
| no transcript | ru-05 distance | 1.1794 | <= 2.9227 | true |
| transcript | ru-06 distance | 18.9887 | <= 23.1500 | true |
| no transcript | ru-06 distance | 1.4563 | <= 1.8901 | true |
| transcript | hi-01 distance | 18.1632 | <= 19.3626 | true |
| no transcript | hi-01 distance | 1.5215 | <= 2.7649 | true |
| transcript | hi-02 distance | 17.5612 | <= 17.5152 | false |
| no transcript | hi-02 distance | 0.8982 | <= 1.8435 | true |
| transcript | hi-03 distance | 17.2755 | <= 18.4926 | true |
| no transcript | hi-03 distance | 1.0747 | <= 2.8572 | true |
| transcript | hi-04 distance | 16.9748 | <= 17.7784 | true |
| no transcript | hi-04 distance | 1.0777 | <= 2.1374 | true |
| transcript | hi-05 distance | 15.3629 | <= 16.9899 | true |
| no transcript | hi-05 distance | 2.4120 | <= 3.7071 | true |
| transcript | hi-06 distance | 16.6424 | <= 16.9138 | true |
| no transcript | hi-06 distance | 1.5752 | <= 2.8141 | true |
| transcript | zh-01 distance | 20.4944 | <= 23.6415 | true |
| no transcript | zh-01 distance | 1.3916 | <= 2.7250 | true |
| transcript | zh-02 distance | 18.1123 | <= 21.4754 | true |
| no transcript | zh-02 distance | 1.4327 | <= 3.1855 | true |
| transcript | zh-03 distance | 19.0660 | <= 24.4062 | true |
| no transcript | zh-03 distance | 1.0526 | <= 2.9712 | true |
| transcript | zh-04 distance | 18.0128 | <= 25.6105 | true |
| no transcript | zh-04 distance | 1.3670 | <= 2.5368 | true |
| transcript | zh-05 distance | 17.7152 | <= 25.5893 | true |
| no transcript | zh-05 distance | 1.2488 | <= 2.6879 | true |
| transcript | zh-06 distance | 17.2544 | <= 20.8965 | true |
| no transcript | zh-06 distance | 1.3617 | <= 2.2346 | true |

## Synthetic recordings

| Seed | Transcript | Tract error | Pitch error | Rate error | Tenseness error | Breathiness error | Tract 3 SD covers truth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | true | 0.0069 | 0.0872 | 0.1946 | 0.1256 | 0.0837 | true |
| 1 | false | 0.0895 | 0.0152 | 0.0487 | 0.0002 | 0.0364 | false |
| 2 | true | 0.0255 | 0.0048 | 0.0273 | 0.2045 | 0.0421 | true |
| 2 | false | 0.1335 | 0.0469 | 0.0021 | 0.0908 | 0.0602 | false |
| 3 | true | 0.0008 | 0.0913 | 0.1613 | 0.1503 | 0.1072 | true |
| 3 | false | 0.0629 | 0.1281 | 0.1277 | 0.1103 | 0.0944 | false |
| 4 | true | 0.0308 | 0.0256 | 0.1363 | 0.1061 | 0.0025 | true |
| 4 | false | 0.0831 | 0.0495 | 0.1154 | 0.2270 | 0.0517 | false |
| 5 | true | 0.0078 | 0.0743 | 0.3657 | 0.0793 | 0.1384 | true |
| 5 | false | 0.0888 | 0.0326 | 0.4246 | 0.2414 | 0.0541 | false |
| 6 | true | 0.0067 | 0.1747 | 0.2805 | 0.1174 | 0.1047 | true |
| 6 | false | 0.0675 | 0.0519 | 0.0603 | 0.0441 | 0.0455 | false |
| 7 | true | 0.0096 | 0.3680 | 0.0739 | 0.0452 | 0.2067 | true |
| 7 | false | 0.0846 | 0.0380 | 0.0380 | 0.0499 | 0.2315 | false |
| 8 | true | 0.0070 | 0.0280 | 0.1803 | 0.0227 | 0.0202 | true |
| 8 | false | 0.1360 | 0.0313 | 0.1348 | 0.0957 | 0.1053 | false |
| 9 | true | 0.0013 | 0.0172 | 0.1693 | 0.0434 | 0.0754 | true |
| 9 | false | 0.0775 | 0.0462 | 0.1118 | 0.1577 | 0.0754 | false |
| 10 | true | 0.0086 | 0.0134 | 0.4272 | 0.0430 | 0.0844 | true |
| 10 | false | 0.0785 | 0.0085 | 0.3352 | 0.0218 | 0.1111 | false |
| 11 | true | 0.0093 | 0.0093 | 0.0172 | 0.0013 | 0.0374 | true |
| 11 | false | 0.1141 | 0.0062 | 0.0390 | 0.0408 | 0.0254 | false |
| 12 | true | 0.0142 | 0.3201 | 0.2059 | 0.1773 | 0.3432 | true |
| 12 | false | 0.1058 | 0.0116 | 0.0952 | 0.2126 | 0.4892 | false |
| 13 | true | 0.0013 | 0.1774 | 0.2307 | 0.2322 | 0.1039 | true |
| 13 | false | 0.0860 | 0.0430 | 0.2036 | 0.2846 | 0.1840 | false |
| 14 | true | 0.0100 | 0.0196 | 0.2696 | 0.0397 | 0.0208 | true |
| 14 | false | 0.1343 | 0.0007 | 0.3049 | 0.0102 | 0.1263 | false |
| 15 | true | 0.0030 | 0.0506 | 0.1706 | 0.0008 | 0.1758 | true |
| 15 | false | 0.0593 | 0.0057 | 0.2329 | 0.0016 | 0.1861 | false |
| 16 | true | 0.0084 | 0.2851 | 0.2941 | 0.1113 | 0.2265 | true |
| 16 | false | 0.1009 | 0.0436 | 0.1970 | 0.0937 | 0.1804 | false |
| 17 | true | 0.0269 | 0.0747 | 0.3294 | 0.1776 | 0.2096 | true |
| 17 | false | 0.0988 | 0.0027 | 0.2936 | 0.0855 | 0.1745 | false |
| 18 | true | 0.0159 | 0.0230 | 0.4817 | 0.0640 | 0.0214 | true |
| 18 | false | 0.1017 | 0.0181 | 0.5643 | 0.0440 | 0.0871 | false |
| 19 | true | 0.0092 | 0.0332 | 0.0124 | 0.0085 | 0.0112 | true |
| 19 | false | 0.0823 | 0.0241 | 0.0893 | 0.0591 | 0.0112 | false |
| 20 | true | 0.0031 | 0.0286 | 0.0046 | 0.0428 | 0.0086 | true |
| 20 | false | 0.1238 | 0.0039 | 0.1264 | 0.0360 | 0.1197 | false |

## Golden recordings

| Recording | Speaker | Sex | Transcript | Tract (cm ± SD) | Distance | Preset distance | MCD (dB) | Preset MCD (dB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en-01* | librivox-215 | unknown | true | 16.4596 ± 0.4932 | 18.3142 | 21.7829 | 57.6329 | 68.6245 |
| en-01* | librivox-215 | unknown | false | 14.7925 ± 0.4932 | 0.9399 | 1.8855 | 65.9098 | 67.4812 |
| en-02* | librivox-201 | unknown | true | 16.0645 ± 0.3359 | 21.5559 | 23.1584 | 67.7182 | 72.7911 |
| en-02* | librivox-201 | unknown | false | 15.6078 ± 0.2642 | 1.8057 | 2.7753 | 79.6389 | 77.6147 |
| en-03* | librivox-246 | unknown | true | 11.4921 ± 0.2821 | 20.4478 | 24.9105 | 62.8752 | 76.4076 |
| en-03* | librivox-246 | unknown | false | 12.8029 ± 0.2821 | 1.7790 | 3.6332 | 69.5144 | 77.7009 |
| en-04* | librivox-246 | unknown | true | 15.2443 ± 0.3216 | 18.0120 | 21.8072 | 56.7798 | 68.7551 |
| en-04* | librivox-246 | unknown | false | 14.8728 ± 0.3216 | 1.0835 | 2.2150 | 64.4824 | 70.6966 |
| en-05* | librivox-19 | unknown | true | 13.7267 ± 0.3442 | 16.1392 | 20.3935 | 50.8736 | 64.1177 |
| en-05* | librivox-19 | unknown | false | 14.5698 ± 0.3442 | 1.6499 | 3.0649 | 62.3993 | 61.7084 |
| en-06* | librivox-30 | unknown | true | 13.9430 ± 0.3011 | 19.3030 | 21.5999 | 60.8019 | 68.0156 |
| en-06* | librivox-30 | unknown | false | 14.4396 ± 0.3011 | 1.2658 | 2.4870 | 64.0613 | 63.2753 |
| ru-01* | librivox-1593 | unknown | true | 14.0443 ± 0.2812 | 17.1201 | 20.9774 | 53.9780 | 66.0285 |
| ru-01* | librivox-1593 | unknown | false | 14.0293 ± 0.2812 | 1.4501 | 2.4357 | 65.6338 | 65.4515 |
| ru-02* | librivox-1593 | unknown | true | 14.6218 ± 0.3154 | 17.3991 | 20.4038 | 54.8547 | 64.3440 |
| ru-02* | librivox-1593 | unknown | false | 14.1092 ± 0.3154 | 1.4250 | 2.8993 | 66.7793 | 73.9967 |
| ru-03* | librivox-1593 | unknown | true | 16.0247 ± 0.4790 | 17.1975 | 20.4337 | 54.2328 | 64.4971 |
| ru-03* | librivox-1593 | unknown | false | 15.2349 ± 0.4790 | 0.8208 | 1.8754 | 61.9503 | 66.3706 |
| ru-04* | librivox-2826 | unknown | true | 20.0000 ± 0.6236 | 17.2603 | 21.3690 | 54.4015 | 67.3226 |
| ru-04* | librivox-2826 | unknown | false | 16.7162 ± 0.3893 | 2.0216 | 2.1427 | 66.4421 | 67.4203 |
| ru-05* | librivox-3056 | unknown | true | 13.5097 ± 0.3110 | 24.1931 | 28.4313 | 74.4352 | 87.3008 |
| ru-05* | librivox-3056 | unknown | false | 13.4179 ± 0.3110 | 1.1794 | 2.9227 | 78.9309 | 80.2935 |
| ru-06* | librivox-3056 | unknown | true | 14.0747 ± 0.3284 | 18.9887 | 23.1500 | 59.9018 | 73.1302 |
| ru-06* | librivox-3056 | unknown | false | 13.0344 ± 0.1953 | 1.4563 | 1.8901 | 71.2053 | 70.8141 |
| hi-01* | librivox-19651 | unknown | true | 13.8108 ± 0.2394 | 18.1632 | 19.3626 | 57.3072 | 60.9717 |
| hi-01* | librivox-19651 | unknown | false | 13.3004 ± 0.2394 | 1.5215 | 2.7649 | 64.4987 | 65.9491 |
| hi-02* | librivox-19651 | unknown | true | 13.9187 ± 0.2443 | 17.5612 | 17.5152 | 55.4616 | 55.1963 |
| hi-02* | librivox-19651 | unknown | false | 13.8622 ± 0.2443 | 0.8982 | 1.8435 | 60.2457 | 62.5019 |
| hi-03* | librivox-19651 | unknown | true | 14.0245 ± 0.3900 | 17.2755 | 18.4926 | 54.2749 | 58.0229 |
| hi-03* | librivox-19651 | unknown | false | 14.3406 ± 0.2897 | 1.0747 | 2.8572 | 63.1257 | 66.0793 |
| hi-04* | librivox-19651 | unknown | true | 13.8290 ± 0.1701 | 16.9748 | 17.7784 | 53.5784 | 56.0582 |
| hi-04* | librivox-19651 | unknown | false | 14.2843 ± 0.1701 | 1.0777 | 2.1374 | 61.6396 | 61.6183 |
| hi-05* | librivox-19651 | unknown | true | 14.0522 ± 0.3893 | 15.3629 | 16.9899 | 48.4825 | 53.5429 |
| hi-05* | librivox-19651 | unknown | false | 12.3744 ± 0.2804 | 2.4120 | 3.7071 | 59.7886 | 60.8686 |
| hi-06* | librivox-19651 | unknown | true | 13.6139 ± 0.2596 | 16.6424 | 16.9138 | 52.5521 | 53.2413 |
| hi-06* | librivox-19651 | unknown | false | 13.1592 ± 0.1866 | 1.5752 | 2.8141 | 66.6962 | 62.8560 |
| zh-01* | librivox-2245 | unknown | true | 13.7059 ± 0.3212 | 20.4944 | 23.6415 | 64.4290 | 74.4112 |
| zh-01* | librivox-2245 | unknown | false | 13.6273 ± 0.3212 | 1.3916 | 2.7250 | 76.3307 | 80.8741 |
| zh-02* | librivox-2245 | unknown | true | 14.0728 ± 0.3273 | 18.1123 | 21.4754 | 56.9101 | 67.4661 |
| zh-02* | librivox-2245 | unknown | false | 12.6812 ± 0.3273 | 1.4327 | 3.1855 | 77.7909 | 77.6084 |
| zh-03* | librivox-2245 | unknown | true | 14.3632 ± 0.2958 | 19.0660 | 24.4062 | 59.8968 | 76.8315 |
| zh-03* | librivox-2245 | unknown | false | 13.8814 ± 0.2743 | 1.0526 | 2.9712 | 66.4728 | 70.9186 |
| zh-04* | librivox-2245 | unknown | true | 16.2188 ± 0.7543 | 18.0128 | 25.6105 | 56.5480 | 80.7694 |
| zh-04* | librivox-2245 | unknown | false | 13.2075 ± 0.4726 | 1.3670 | 2.5368 | 79.8140 | 79.4858 |
| zh-05* | librivox-2245 | unknown | true | 13.5704 ± 0.3956 | 17.7152 | 25.5893 | 55.8300 | 80.7393 |
| zh-05* | librivox-2245 | unknown | false | 12.8933 ± 0.3956 | 1.2488 | 2.6879 | 75.8085 | 73.7797 |
| zh-06* | librivox-2245 | unknown | true | 14.0783 ± 0.4220 | 17.2544 | 20.8965 | 54.4152 | 65.8588 |
| zh-06* | librivox-2245 | unknown | false | 13.5067 ± 0.4220 | 1.3617 | 2.2346 | 72.8958 | 74.0677 |

All fitted values and SDs are in the JSON report. Plausibility reference:
female tract 14–15 cm; male tract 16–18 cm. These are descriptive references, not gates.
Manifest sex is retained verbatim, including unknown; it is not inferred from the fit.
Ungated targets: distance at most half the preset for 80% of recordings;
MCD at least 0.5 dB better than the preset.
Measured half-distance share: 0.2292.
Measured MCD improvement share: 0.7708.
