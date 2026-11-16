---
'voice-simulator': minor
---

Whisper: `[whisper]`, `{W … W}`, `<vs:phonation name="whisper">`, `<vs:effort level="whisper">`, `ạ` and voiceless vowels and sonorants (`ḁ`, `l̥`) fill a new plan channel `whisper` that replaces the fold vibration by the turbulent noise of a half-open glottis (40 mm², 20 mm² for a stage whisper). A whisper has no voicing, higher formants (the glottal reflection is lowered), segments 1.3 times as long, a level 25 dB below the voice (30 dB soft, 20 dB loud), a level cue of the intended pitch and the contrast of voiced and voiceless consonants; whispery voice (`{Ṿ … Ṿ}`) mixes pulses and noise. New measures `voicedShare()`, `frameAperiodicities()`, `energyRatio()` and `centreOfGravity()`. The Rust engine leaves plans that whisper to the JavaScript renderer; plain text renders the same samples.
