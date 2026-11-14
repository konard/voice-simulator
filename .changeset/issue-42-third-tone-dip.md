---
'voice-simulator': patch
---

Speak the dip of the Mandarin third tone (issue 42). Every Chao level of a tone is now a pitch target: `syllablePitch()` returns one pitch per level (`tonePitch()`), `pitchTargets()` adds the full list as `points`, and the pitch plan draws a piecewise linear curve through them, with the low point of a three-level tone at 40 % of the vowel (`TONE_POINT_POSITIONS`). The f0 smoothing still connects the syllables but keeps the shape of a contour tone inside its vowel, so `ma˨˩˦` falls from about 104 Hz at 10 % of the vowel to 97 Hz at 45 % and then rises to 132 Hz; before, it only rose. Level, rising and falling tones and syllables without a tone are unchanged. The issue 11 audit now takes the f0 quartiles over the voiced frames only.
