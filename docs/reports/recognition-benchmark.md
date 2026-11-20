# Recognition benchmark on public recordings

The runner verified all six recording sources and the AISHELL-3 text index.
Benchmarking the first 25 rows of each FLEURS set and all 20 rows of both
additional corpora took 64.05 minutes for the full recognition suite on one
core. The quality floors blocked the initial baseline. Both benchmark reports
were uploaded, and the artifact contained no audio. [Workflow and artifact](https://github.com/konard/voice-simulator/actions/runs/44810324118)

Commit: `194809c12e83ed3ade2973b8c9a96e96df941135`

Command: `node scripts/run-heavy.mjs --suite recognition --limit 25`

Benchmark elapsed time: 57.27 minutes. Sample: up to 25 rows per set.

Automatic language identification on all four FLEURS sets at medium: 28/87 (32.2%).

### fleurs-en

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 23 | 2 | 3.32 | 82.5% | 59.8% | 102.0% | 85.3% | — | 69.6% | 0.97 |
| medium | 23 | 2 | 3.32 | 82.8% | 57.2% | 107.0% | 85.6% | — | 60.9% | 1.31 |
| high | 23 | 2 | 3.32 | 82.8% | 57.0% | 107.5% | 86.7% | — | 52.2% | 1.65 |
| medium (known language) | 23 | 2 | 3.32 | 78.7% | 54.4% | 106.6% | 76.6% | — | 100.0% | 0.71 |

### fleurs-ru

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 22 | 3 | 3.83 | 83.8% | 60.2% | 109.3% | 90.3% | — | 45.5% | 0.68 |
| medium | 22 | 3 | 3.83 | 83.6% | 55.5% | 130.7% | 89.4% | — | 54.5% | 0.70 |
| high | 22 | 3 | 3.83 | 83.6% | 55.4% | 130.4% | 89.4% | — | 54.5% | 1.07 |
| medium (known language) | 22 | 3 | 3.83 | 81.4% | 53.8% | 117.0% | 79.9% | — | 100.0% | 0.50 |

### fleurs-hi

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 23 | 2 | 4.35 | 87.9% | 52.8% | 103.5% | 99.0% | — | 4.3% | 0.59 |
| medium | 23 | 2 | 4.35 | 87.0% | 49.8% | 112.9% | 98.1% | — | 8.7% | 0.85 |
| high | 23 | 2 | 4.35 | 86.9% | 49.9% | 112.4% | 98.1% | — | 8.7% | 1.40 |
| medium (known language) | 23 | 2 | 4.35 | 81.5% | 47.8% | 99.6% | 85.2% | — | 100.0% | 0.62 |

### fleurs-zh

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 19 | 6 | 3.53 | 88.8% | 65.4% | — | 161.6% | 89.9% | 5.3% | 0.66 |
| medium | 19 | 6 | 3.53 | 90.9% | 66.4% | — | 208.1% | 93.2% | 0.0% | 0.75 |
| high | 19 | 6 | 3.53 | 91.0% | 66.4% | — | 207.9% | 93.2% | 0.0% | 0.96 |
| medium (known language) | 19 | 6 | 3.53 | 85.7% | 58.7% | — | 97.7% | 80.9% | 94.7% | 0.48 |

### libritts-r-dev-clean

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 20 | 0 | 1.72 | 82.8% | 57.4% | 99.4% | 88.5% | — | 55.0% | 0.41 |
| medium | 20 | 0 | 1.72 | 83.8% | 50.7% | 104.8% | 88.2% | — | 45.0% | 0.64 |
| high | 20 | 0 | 1.72 | 83.7% | 50.9% | 104.1% | 88.0% | — | 50.0% | 1.02 |

### sova-rudevices-test

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 20 | 0 | 1.12 | 85.7% | 57.0% | 109.4% | 91.2% | — | 45.0% | 0.29 |
| medium | 20 | 0 | 1.12 | 86.2% | 55.2% | 116.5% | 93.6% | — | 20.0% | 0.51 |
| high | 20 | 0 | 1.12 | 86.2% | 55.2% | 116.5% | 93.6% | — | 20.0% | 0.65 |

## Phone confusions

The ten most frequent substitutions per language pool the three automatic levels across measured sets. Edit counts also include insertions and deletions.

- en: ə → t (50), ɪ → ə (49), n → t (33), n → ɪ (32), s → k (31), ə → k (31), ɪ → k (29), n → k (28), l → t (24), s → j (24)
- ru: j → k (36), ə → t (32), ɪ → k (29), ɪ → ə (28), ɪ → ɨ (28), ɪ → t (27), ə → ɪ (26), ɨ → k (25), n → k (24), j → t (23)
- hi: aː → t (49), aː → ɪ (36), ɾ → t (35), eː → t (32), eː → ɪ (31), ɾ → ɪ (31), t̪ → a (30), ə → ɪ (30), aː → ə (29), k → a (27)
- zh: i → t (34), ŋ → k (29), w → k (27), n → k (26), j → k (23), ʊ → t (23), a → k (22), i → k (22), n → t (22), ɛ → ə (22)

## AISHELL-3 tone reference

149/6088 aligned tones differ (2.4%). Compared 500 lines with 6088 usable pinyin syllables. Full and half third tones both count as tone 3 in this audit.

## Stage diagnosis

The most frequent Mandarin substitutions include `i → t` (34),
`ŋ → k` (29), `w → k` (27), and `n → k` (26). All four cross broad
sound classes.

`node experiments/issue-76-recognition-stages.mjs` measured the first five
FLEURS rows per language at medium. Sixteen rows remained after skipping
references with digits. The acoustic decoder made 1,187 errors over 1,385
reference phones (85.7% PER), and the final recognizer made 1,190 (85.9%).
The final recognizer got the language right on 5 of 16 recordings. The
language identifier got 16 of 16 right when given the dictionary IPA. Feeding that
IPA and the language to the text decoder gave 10.3% CER (128/1,243), versus
100.1% end to end (1,244/1,243). The similar phone error rates before and
after language and text decoding point to acoustic decoding as the main
source of phone errors. [Stage probe](../../experiments/issue-76-recognition-stages.mjs) · [Acoustic decoder issue](https://github.com/konard/voice-simulator/issues/66)

## Coverage and gates

- no baseline
- FLEURS medium languageRight: 28/87 < 50%
- fleurs-ru low classErr: 0.6023688663282571 must be below 0.6
- fleurs-zh low classErr: 0.654178674351585 must be below 0.6
- fleurs-zh medium classErr: 0.6635446685878963 must be below 0.6
- fleurs-zh high classErr: 0.6642651296829971 must be below 0.6

- Class errors at most 20.0%: not reached yet across all runs (0/18 measured runs met it).
- PER at most 50.0%: not reached yet across all runs (0/18 measured runs met it).

## Other runner measurements

The first no-limit run took 71.45 minutes and the run with `--limit 50`
after merging main took 72.45 minutes. Both timed out probing Russian and
Mandarin FLEURS availability before the download change. The 50-row runtime
for all six corpora still requires a complete-source run. [First no-limit run](https://github.com/konard/voice-simulator/actions/runs/44798558209) · [Run after merging main](https://github.com/konard/voice-simulator/actions/runs/44805666981)

The one-row smoke run measured all six corpora in 4.57 minutes. It also
failed quality floors. A local baseline-update probe repeated its non-timing
scores and refused to save an initial baseline. [One-row workflow](https://github.com/konard/voice-simulator/actions/runs/44800994287)

## Data

- `fleurs-en` · FLEURS, English (United States), validation split. [CC-BY-4.0](https://huggingface.co/datasets/google/fleurs). Conneau et al. (2022). FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech. arXiv:2205.12446. [Dataset](https://huggingface.co/datasets/google/fleurs)
- `fleurs-ru` · FLEURS, Russian, validation split. [CC-BY-4.0](https://huggingface.co/datasets/google/fleurs). Conneau et al. (2022). FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech. arXiv:2205.12446. [Dataset](https://huggingface.co/datasets/google/fleurs)
- `fleurs-hi` · FLEURS, Hindi, validation split. [CC-BY-4.0](https://huggingface.co/datasets/google/fleurs). Conneau et al. (2022). FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech. arXiv:2205.12446. [Dataset](https://huggingface.co/datasets/google/fleurs)
- `fleurs-zh` · FLEURS, Mandarin Chinese (simplified), validation split. [CC-BY-4.0](https://huggingface.co/datasets/google/fleurs). Conneau et al. (2022). FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech. arXiv:2205.12446. [Dataset](https://huggingface.co/datasets/google/fleurs)
- `libritts-r-dev-clean` · LibriTTS-R, English dev.clean split, first 20 rows. [CC-BY-4.0](https://www.openslr.org/141/). Koizumi et al. (2023). LibriTTS-R: A Restored Multi-Speaker Text-to-Speech Corpus. https://arxiv.org/abs/2305.18802 [Dataset](https://huggingface.co/datasets/mythicinfinity/libritts_r)
- `sova-rudevices-test` · SOVA RuDevices, Russian test split, first 20 rows. [CC-BY-4.0](https://github.com/sovaai/sova-dataset#license). Virtual Assistant, LLC. SOVA Dataset, RuDevices. https://github.com/sovaai/sova-dataset [Dataset](https://huggingface.co/datasets/bond005/sova_rudevices)
- `aishell3-test-index` · AISHELL-3, transcript index of the test set (test/content.txt: one line per utterance, the WAV file name, then each Chinese character followed by its pinyin with a tone number). [Apache-2.0](https://huggingface.co/datasets/AISHELL/AISHELL-3). Shi, Bu, Xu, Zhang, Li (2021). AISHELL-3: A Multi-speaker Mandarin TTS Corpus. Proc. Interspeech 2021, 2756-2760. https://www.openslr.org/93/ [Dataset](https://huggingface.co/datasets/AISHELL/AISHELL-3)

## How to read this

The phone reference is the dictionary pronunciation of the transcript. It may differ from what the speaker actually said. References containing decimal digits are skipped. Error rates divide the total edit count by the total reference length. The Mandarin tone error rate uses only aligned syllable pairs, and Mandarin WER is omitted. Low recognition uses 8 kHz. RTF is elapsed recognition time divided by audio duration, with recordings processed serially.

The trained Kaldi GMM-HMM monophone recipe published 32.7% PER on the TIMIT core test, and its best listed non-neural system (SGMM2) reported 19.7%. The research notes give 80–90% broad-class accuracy on clean read speech as a first target. The published figures are not comparable to this benchmark because they use a different corpus, trained models and human phone labels. [Kaldi TIMIT results](https://raw.githubusercontent.com/kaldi-asr/kaldi/master/egs/timit/s5/RESULTS) · [Research notes](https://github.com/konard/voice-simulator/blob/main/docs/case-studies/issue-11/research/2-inversion-and-recognition.md#7-evaluation-without-neural-networks).
