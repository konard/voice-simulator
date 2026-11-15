---
'voice-simulator': patch
---

Bring the nasal murmur of the 3D solver down to the level of the waveguide. The velar port of the waveguide now conserves the low-frequency flow, so [a] and [m] gain the same at 50 Hz. The 3D solver opens the velar port and the nostrils with exactly the requested areas at every grid step. A new `nasalLoss` head parameter scales the wall losses of the nose, and `tubeTransfer` can model a nasal branch and report the flow of the lips or of the nostrils alone with `output`. In `ˈama`, [m] / [a] is now 1.12 on the 3D high tier against 1.19 in the waveguide, where it used to be 11.7 dB above it. The 0.25–0.5 target is not reached: the first harmonic of the vowel keeps the ratio above about 0.71.
