# Analysis-by-synthesis rescoring

Reproduce with `node --test tests/heavy/recognition-rescoring.test.js`. The phone error rate (PER) is the mean per recording. The oracle is the best PER in the original n-best list. Each golden speaker uses one head fitted from their recordings, with transcripts used only for scoring.

Weight: 0.5. Synthetic sentences per language and rate: 50. Golden references confirmed by a speaker: 0.

<!-- prettier-ignore -->
| Corpus | Language | Hz | Recordings | PER before | PER after | Oracle | Regions changed / scored | Right | Wrong | Neutral |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| synthetic | en | 16000 | 50 | 82.97% | 79.73% | 77.16% | 77/194 (39.69%) | 31 | 5 | 41 |
| synthetic | en | 8000 | 50 | 82.55% | 79.56% | 75.97% | 87/185 (47.03%) | 35 | 11 | 41 |
| synthetic | ru | 16000 | 50 | 80.54% | 79.47% | 75.72% | 55/146 (37.67%) | 18 | 7 | 30 |
| synthetic | ru | 8000 | 50 | 82.09% | 80.90% | 75.96% | 66/152 (43.42%) | 18 | 8 | 40 |
| synthetic | hi | 16000 | 50 | 84.65% | 83.49% | 80.73% | 83/153 (54.25%) | 18 | 9 | 56 |
| synthetic | hi | 8000 | 50 | 85.59% | 85.02% | 82.76% | 69/144 (47.92%) | 12 | 6 | 51 |
| synthetic | zh | 16000 | 50 | 73.72% | 71.28% | 68.25% | 86/172 (50.00%) | 30 | 9 | 47 |
| synthetic | zh | 8000 | 50 | 77.32% | 75.89% | 71.51% | 80/195 (41.03%) | 23 | 12 | 45 |
| golden | en | 16000 | 6 | 83.38% | 85.20% | 81.85% | 14/30 (46.67%) | 0 | 5 | 9 |
| golden | en | 8000 | 6 | 83.33% | 82.58% | 80.19% | 10/33 (30.30%) | 1 | 0 | 9 |
| golden | ru | 16000 | 6 | 84.94% | 86.05% | 79.90% | 8/23 (34.78%) | 1 | 4 | 3 |
| golden | ru | 8000 | 6 | 86.68% | 86.76% | 83.12% | 15/42 (35.71%) | 2 | 2 | 11 |
| golden | hi | 16000 | 6 | 83.48% | 80.53% | 79.73% | 9/31 (29.03%) | 3 | 0 | 6 |
| golden | hi | 8000 | 6 | 81.13% | 82.12% | 78.47% | 10/35 (28.57%) | 2 | 3 | 5 |
| golden | zh | 16000 | 6 | 95.16% | 95.02% | 94.52% | 4/28 (14.29%) | 1 | 1 | 2 |
| golden | zh | 8000 | 6 | 94.92% | 94.92% | 94.42% | 11/35 (31.43%) | 0 | 0 | 11 |

Synthetic PER was **81.18% → 79.42%** (2.17% relative reduction, target 10%). Golden PER was **86.63% → 86.65%** (target no increase).

A right or wrong revision lowered or raised utterance PER when compared with the same final reading with only that region reverted. A neutral revision left PER unchanged.
