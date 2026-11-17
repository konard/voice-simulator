# Speech-mode recognition measurements

Command: `node --test --test-timeout=600000 tests/heavy/recognition-modes.test.js`.

RESD (Aniemore/resd, MIT metadata): first 100 rows of the test split.
Activation accuracy: 55.0%. Name accuracy: 11.0%.
Golden false alarms (whisper or emotion): 1/24.

The committed baseline records the initial pre-merge calibration of the
corrected phrase range; gates are
five percentage points below it. Limited runs do not establish a new baseline.

RESD has no transcripts. Its evaluation uses vowel-like periodic intervals
(40–250 ms), not a speech-to-text system, and the generic male voice baseline.
The seven-label mapping is {"neutral":"neutral","happiness":"happy","sadness":"sad","anger":"angry","fear":"afraid","disgust":"disgusted","enthusiasm":"surprised"}. Enthusiasm maps to
surprised as an activation proxy; no semantic valence inference is made.
The golden set uses its annotated IPA with proportional neutral phone timing,
without a fitted speaker voice. These alignment and voice limitations apply
to the reported figures; they are not an end-to-end recognition benchmark.

Per-recording decisions are in the JSON artifact.

## Synthetic acceptance matrix

Command: `node --test --test-timeout=30000 tests/recognition-modes.test.js`.
Tier minimal, seed 1, male head, four languages (English, Russian, Hindi,
Mandarin); the detector receives only audio, timed IPA words and the voice.

| Check | Measured | Required |
| --- | --- | --- |
| Plain sentences with no mode | 8/8 | 8/8 |
| Full whisper | 4/4 (100%) | 100% |
| Exact effort | 14/16 (87.5%) | 80% |
| Effort within one step | 16/16 (100%) | 95% |
| Other labels | 39/40 (97.5%) | 85% |
| Full whisper at 8000 Hz | 4/4 (100%) | 100% |
| Other labels at 8000 Hz | 53/56 (94.6%) | 70% |
| Emotion names/classes | 46/48 (95.83%) | 75% |
| Activation signs | 28/28 (100%) | 95% |

All twelve reference names remain separate classes (no pair is closer than
1) in each language: neutral, angry, happy, sad, afraid, bored, surprised,
disgusted, tender, sarcastic, confident, hesitant. Confusions are printed
by the test. Word-boundary, crescendo, unknown-voice and whisper replay
checks pass. Pause sounds, overlapping partial modes and input validation
are checked in `tests/recognition-mode-integration.test.js`.

The initial real-recording gates are activation >=50% and names >=6%
(the measured 55% and 11% minus five percentage points), plus at most one
golden false alarm. The single alarm is a 93 ms whispered-word hypothesis
in ru-06, with proportional phone timing. These low emotion-name figures
are a measured limit of generic-voice acoustic references on real speakers.

The preliminary draft used the median of word pitch spans for its baseline
(63% activation, 18% names). Pooling vowel frames over each entire phrase
corrects that mismatch with the one-word acoustic RESD alignment. The final
55%/11% measurement establishes this new feature's initial 50%/6% gates.
Synthetic acceptance thresholds are unchanged.
