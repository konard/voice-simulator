---
'voice-simulator': minor
---

Add a second voice source: `source: 'folds'` (CLI `--source folds`) simulates the vocal folds as the two-mass model of Steinecke and Herzel, set into vibration by the lung pressure, so the voice starts and stops by itself and its pitch, loudness and open quotient follow the lung pressure, the fold tension and the adduction. The plan gets the channels `lungPressure`, `adduction` and `foldTension`, the head the parameters `lungPressure`, `foldLength`, `foldMass`, `foldStiffness` and `foldDamping`, and the presets fold lengths for men, women and children. `VocalFolds`, `tensionForPitch`, `DEFAULT_SOURCE` and the fold constants are exported. The LF source stays the default and renders the same samples as before.
