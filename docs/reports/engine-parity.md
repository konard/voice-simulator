# Engine parity: single-thread render times

Measured on 2026-11-17 by [Heavy checks run 44055371834](https://github.com/konard/voice-simulator/actions/runs/44055371834), commit `908f7f7fdda45066976904dece41df4797addad0`. All five performance test files passed (75 tests) with no item limit.

Intel Xeon 6975P-C, four cores. The scalar build SHA-256 is `ef1addd5307bace6722a10802d027671888305dec3db8ea8918f3be615edd653`, identical to the rebuilt implementation after the subsequent test and safety-comment changes (`bf9fe3c` and `a55c663`).

Node v24.22.2, linux x64; seed 82; scalar wasm, one thread. Includes renderer construction, frame preparation and samples. Each engine warms once, then renders for at least 2 seconds and at least 3 runs; times are medians. Every feature and every tier.

| Kind | Feature or tier | Audio (s) | JS (s) | Rust (s) | Rust / JS | Runs JS / Rust |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| feature | solver.waveguide | 0.723 | 0.014743 | 0.010274 | 0.6969 | 132 / 189 |
| feature | solver.fdtd3d | 0.592 | 0.140039 | 0.123275 | 0.8803 | 15 / 16 |
| feature | solver.fdtd2d | 0.734 | 0.056194 | 0.038743 | 0.6894 | 36 / 52 |
| feature | source.lf | 0.723 | 0.015275 | 0.010025 | 0.6563 | 129 / 197 |
| feature | source.folds | 0.723 | 0.014994 | 0.009510 | 0.6342 | 130 / 207 |
| feature | source.tract-interaction | 0.723 | 0.017446 | 0.010437 | 0.5983 | 112 / 189 |
| feature | source.subglottal | 0.723 | 0.019474 | 0.011347 | 0.5827 | 102 / 174 |
| feature | noise.turbulence | 0.863 | 0.019074 | 0.012200 | 0.6396 | 104 / 162 |
| feature | losses.frequency | 0.723 | 0.015796 | 0.010023 | 0.6345 | 124 / 197 |
| feature | filters.output | 0.723 | 0.015798 | 0.010022 | 0.6344 | 125 / 197 |
| feature | radiation | 0.723 | 0.015797 | 0.010020 | 0.6343 | 125 / 198 |
| feature | listener.microphone | 0.723 | 0.016010 | 0.010042 | 0.6272 | 123 / 197 |
| feature | listener.room | 0.592 | 0.020018 | 0.011938 | 0.5964 | 98 / 166 |
| feature | mode.whisper | 0.862 | 0.028056 | 0.015381 | 0.5482 | 71 / 129 |
| feature | mode.phonation | 0.669 | 0.019155 | 0.010909 | 0.5695 | 104 / 182 |
| feature | mode.effort | 0.625 | 0.017861 | 0.008350 | 0.4675 | 111 / 237 |
| feature | articulators | 0.723 | 0.021741 | 0.010516 | 0.4837 | 91 / 187 |
| feature | tier.narrowband | 0.723 | 0.011965 | 0.006283 | 0.5251 | 163 / 312 |
| tier | tier.telephone | 1.622 | 0.027836 | 0.017178 | 0.6171 | 70 / 113 |
| tier | tier.narrowband | 1.622 | 0.036158 | 0.021580 | 0.5968 | 56 / 91 |
| tier | tier.wideband | 1.622 | 0.048063 | 0.027169 | 0.5653 | 42 / 73 |
| tier | tier.minimal | 1.622 | 0.047800 | 0.026816 | 0.5610 | 42 / 74 |
| tier | tier.low | 1.622 | 0.072667 | 0.044102 | 0.6069 | 28 / 45 |
| tier | tier.medium | 1.622 | 0.106554 | 0.066436 | 0.6235 | 19 / 30 |
| tier | tier.high | 1.622 | 0.777388 | 0.679459 | 0.8740 | 3 / 3 |
| tier | tier.ultra | 1.622 | 4.068923 | 3.702027 | 0.9098 | 3 / 3 |
| tier | tier.studio | 1.622 | 7.672268 | 7.061169 | 0.9203 | 3 / 3 |
| tier | tier.reference | 1.622 | 17.542063 | 16.202788 | 0.9237 | 3 / 3 |

Command: `npm run test:heavy -- --suite performance` (built wasm required).
