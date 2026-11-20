# Articulation-to-IPA decoder benchmark

Run `node --test tests/heavy/recognition-decode.test.js` to reproduce. Phone and broad-class error are mean per-recording edit rates. For broad-class error, both strings are mapped from IPA to phoneme manner classes before alignment. The synthetic targets are from the waveguide plan. Golden speakers each have one head fitted without refinement from all their recordings, with the supplied IPA used only for scoring.

<!-- prettier-ignore -->
| Corpus | Language | Working rate (Hz) | Language input | Items | Phone error | Broad-class error |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| golden | en | 16000 | given | 6 | 87.11% | 58.10% |
| golden | en | 16000 | unspecified | 6 | 103.10% | 73.63% |
| golden | en | 8000 | given | 6 | 89.45% | 60.89% |
| golden | en | 8000 | unspecified | 6 | 100.58% | 70.71% |
| golden | hi | 16000 | given | 6 | 82.07% | 33.18% |
| golden | hi | 16000 | unspecified | 6 | 97.62% | 43.27% |
| golden | hi | 8000 | given | 6 | 81.89% | 37.40% |
| golden | hi | 8000 | unspecified | 6 | 94.25% | 41.73% |
| golden | ru | 16000 | given | 6 | 85.53% | 48.70% |
| golden | ru | 16000 | unspecified | 6 | 96.32% | 57.95% |
| golden | ru | 8000 | given | 6 | 83.71% | 50.38% |
| golden | ru | 8000 | unspecified | 6 | 95.84% | 57.11% |
| golden | zh | 16000 | given | 6 | 114.34% | 75.34% |
| golden | zh | 16000 | unspecified | 6 | 146.12% | 113.22% |
| golden | zh | 8000 | given | 6 | 121.72% | 75.37% |
| golden | zh | 8000 | unspecified | 6 | 145.37% | 110.16% |
| synthetic | en | 16000 | given | 50 | 82.54% | 48.84% |
| synthetic | en | 16000 | unspecified | 50 | 89.81% | 52.39% |
| synthetic | en | 8000 | given | 50 | 81.36% | 48.79% |
| synthetic | en | 8000 | unspecified | 50 | 90.15% | 53.64% |
| synthetic | hi | 16000 | given | 50 | 86.25% | 37.26% |
| synthetic | hi | 16000 | unspecified | 50 | 98.40% | 46.60% |
| synthetic | hi | 8000 | given | 50 | 87.75% | 38.31% |
| synthetic | hi | 8000 | unspecified | 50 | 97.76% | 45.23% |
| synthetic | ru | 16000 | given | 50 | 83.11% | 43.88% |
| synthetic | ru | 16000 | unspecified | 50 | 91.54% | 44.91% |
| synthetic | ru | 8000 | given | 50 | 83.71% | 44.01% |
| synthetic | ru | 8000 | unspecified | 50 | 90.59% | 44.85% |
| synthetic | zh | 16000 | given | 50 | 85.88% | 43.18% |
| synthetic | zh | 16000 | unspecified | 50 | 104.77% | 57.63% |
| synthetic | zh | 8000 | given | 50 | 77.10% | 38.92% |
| synthetic | zh | 8000 | unspecified | 50 | 103.93% | 52.52% |

With the language given, the golden-set mean across both rates is **93.23%** phone error and **54.92%** broad-class error. The research targets are 60.00% and 35.00%, respectively.

Long-term reference: **32.7%** phone error for the trained Kaldi monophone recognizer on the 39-phone TIMIT core test set. [Kaldi TIMIT results](https://github.com/kaldi-asr/kaldi/blob/master/egs/timit/s5/RESULTS)

Golden references reviewed by a speaker: 0 of 24.
