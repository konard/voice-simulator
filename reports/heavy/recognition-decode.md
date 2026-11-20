# Articulation-to-IPA decoder benchmark

Run `node --test tests/heavy/recognition-decode.test.js` to reproduce. Add `--test-name-pattern=golden` before the file argument to run only the golden cohort. Phone and broad-class error are mean per-recording edit rates. For broad-class error, both strings are mapped from IPA to phoneme manner classes before alignment. The synthetic targets are from the waveguide plan. Golden speakers each have one head fitted without refinement from all their recordings, with the supplied IPA used only for scoring.

<!-- prettier-ignore -->
| Corpus | Language | Working rate (Hz) | Language input | Items | Phone error | Broad-class error |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| golden | en | 16000 | given | 6 | 81.44% | 56.16% |
| golden | en | 16000 | unspecified | 6 | 99.18% | 68.46% |
| golden | en | 8000 | given | 6 | 83.33% | 57.05% |
| golden | en | 8000 | unspecified | 6 | 95.23% | 66.70% |
| golden | hi | 16000 | given | 6 | 83.48% | 40.58% |
| golden | hi | 16000 | unspecified | 6 | 97.68% | 42.87% |
| golden | hi | 8000 | given | 6 | 81.13% | 39.74% |
| golden | hi | 8000 | unspecified | 6 | 94.84% | 43.07% |
| golden | ru | 16000 | given | 6 | 84.94% | 49.59% |
| golden | ru | 16000 | unspecified | 6 | 96.82% | 57.86% |
| golden | ru | 8000 | given | 6 | 86.68% | 49.37% |
| golden | ru | 8000 | unspecified | 6 | 93.92% | 56.41% |
| golden | zh | 16000 | given | 6 | 95.16% | 53.12% |
| golden | zh | 16000 | unspecified | 6 | 121.67% | 92.96% |
| golden | zh | 8000 | given | 6 | 94.92% | 54.93% |
| golden | zh | 8000 | unspecified | 6 | 122.40% | 92.57% |
| synthetic | en | 16000 | given | 50 | 82.97% | 51.37% |
| synthetic | en | 16000 | unspecified | 50 | 89.02% | 53.12% |
| synthetic | en | 8000 | given | 50 | 82.55% | 50.75% |
| synthetic | en | 8000 | unspecified | 50 | 88.35% | 53.41% |
| synthetic | hi | 16000 | given | 50 | 84.65% | 42.41% |
| synthetic | hi | 16000 | unspecified | 50 | 95.54% | 44.77% |
| synthetic | hi | 8000 | given | 50 | 85.59% | 42.46% |
| synthetic | hi | 8000 | unspecified | 50 | 96.26% | 45.48% |
| synthetic | ru | 16000 | given | 50 | 80.54% | 49.70% |
| synthetic | ru | 16000 | unspecified | 50 | 88.07% | 50.84% |
| synthetic | ru | 8000 | given | 50 | 82.09% | 48.98% |
| synthetic | ru | 8000 | unspecified | 50 | 88.83% | 49.46% |
| synthetic | zh | 16000 | given | 50 | 73.72% | 38.31% |
| synthetic | zh | 16000 | unspecified | 50 | 89.14% | 51.16% |
| synthetic | zh | 8000 | given | 50 | 77.32% | 39.81% |
| synthetic | zh | 8000 | unspecified | 50 | 96.08% | 55.45% |

With the language given, the golden-set mean across both rates is **86.38%** phone error and **50.07%** broad-class error. The research targets are 60.00% and 35.00%, respectively.

Long-term reference: **32.7%** phone error for the trained Kaldi monophone recognizer on the 39-phone TIMIT core test set. [Kaldi TIMIT results](https://github.com/kaldi-asr/kaldi/blob/master/egs/timit/s5/RESULTS)

Golden references reviewed by a speaker: 0 of 24.
