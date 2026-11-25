---
'voice-simulator': patch
---

Align the round-trip mode check with the voice-baseline contract of mode
recognition. Without the voice, the loud case now speaks a sentence neutrally
and then loudly and expects the heard arousal to rise by at least 0.3, and a
whole loud sentence is a negative control that must get no effort label. A
calibrated, mode-only lane hears the whole loud sentence with its voice and
expects `f`, while the phone and language round trips stay audio-only. The
report lists the lane, label and matched/expected spans per language.
