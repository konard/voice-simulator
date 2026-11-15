---
'voice-simulator': patch
---

Add `scripts/quality-report.mjs` and the heavy test `quality-baseline`: every
sentence of the golden set on every tier against its recording, with a low-pass
and a white-noise anchor; the first result is `docs/reports/baseline-quality.md`.
LSD and MCD now floor spectra 60 dB below their peak (`DYNAMIC_RANGE_DB`,
`powerFloor`, option `range`) and skip only the frame pairs whose reference
frame is silent, so white noise no longer scores closer to speech than a voice.
