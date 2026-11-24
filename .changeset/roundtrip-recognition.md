---
'voice-simulator': patch
---

Measure recognition of the simulator's own audio across four languages, nine
audio tiers and four voice presets. Report transcription accuracy, syllable
timing, prosody and speed, including whispered and loud speech.
Check periodicity when evaluating weak whisper evidence in telephone speech.
Keep confirmed telephone whispers together across an intervening aperiodic
speech run when the combined audio still has whisper evidence.
Keep confirmed narrowband whispers together across brief spurious pitch
detections while preserving sustained voiced interruptions.
Reduce cold-start work when building the reverse pronunciation dictionaries.
Rank isolated 16 kHz vowels against waveguide renders when a voice is supplied.
Verify short 16 kHz preset-voice recordings against waveguide renders when copying.
Recognise words by default with a Gaussian HMM over the lexicons of all four
languages (`decoder: 'words'`), trained only on the simulator's own speech.
Spell words outside the vocabulary with a per-language phone loop (`oov`,
on by default; `--no-oov` on the command line). The previous phone decoder
stays available as `decoder: 'phones'` (`--decoder phones`). The HMM state
scores and LDA projection also run in the Rust engine. A tone stream of
pitch-shape mixtures helps the word decoder tell Mandarin tones apart, and
pitches more than an octave from the median are ignored.
