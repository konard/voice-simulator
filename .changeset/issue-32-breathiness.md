---
'voice-simulator': patch
---

Make `breathiness` audible and measurable: it lengthens the open phase of the glottal pulse and raises the breath noise from 40 dB below the pulses at the default 0.2 to 10 dB below them at 1. Measure HNR above 400 Hz at the best fractional lag on pitch-straightened frames and take the upper quartile over frames, so that it falls by about 20 dB from breathiness 0 to 1 and a noise-free gliding voice reads clean. Match breathiness with the measured HNR slope and tenseness through the pulse shape it controls, and raise the preset tenseness ranges so that the preset pulses stay the same.
