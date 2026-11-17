# Engine parity: single-thread render times

Measured on 2026-11-17 by [Heavy checks run 44061935584](https://github.com/konard/voice-simulator/actions/runs/44061935584), commit `3badd0fd04334414634251666301ae3d7eff684e`. All five performance test files passed (75 tests) with no item limit.

Intel Xeon 6975P-C, four cores. Scalar build SHA-256: `b4ec06751b7e03541ee6aa026f04f33ebd616b9970f54d2ee4665afcacebccb2`. Subsequent changes adjust mixed-language decoding costs and invalid-option diagnostics; audio rendering is unchanged.

Node v24.22.2, linux x64; seed 82; scalar wasm, one thread. Includes renderer construction, frame preparation and samples. Each engine warms once, then renders for at least 2 seconds and at least 3 runs; times are medians. Every feature and every tier.

| Kind | Feature or tier | Audio (s) | JS (s) | Rust (s) | Rust / JS | Runs JS / Rust |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| feature | solver.waveguide | 0.723 | 0.014290 | 0.010029 | 0.7018 | 136 / 195 |
| feature | solver.fdtd3d | 0.592 | 0.129343 | 0.120918 | 0.9349 | 16 / 17 |
| feature | solver.fdtd2d | 0.734 | 0.057148 | 0.038143 | 0.6674 | 35 / 53 |
| feature | source.lf | 0.723 | 0.015019 | 0.010009 | 0.6664 | 131 / 198 |
| feature | source.folds | 0.723 | 0.014417 | 0.009483 | 0.6578 | 137 / 209 |
| feature | source.tract-interaction | 0.723 | 0.016625 | 0.010421 | 0.6268 | 118 / 190 |
| feature | source.subglottal | 0.723 | 0.018220 | 0.011306 | 0.6205 | 109 / 175 |
| feature | noise.turbulence | 0.863 | 0.018741 | 0.012137 | 0.6476 | 106 / 163 |
| feature | losses.frequency | 0.723 | 0.015524 | 0.010021 | 0.6455 | 128 / 197 |
| feature | filters.output | 0.723 | 0.015602 | 0.009978 | 0.6395 | 127 / 198 |
| feature | radiation | 0.723 | 0.015492 | 0.009993 | 0.6451 | 127 / 198 |
| feature | listener.microphone | 0.723 | 0.015718 | 0.010008 | 0.6367 | 125 / 197 |
| feature | listener.room | 0.592 | 0.019695 | 0.011873 | 0.6028 | 101 / 167 |
| feature | mode.whisper | 0.862 | 0.027208 | 0.015272 | 0.5613 | 74 / 130 |
| feature | mode.phonation | 0.669 | 0.018709 | 0.010814 | 0.5780 | 106 / 183 |
| feature | mode.effort | 0.625 | 0.017645 | 0.008316 | 0.4713 | 112 / 238 |
| feature | articulators | 0.723 | 0.021061 | 0.010487 | 0.4979 | 94 / 188 |
| feature | tier.narrowband | 0.723 | 0.011890 | 0.006242 | 0.5249 | 165 / 315 |
| tier | tier.telephone | 1.622 | 0.027559 | 0.016965 | 0.6156 | 72 / 116 |
| tier | tier.narrowband | 1.622 | 0.035530 | 0.021417 | 0.6028 | 57 / 91 |
| tier | tier.wideband | 1.622 | 0.047317 | 0.026991 | 0.5704 | 43 / 73 |
| tier | tier.minimal | 1.622 | 0.047670 | 0.026839 | 0.5630 | 42 / 74 |
| tier | tier.low | 1.622 | 0.072698 | 0.044040 | 0.6058 | 28 / 45 |
| tier | tier.medium | 1.622 | 0.106846 | 0.066663 | 0.6239 | 19 / 30 |
| tier | tier.high | 1.622 | 0.755980 | 0.679653 | 0.8990 | 3 / 3 |
| tier | tier.ultra | 1.622 | 4.033386 | 3.689666 | 0.9148 | 3 / 3 |
| tier | tier.studio | 1.622 | 7.615177 | 7.032726 | 0.9235 | 3 / 3 |
| tier | tier.reference | 1.622 | 17.511229 | 16.169201 | 0.9234 | 3 / 3 |

Command: `npm run test:heavy -- --suite performance` (built wasm required).
