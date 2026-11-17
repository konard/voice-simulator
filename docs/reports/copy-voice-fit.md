Measured revision: [3487780](https://github.com/konard/voice-simulator/commit/3487780e17996dec72d15c507a51cea7d04278d7).
Workflow: [44072776328](https://github.com/konard/voice-simulator/actions/runs/44072776328).

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
| transcript | median vocalTractLength error | 0.0086 | <= 0.0400 | true |
| transcript | median pitch error | 0.0406 | <= 0.0200 | false |
| transcript | median speechRate error | 0.1614 | <= 0.0800 | false |
| transcript | median tenseness error | 0.0599 | <= 0.1500 | true |
| transcript | median breathiness error | 0.0759 | <= 0.2000 | true |
| transcript | maximum tract error | 0.0279 | <= 0.1000 | true |
| transcript | tract 3 SD coverage | 20.0000 | >= 16.0000 | true |
| no transcript | median vocalTractLength error | 0.0675 | <= 0.0600 | false |
| no transcript | median pitch error | 0.0249 | <= 0.0200 | false |
| no transcript | median speechRate error | 0.1359 | <= 0.0800 | false |
| no transcript | median tenseness error | 0.0500 | <= 0.1500 | true |
| no transcript | median breathiness error | 0.0814 | <= 0.2000 | true |
| no transcript | maximum tract error | 0.1018 | <= 0.1000 | false |
| no transcript | tract 3 SD coverage | 7.0000 | >= 16.0000 | false |
| transcript | en-01 distance | 18.4032 | <= 21.8914 | true |
| no transcript | en-01 distance | 1.1025 | <= 2.6886 | true |
| transcript | en-02 distance | 21.6198 | <= 23.2413 | true |
| no transcript | en-02 distance | 2.4057 | <= 2.8642 | true |
| transcript | en-03 distance | 18.8576 | <= 25.1777 | true |
| no transcript | en-03 distance | 2.3585 | <= 4.7633 | true |
| transcript | en-04 distance | 17.7530 | <= 21.8841 | true |
| no transcript | en-04 distance | 1.5327 | <= 2.8704 | true |
| transcript | en-05 distance | 16.4648 | <= 20.5460 | true |
| no transcript | en-05 distance | 1.8061 | <= 3.3343 | true |
| transcript | en-06 distance | 21.3061 | <= 23.1383 | true |
| no transcript | en-06 distance | 1.7070 | <= 3.1312 | true |
| transcript | ru-01 distance | 17.3747 | <= 20.5749 | true |
| no transcript | ru-01 distance | 1.5430 | <= 3.0117 | true |
| transcript | ru-02 distance | 17.4442 | <= 20.4743 | true |
| no transcript | ru-02 distance | 1.6861 | <= 3.2465 | true |
| transcript | ru-03 distance | 17.2724 | <= 20.4988 | true |
| no transcript | ru-03 distance | 1.1615 | <= 2.4205 | true |
| transcript | ru-04 distance | 17.3187 | <= 21.4287 | true |
| no transcript | ru-04 distance | 2.4055 | <= 2.5226 | true |
| transcript | ru-05 distance | 23.3675 | <= 30.9732 | true |
| no transcript | ru-05 distance | 2.1401 | <= 3.9456 | true |
| transcript | ru-06 distance | 19.4069 | <= 23.1728 | true |
| no transcript | ru-06 distance | 2.3215 | <= 2.7925 | true |
| transcript | hi-01 distance | 18.1928 | <= 19.3636 | true |
| no transcript | hi-01 distance | 2.5003 | <= 3.2227 | true |
| transcript | hi-02 distance | 18.0101 | <= 17.3978 | false |
| no transcript | hi-02 distance | 1.4406 | <= 2.2586 | true |
| transcript | hi-03 distance | 17.1818 | <= 20.7538 | true |
| no transcript | hi-03 distance | 1.7059 | <= 3.2455 | true |
| transcript | hi-04 distance | 16.8897 | <= 17.8248 | true |
| no transcript | hi-04 distance | 1.5173 | <= 2.4875 | true |
| transcript | hi-05 distance | 15.2300 | <= 17.9528 | true |
| no transcript | hi-05 distance | 3.3812 | <= 4.1636 | true |
| transcript | hi-06 distance | 16.4828 | <= 16.5641 | true |
| no transcript | hi-06 distance | 2.5953 | <= 3.4106 | true |
| transcript | zh-01 distance | 18.5031 | <= 25.7132 | true |
| no transcript | zh-01 distance | 1.8134 | <= 3.6075 | true |
| transcript | zh-02 distance | 17.9390 | <= 21.6078 | true |
| no transcript | zh-02 distance | 2.4668 | <= 3.6211 | true |
| transcript | zh-03 distance | 17.9247 | <= 25.5055 | true |
| no transcript | zh-03 distance | 1.9066 | <= 3.6940 | true |
| transcript | zh-04 distance | 18.5865 | <= 25.7353 | true |
| no transcript | zh-04 distance | 2.0300 | <= 3.1314 | true |
| transcript | zh-05 distance | 18.0429 | <= 25.8755 | true |
| no transcript | zh-05 distance | 2.0403 | <= 3.4963 | true |
| transcript | zh-06 distance | 17.3850 | <= 22.0833 | true |
| no transcript | zh-06 distance | 2.3518 | <= 2.8718 | true |

## Synthetic recordings

| Seed | Transcript | Tract error | Pitch error | Rate error | Tenseness error | Breathiness error | Tract 3 SD covers truth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | true | 0.0090 | 0.0439 | 0.0072 | 0.0411 | 0.0253 | true |
| 1 | false | 0.0751 | 0.1499 | 0.1155 | 0.0192 | 0.0609 | false |
| 2 | true | 0.0066 | 0.0043 | 0.0158 | 0.1979 | 0.0421 | true |
| 2 | false | 0.0472 | 0.0264 | 0.1119 | 0.1122 | 0.0032 | true |
| 3 | true | 0.0085 | 0.0622 | 0.0305 | 0.0750 | 0.0764 | true |
| 3 | false | 0.0641 | 0.0226 | 0.0404 | 0.0263 | 0.0463 | false |
| 4 | true | 0.0004 | 0.0445 | 0.1535 | 0.0601 | 0.0372 | true |
| 4 | false | 0.0105 | 0.0035 | 0.2343 | 0.1855 | 0.0184 | true |
| 5 | true | 0.0083 | 0.0594 | 0.4560 | 0.0697 | 0.0819 | true |
| 5 | false | 0.0812 | 0.0167 | 0.4350 | 0.2225 | 0.0315 | false |
| 6 | true | 0.0067 | 0.1747 | 0.2805 | 0.1174 | 0.1047 | true |
| 6 | false | 0.0368 | 0.0313 | 0.0406 | 0.0603 | 0.0983 | false |
| 7 | true | 0.0279 | 0.5285 | 0.0571 | 0.0378 | 0.2198 | true |
| 7 | false | 0.0328 | 0.0413 | 0.1168 | 0.0310 | 0.1252 | true |
| 8 | true | 0.0146 | 0.0247 | 0.0296 | 0.0117 | 0.0202 | true |
| 8 | false | 0.0931 | 0.0289 | 0.1549 | 0.0509 | 0.0202 | false |
| 9 | true | 0.0013 | 0.0172 | 0.1693 | 0.0434 | 0.0754 | true |
| 9 | false | 0.0097 | 0.0712 | 0.1119 | 0.1460 | 0.1170 | true |
| 10 | true | 0.0086 | 0.0134 | 0.4272 | 0.0430 | 0.0844 | true |
| 10 | false | 0.0656 | 0.0074 | 0.3157 | 0.0035 | 0.0844 | false |
| 11 | true | 0.0058 | 0.0374 | 0.0039 | 0.0598 | 0.0117 | true |
| 11 | false | 0.0995 | 0.0083 | 0.0463 | 0.0313 | 0.1729 | false |
| 12 | true | 0.0164 | 0.3295 | 0.0916 | 0.2549 | 0.3432 | true |
| 12 | false | 0.0025 | 0.0421 | 0.0605 | 0.2284 | 0.2988 | true |
| 13 | true | 0.0013 | 0.1774 | 0.2307 | 0.2322 | 0.1039 | true |
| 13 | false | 0.0695 | 0.0234 | 0.2601 | 0.2576 | 0.0823 | false |
| 14 | true | 0.0100 | 0.0196 | 0.2696 | 0.0397 | 0.0208 | true |
| 14 | false | 0.1018 | 0.0216 | 0.2968 | 0.0203 | 0.0805 | false |
| 15 | true | 0.0166 | 0.0506 | 0.1706 | 0.0008 | 0.1758 | true |
| 15 | false | 0.0129 | 0.0130 | 0.1687 | 0.0922 | 0.1495 | true |
| 16 | true | 0.0121 | 0.2470 | 0.2717 | 0.0993 | 0.1545 | true |
| 16 | false | 0.0907 | 0.0277 | 0.1765 | 0.0491 | 0.0950 | false |
| 17 | true | 0.0072 | 0.0259 | 0.4333 | 0.1478 | 0.1965 | true |
| 17 | false | 0.0752 | 0.0479 | 0.3571 | 0.1810 | 0.1447 | false |
| 18 | true | 0.0159 | 0.0230 | 0.4817 | 0.0640 | 0.0214 | true |
| 18 | false | 0.0777 | 0.0140 | 0.4424 | 0.0126 | 0.0785 | false |
| 19 | true | 0.0033 | 0.0304 | 0.1006 | 0.0431 | 0.0300 | true |
| 19 | false | 0.0054 | 0.0672 | 0.0684 | 0.0292 | 0.0050 | true |
| 20 | true | 0.0116 | 0.0075 | 0.0116 | 0.0127 | 0.0086 | true |
| 20 | false | 0.0928 | 0.0034 | 0.0787 | 0.0335 | 0.0160 | false |

## Golden recordings

| Recording | Speaker | Sex | Transcript | Tract (cm ± SD) | Distance | Preset distance | MCD (dB) | Preset MCD (dB) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en-01* | librivox-215 | unknown | true | 17.5926 ± 0.4363 | 18.4032 | 21.8914 | 57.9240 | 68.6245 |
| en-01* | librivox-215 | unknown | false | 16.2190 ± 0.4363 | 1.1025 | 2.6886 | 68.1046 | 68.1764 |
| en-02* | librivox-201 | unknown | true | 16.0645 ± 0.3359 | 21.6198 | 23.2413 | 67.7182 | 72.7911 |
| en-02* | librivox-201 | unknown | false | 15.6135 ± 0.2642 | 2.4057 | 2.8642 | 81.6857 | 76.5007 |
| en-03* | librivox-246 | unknown | true | 19.7730 ± 1.1046 | 18.8576 | 25.1777 | 57.6436 | 75.8406 |
| en-03* | librivox-246 | unknown | false | 15.1262 ± 0.4372 | 2.3585 | 4.7633 | 70.5408 | 81.1746 |
| en-04* | librivox-246 | unknown | true | 15.1559 ± 0.3798 | 17.7530 | 21.8841 | 55.8403 | 68.6363 |
| en-04* | librivox-246 | unknown | false | 14.9443 ± 0.3798 | 1.5327 | 2.8704 | 64.1239 | 70.6966 |
| en-05* | librivox-19 | unknown | true | 14.9652 ± 0.3618 | 16.4648 | 20.5460 | 51.6983 | 64.2345 |
| en-05* | librivox-19 | unknown | false | 14.1862 ± 0.3618 | 1.8061 | 3.3343 | 63.3910 | 65.1041 |
| en-06* | librivox-30 | unknown | true | 14.9073 ± 0.2448 | 21.3061 | 23.1383 | 67.0395 | 72.5802 |
| en-06* | librivox-30 | unknown | false | 13.6975 ± 0.2448 | 1.7070 | 3.1312 | 61.0533 | 62.1463 |
| ru-01* | librivox-1593 | unknown | true | 14.6308 ± 0.3252 | 17.3747 | 20.5749 | 54.6288 | 64.4421 |
| ru-01* | librivox-1593 | unknown | false | 14.0757 ± 0.3252 | 1.5430 | 3.0117 | 67.8239 | 66.0078 |
| ru-02* | librivox-1593 | unknown | true | 14.3942 ± 0.3533 | 17.4442 | 20.4743 | 54.9952 | 64.3440 |
| ru-02* | librivox-1593 | unknown | false | 14.8416 ± 0.3533 | 1.6861 | 3.2465 | 63.3597 | 71.2319 |
| ru-03* | librivox-1593 | unknown | true | 16.0068 ± 0.4790 | 17.2724 | 20.4988 | 54.3720 | 64.4971 |
| ru-03* | librivox-1593 | unknown | false | 14.6038 ± 0.4790 | 1.1615 | 2.4205 | 62.7442 | 66.9223 |
| ru-04* | librivox-2826 | unknown | true | 20.0000 ± 0.6236 | 17.3187 | 21.4287 | 54.4525 | 67.3226 |
| ru-04* | librivox-2826 | unknown | false | 16.4840 ± 0.3893 | 2.4055 | 2.5226 | 68.5473 | 67.4203 |
| ru-05* | librivox-3056 | unknown | true | 17.7857 ± 0.6495 | 23.3675 | 30.9732 | 71.3726 | 94.3015 |
| ru-05* | librivox-3056 | unknown | false | 13.2887 ± 0.2625 | 2.1401 | 3.9456 | 79.2779 | 80.2935 |
| ru-06* | librivox-3056 | unknown | true | 13.9635 ± 0.2420 | 19.4069 | 23.1728 | 61.0901 | 72.7036 |
| ru-06* | librivox-3056 | unknown | false | 13.6186 ± 0.2420 | 2.3215 | 2.7925 | 69.8468 | 71.1537 |
| hi-01* | librivox-19651 | unknown | true | 13.9380 ± 0.2322 | 18.1928 | 19.3636 | 57.2144 | 60.7573 |
| hi-01* | librivox-19651 | unknown | false | 14.0696 ± 0.2322 | 2.5003 | 3.2227 | 61.8761 | 67.3812 |
| hi-02* | librivox-19651 | unknown | true | 13.9658 ± 0.2220 | 18.0101 | 17.3978 | 56.6512 | 54.5916 |
| hi-02* | librivox-19651 | unknown | false | 14.2250 ± 0.2220 | 1.4406 | 2.2586 | 60.3462 | 61.8273 |
| hi-03* | librivox-19651 | unknown | true | 15.4731 ± 0.3036 | 17.1818 | 20.7538 | 53.9192 | 65.0492 |
| hi-03* | librivox-19651 | unknown | false | 14.6009 ± 0.2115 | 1.7059 | 3.2455 | 63.7482 | 66.0793 |
| hi-04* | librivox-19651 | unknown | true | 13.9556 ± 0.1660 | 16.8897 | 17.8248 | 53.1513 | 55.9949 |
| hi-04* | librivox-19651 | unknown | false | 14.1645 ± 0.1352 | 1.5173 | 2.4875 | 61.3437 | 61.1789 |
| hi-05* | librivox-19651 | unknown | true | 13.7508 ± 0.3413 | 15.2300 | 17.9528 | 47.6794 | 56.0560 |
| hi-05* | librivox-19651 | unknown | false | 13.1312 ± 0.2687 | 3.3812 | 4.1636 | 58.2513 | 60.8012 |
| hi-06* | librivox-19651 | unknown | true | 13.9500 ± 0.2571 | 16.4828 | 16.5641 | 51.8786 | 51.8405 |
| hi-06* | librivox-19651 | unknown | false | 13.5958 ± 0.1899 | 2.5953 | 3.4106 | 61.7490 | 63.7041 |
| zh-01* | librivox-2245 | unknown | true | 16.6307 ± 0.3749 | 18.5031 | 25.7132 | 57.9008 | 80.1261 |
| zh-01* | librivox-2245 | unknown | false | 14.5997 ± 0.3265 | 1.8134 | 3.6075 | 80.4592 | 73.8623 |
| zh-02* | librivox-2245 | unknown | true | 13.9977 ± 0.2510 | 17.9390 | 21.6078 | 56.0948 | 67.4661 |
| zh-02* | librivox-2245 | unknown | false | 12.5826 ± 0.2510 | 2.4668 | 3.6211 | 79.2964 | 77.6084 |
| zh-03* | librivox-2245 | unknown | true | 17.5176 ± 0.7030 | 17.9247 | 25.5055 | 55.7842 | 79.6788 |
| zh-03* | librivox-2245 | unknown | false | 14.6472 ± 0.3095 | 1.9066 | 3.6940 | 71.3431 | 71.8285 |
| zh-04* | librivox-2245 | unknown | true | 16.0967 ± 0.3533 | 18.5865 | 25.7353 | 58.4149 | 80.7694 |
| zh-04* | librivox-2245 | unknown | false | 14.4130 ± 0.3533 | 2.0300 | 3.1314 | 79.2313 | 81.7124 |
| zh-05* | librivox-2245 | unknown | true | 14.5726 ± 0.4014 | 18.0429 | 25.8755 | 56.3999 | 80.9852 |
| zh-05* | librivox-2245 | unknown | false | 13.2386 ± 0.2736 | 2.0403 | 3.4963 | 76.3492 | 73.5587 |
| zh-06* | librivox-2245 | unknown | true | 16.1311 ± 0.4468 | 17.3850 | 22.0833 | 54.3201 | 68.9182 |
| zh-06* | librivox-2245 | unknown | false | 13.6624 ± 0.2361 | 2.3518 | 2.8718 | 72.7141 | 74.7573 |

All fitted values and SDs are in the JSON report. Plausibility reference:
female tract 14–15 cm; male tract 16–18 cm. These are descriptive references, not gates.
Manifest sex is retained verbatim, including unknown; it is not inferred from the fit.
Ungated targets: distance at most half the preset for 80% of recordings;
MCD at least 0.5 dB better than the preset.
Measured half-distance share: 0.0625.
Measured MCD improvement share: 0.7708.
