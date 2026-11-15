---
'voice-simulator': minor
---

Add a 2D acoustic solver, `fdtd2d`: an FDTD solver on the midsagittal sheet of the tract with a depth per cell (`buildSheet`, `Fdtd2d`), where the air passes beside the tongue for laterals and a wide tube shows its transverse resonance. The nose, the piriform fossae and the vallecula are 1D lines (`NoseLine`, now shared with the waveguide). The sheet has its own vowel table, `VOWEL_CORRECTIONS_2D` (`scripts/calibrate-vowels.mjs --solver fdtd2d`), which keeps F1 to F3 of the 11 measured vowels within 1.8 % of the waveguide. Use it with `synthesize(text, { solver: 'fdtd2d', dx })` or `voice-simulator say --solver fdtd2d --dx 0.6`. No tier uses it: its mean log-spectral distance to the 3D solver at 4 to 8 kHz is 13.22 dB against 10.20 dB for the waveguide, although it renders the audit sentence in 2.13 s against 4.99 s for `high`.
