# Engine parity: single-thread render times

Measured on 2026-11-17 by [Heavy checks run 44044547448](https://github.com/konard/voice-simulator/actions/runs/44044547448), commit `6e2c4487e2aea60443d4f8738ae170ed4ea57e9e`. All five performance test files passed with no item limit. The final report commit changes documentation only.

Node v24.22.2, linux x64; seed 82; scalar wasm, one thread. Includes renderer construction, frame preparation and samples. Each engine warms once, then renders for at least 2 seconds and at least 3 runs; times are medians. Every feature and every tier.

| Kind | Feature or tier | Audio (s) | JS (s) | Rust (s) | Rust / JS | Runs JS / Rust |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| feature | solver.waveguide | 0.723 | 0.014953 | 0.010295 | 0.6885 | 128 / 190 |
| feature | solver.fdtd3d | 0.592 | 0.132884 | 0.125132 | 0.9417 | 15 / 16 |
| feature | solver.fdtd2d | 0.734 | 0.057980 | 0.039196 | 0.6760 | 35 / 51 |
| feature | source.lf | 0.723 | 0.015380 | 0.010151 | 0.6600 | 128 / 195 |
| feature | source.folds | 0.723 | 0.015200 | 0.009555 | 0.6286 | 128 / 207 |
| feature | source.tract-interaction | 0.723 | 0.017554 | 0.010600 | 0.6039 | 111 / 187 |
| feature | source.subglottal | 0.723 | 0.019706 | 0.011410 | 0.5790 | 100 / 173 |
| feature | noise.turbulence | 0.863 | 0.019254 | 0.012310 | 0.6394 | 103 / 161 |
| feature | losses.frequency | 0.723 | 0.015998 | 0.010182 | 0.6365 | 123 / 194 |
| feature | filters.output | 0.723 | 0.016111 | 0.010169 | 0.6312 | 123 / 195 |
| feature | radiation | 0.723 | 0.015987 | 0.010165 | 0.6358 | 124 / 195 |
| feature | listener.microphone | 0.723 | 0.016221 | 0.010152 | 0.6259 | 121 / 194 |
| feature | listener.room | 0.592 | 0.020241 | 0.012099 | 0.5978 | 98 / 163 |
| feature | mode.whisper | 0.862 | 0.028419 | 0.015591 | 0.5486 | 70 / 127 |
| feature | mode.phonation | 0.669 | 0.019706 | 0.011064 | 0.5615 | 101 / 179 |
| feature | mode.effort | 0.625 | 0.018478 | 0.008441 | 0.4568 | 108 / 234 |
| feature | articulators | 0.723 | 0.022322 | 0.010623 | 0.4759 | 89 / 185 |
| feature | tier.narrowband | 0.723 | 0.012089 | 0.006345 | 0.5248 | 161 / 310 |
| tier | tier.telephone | 1.622 | 0.028345 | 0.017425 | 0.6148 | 69 / 111 |
| tier | tier.narrowband | 1.622 | 0.036731 | 0.021788 | 0.5932 | 55 / 90 |
| tier | tier.wideband | 1.622 | 0.048425 | 0.027356 | 0.5649 | 42 / 72 |
| tier | tier.minimal | 1.622 | 0.047995 | 0.027233 | 0.5674 | 42 / 72 |
| tier | tier.low | 1.622 | 0.073544 | 0.044805 | 0.6092 | 28 / 44 |
| tier | tier.medium | 1.622 | 0.108797 | 0.067779 | 0.6230 | 19 / 30 |
| tier | tier.high | 1.622 | 0.765362 | 0.710565 | 0.9284 | 3 / 3 |
| tier | tier.ultra | 1.622 | 4.091578 | 3.902037 | 0.9537 | 3 / 3 |
| tier | tier.studio | 1.622 | 7.722551 | 7.406592 | 0.9591 | 3 / 3 |
| tier | tier.reference | 1.622 | 17.658464 | 17.167341 | 0.9722 | 3 / 3 |

Command: `npm run test:heavy -- --suite performance` (built wasm required).
