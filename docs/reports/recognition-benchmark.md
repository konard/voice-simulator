# Recognition benchmark on public recordings

This diagnostic run used the first row of each corpus. The full recognition
suite ran for 274 seconds (4.57 minutes) and uploaded the reports. The
quality floors below blocked the initial baseline. [Workflow and artifact](https://github.com/konard/voice-simulator/actions/runs/44800994287)

Commit: `f35d005c86986e58a1b89f6efcfe6d7269c15259`

Command: `node scripts/run-heavy.mjs --suite recognition --limit 1`

Benchmark elapsed time: 2.40 minutes. Sample: up to one row per set.

Automatic language identification on all four FLEURS sets at medium: 2/4 (50.0%).

### fleurs-en

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 1 | 0 | 0.11 | 87.0% | 68.5% | 100.0% | 87.5% | — | 100.0% | 2.59 |
| medium | 1 | 0 | 0.11 | 87.0% | 64.8% | 100.0% | 79.7% | — | 100.0% | 2.37 |
| high | 1 | 0 | 0.11 | 87.0% | 64.8% | 100.0% | 79.7% | — | 100.0% | 0.39 |
| medium (known language) | 1 | 0 | 0.11 | 85.2% | 63.0% | 100.0% | 79.7% | — | 100.0% | 0.23 |

### fleurs-ru

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 1 | 0 | 0.23 | 82.7% | 59.3% | 100.0% | 90.1% | — | 0.0% | 0.63 |
| medium | 1 | 0 | 0.23 | 79.0% | 50.6% | 123.1% | 85.1% | — | 100.0% | 0.33 |
| high | 1 | 0 | 0.23 | 79.0% | 50.0% | 119.2% | 85.1% | — | 100.0% | 0.68 |
| medium (known language) | 1 | 0 | 0.23 | 82.1% | 51.2% | 100.0% | 77.0% | — | 100.0% | 0.28 |

### fleurs-hi

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 1 | 0 | 0.20 | 85.2% | 53.9% | 103.3% | 92.2% | — | 0.0% | 0.24 |
| medium | 1 | 0 | 0.20 | 87.0% | 47.0% | 110.0% | 96.5% | — | 0.0% | 0.50 |
| high | 1 | 0 | 0.20 | 87.0% | 47.0% | 110.0% | 96.5% | — | 0.0% | 1.14 |
| medium (known language) | 1 | 0 | 0.20 | 81.7% | 45.2% | 100.0% | 86.1% | — | 100.0% | 0.40 |

### fleurs-zh

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 1 | 0 | 0.31 | 90.3% | 73.4% | — | 222.7% | 95.2% | 0.0% | 0.78 |
| medium | 1 | 0 | 0.31 | 88.7% | 67.7% | — | 193.2% | 93.9% | 0.0% | 0.33 |
| high | 1 | 0 | 0.31 | 88.7% | 67.7% | — | 193.2% | 94.1% | 0.0% | 0.78 |
| medium (known language) | 1 | 0 | 0.31 | 86.3% | 63.7% | — | 97.7% | 80.0% | 100.0% | 0.28 |

### libritts-r-dev-clean

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 1 | 0 | 0.03 | 87.5% | 62.5% | 100.0% | 100.0% | — | 0.0% | 0.26 |
| medium | 1 | 0 | 0.03 | 79.2% | 54.2% | 128.6% | 93.5% | — | 0.0% | 0.42 |
| high | 1 | 0 | 0.03 | 79.2% | 54.2% | 128.6% | 93.5% | — | 0.0% | 0.50 |

### sova-rudevices-test

<!-- prettier-ignore -->
| Level | Utterances | Skipped | Audio (min) | PER | Class errors | WER | CER | Tone errors | Language right | RTF |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | 1 | 0 | 0.02 | 100.0% | 33.3% | 200.0% | 88.9% | — | 100.0% | 0.40 |
| medium | 1 | 0 | 0.02 | 100.0% | 66.7% | 150.0% | 100.0% | — | 0.0% | 0.47 |
| high | 1 | 0 | 0.02 | 100.0% | 66.7% | 150.0% | 100.0% | — | 0.0% | 0.41 |

## Phone confusions

The ten most frequent substitutions per language pool the three automatic levels across measured sets. Edit counts also include insertions and deletions.

- en: z → ɹ (5), n → m (4), b → j (3), l → k (3), m → t (3), z → ɡ (3), ð → ɨ (3), ɛ → j (3), ɪ → n (3), ʌ → ɡ (3)
- ru: ɐ → ɪ (7), ʊ → ɪ (6), lʲ → k (5), ɪ → ɨ (4), t͡s → ɪ (3), ɕː → t (3), ə → ɪ (3), ɪ → a (3), a → t̪ (2), b → e (2)
- hi: ə → ɨ (5), eː → ɨ (4), k → a (4), t̪ → d (4), t̪ → k (4), t̪ → m (4), aː → dʲ (3), d͡ʒ → a (3), p → ɪ (3), ə → ɪ (3)
- zh: ŋ → t (7), ʊ → t (7), n → t (5), t͡s → k (5), m → k (4), a → ə (3), l → t (3), w → p (3), w → t (3), ɑ → k (3)

## AISHELL-3 tone reference

149/6088 aligned tones differ (2.4%). Compared 500 lines with 6088 usable pinyin syllables. Full and half third tones both count as tone 3 in this audit.

## Stage diagnosis

The Mandarin substitutions include `ŋ → t`, `ʊ → t` and `m → k`. These
cross broad sound classes. The English sample also includes substitutions
such as `z → ɹ` and `m → t` that cross classes.

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
- fleurs-en low classErr: 0.6851851851851852 must be below 0.6
- fleurs-en medium classErr: 0.6481481481481481 must be below 0.6
- fleurs-en high classErr: 0.6481481481481481 must be below 0.6
- fleurs-zh low classErr: 0.7338709677419355 must be below 0.6
- fleurs-zh medium classErr: 0.6774193548387096 must be below 0.6
- fleurs-zh high classErr: 0.6774193548387096 must be below 0.6
- fleurs-zh low cer: 2.227272727272727 exceeds medium 1.9318181818181819 by more than 0.15
- libritts-r-dev-clean low classErr: 0.625 must be below 0.6
- sova-rudevices-test low per: 1 must be below 1
- sova-rudevices-test medium classErr: 0.6666666666666666 must be below 0.6
- sova-rudevices-test medium per: 1 must be below 1
- sova-rudevices-test high classErr: 0.6666666666666666 must be below 0.6
- sova-rudevices-test high per: 1 must be below 1
- sova-rudevices-test low wer: 2 exceeds medium 1.5 by more than 0.15

- Class errors at most 20.0%: not reached yet across all runs (0/18 measured runs met it).
- PER at most 50.0%: not reached yet across all runs (0/18 measured runs met it).

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
