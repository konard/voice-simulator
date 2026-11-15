---
'voice-simulator': minor
---

Add objective speech metrics (issue 18) in `src/metrics/`: `fft`, `powerFrames`, `melFilterbank` and `mfcc` (26 mel filters, c0 to c13 at 16 kHz); `dtw` with a Sakoe-Chiba band; `logSpectralDistance` and `melCepstralDistortion` (dB); `pitchTrack` (YIN) and `f0Errors` (RMSE and mean in cents, GPE, VDE, FFE, correlation); `formantTrack` and `formantErrors`; `editDistance`, `tokenize` and `errorRate` for word, character and phoneme error rates; and `compareRecordings`, which aligns two recordings by DTW on mel cepstra and reports spectral, pitch, formant and timing distances. The command line tool gains `voice-simulator compare <reference> <test> [--json]`. No dependency is added.
