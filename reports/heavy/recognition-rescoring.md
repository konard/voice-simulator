# Analysis-by-synthesis rescoring

Reproduce with `node --test tests/heavy/recognition-rescoring.test.js`. The phone error rate (PER) is the mean per recording. The oracle is the best PER in the original n-best list. Each golden speaker uses one head fitted from their recordings, with transcripts used only for scoring.

Weight: 0.1. Synthetic sentences per language and rate: 50. Golden references confirmed by a speaker: 0.

<!-- prettier-ignore -->
| Corpus | Language | Hz | Recordings | PER before | PER after | Oracle | Regions changed / scored | Right | Wrong | Neutral |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| synthetic | all | 16000 | 200 | 80.47% | 78.74% | 75.46% | 214/666 (32.13%) | 76 | 18 | 120 |
| synthetic | all | 8000 | 200 | 81.89% | 80.38% | 76.55% | 235/676 (34.76%) | 77 | 25 | 133 |
| synthetic | en | 16000 | 50 | 82.97% | 81.04% | 77.16% | 50/194 (25.77%) | 20 | 3 | 27 |
| synthetic | en | 8000 | 50 | 82.55% | 79.84% | 75.97% | 68/185 (36.76%) | 29 | 6 | 33 |
| synthetic | ru | 16000 | 50 | 80.54% | 78.70% | 75.72% | 31/147 (21.09%) | 15 | 1 | 15 |
| synthetic | ru | 8000 | 50 | 82.09% | 81.54% | 75.96% | 48/152 (31.58%) | 12 | 7 | 29 |
| synthetic | hi | 16000 | 50 | 84.65% | 83.57% | 80.73% | 68/153 (44.44%) | 16 | 8 | 44 |
| synthetic | hi | 8000 | 50 | 85.59% | 84.70% | 82.76% | 59/144 (40.97%) | 14 | 4 | 41 |
| synthetic | zh | 16000 | 50 | 73.72% | 71.63% | 68.25% | 65/172 (37.79%) | 25 | 6 | 34 |
| synthetic | zh | 8000 | 50 | 77.32% | 75.45% | 71.51% | 60/195 (30.77%) | 22 | 8 | 30 |
| golden | all | 16000 | 24 | 86.25% | 86.12% | 83.51% | 27/117 (23.08%) | 4 | 7 | 16 |
| golden | all | 8000 | 24 | 86.52% | 86.50% | 84.05% | 29/145 (20.00%) | 4 | 3 | 22 |
| golden | en | 16000 | 6 | 81.44% | 82.54% | 79.91% | 9/35 (25.71%) | 0 | 2 | 7 |
| golden | en | 8000 | 6 | 83.33% | 83.33% | 80.19% | 6/33 (18.18%) | 0 | 0 | 6 |
| golden | ru | 16000 | 6 | 84.94% | 86.39% | 79.90% | 7/23 (30.43%) | 0 | 4 | 3 |
| golden | ru | 8000 | 6 | 86.68% | 86.14% | 83.12% | 7/42 (16.67%) | 2 | 1 | 4 |
| golden | hi | 16000 | 6 | 83.48% | 80.53% | 79.73% | 7/31 (22.58%) | 3 | 0 | 4 |
| golden | hi | 8000 | 6 | 81.13% | 81.62% | 78.47% | 8/35 (22.86%) | 2 | 2 | 4 |
| golden | zh | 16000 | 6 | 95.16% | 95.02% | 94.52% | 4/28 (14.29%) | 1 | 1 | 2 |
| golden | zh | 8000 | 6 | 94.92% | 94.92% | 94.42% | 8/35 (22.86%) | 0 | 0 | 8 |

Synthetic PER was **81.18% → 79.56%** (2.00% relative reduction, target 10%). Golden PER was **86.38% → 86.31%** (target no increase at either working rate).

A right or wrong revision lowered or raised utterance PER when compared with the same final reading with only that region reverted. A neutral revision left PER unchanged.
