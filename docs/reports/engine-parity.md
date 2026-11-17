# Engine parity: single-thread render times

Source: `d6a904fffc7da7162d4d5d0882d0b6f3b0155932`,
[green performance run 44079046577](https://github.com/konard/voice-simulator/actions/runs/44079046577)
(75/75 tests), Intel Xeon 6975P-C, four runner cores.

Node v24.22.2, linux x64; seed 82; scalar wasm, one thread. Includes renderer construction, frame preparation and samples. Each engine warms once, then renders for at least 2 seconds and at least 3 runs; times are medians. Every feature and every tier.

| Kind | Feature or tier | Audio (s) | JS (s) | Rust (s) | Rust / JS | Runs JS / Rust |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| feature | solver.waveguide | 0.723 | 0.014125 | 0.010087 | 0.7141 | 137 / 194 |
| feature | solver.fdtd3d | 0.592 | 0.129504 | 0.122270 | 0.9441 | 16 / 17 |
| feature | solver.fdtd2d | 0.734 | 0.055571 | 0.038557 | 0.6938 | 36 / 52 |
| feature | source.lf | 0.723 | 0.015022 | 0.010020 | 0.6670 | 131 / 197 |
| feature | source.folds | 0.723 | 0.014908 | 0.009481 | 0.6360 | 132 / 209 |
| feature | source.tract-interaction | 0.723 | 0.017056 | 0.010390 | 0.6092 | 115 / 190 |
| feature | source.subglottal | 0.723 | 0.019252 | 0.011274 | 0.5856 | 104 / 176 |
| feature | noise.turbulence | 0.863 | 0.019059 | 0.012207 | 0.6405 | 104 / 162 |
| feature | losses.frequency | 0.723 | 0.015833 | 0.009995 | 0.6313 | 125 / 198 |
| feature | filters.output | 0.723 | 0.015795 | 0.010030 | 0.6350 | 125 / 197 |
| feature | radiation | 0.723 | 0.015700 | 0.009999 | 0.6369 | 126 / 198 |
| feature | listener.microphone | 0.723 | 0.015968 | 0.010030 | 0.6281 | 123 / 197 |
| feature | listener.room | 0.592 | 0.019932 | 0.011902 | 0.5971 | 100 / 165 |
| feature | mode.whisper | 0.862 | 0.027722 | 0.015348 | 0.5537 | 72 / 129 |
| feature | mode.phonation | 0.669 | 0.019164 | 0.010872 | 0.5673 | 104 / 182 |
| feature | mode.effort | 0.625 | 0.017877 | 0.008332 | 0.4661 | 111 / 238 |
| feature | articulators | 0.723 | 0.021434 | 0.010491 | 0.4895 | 93 / 188 |
| feature | tier.narrowband | 0.723 | 0.011869 | 0.006211 | 0.5233 | 166 / 317 |
| tier | tier.telephone | 1.622 | 0.027674 | 0.016973 | 0.6133 | 72 / 116 |
| tier | tier.narrowband | 1.622 | 0.035019 | 0.021315 | 0.6087 | 57 / 92 |
| tier | tier.wideband | 1.622 | 0.046261 | 0.026956 | 0.5827 | 44 / 74 |
| tier | tier.minimal | 1.622 | 0.046171 | 0.026686 | 0.5780 | 44 / 74 |
| tier | tier.low | 1.622 | 0.069921 | 0.043825 | 0.6268 | 29 / 46 |
| tier | tier.medium | 1.622 | 0.103526 | 0.066036 | 0.6379 | 20 / 31 |
| tier | tier.high | 1.622 | 0.772277 | 0.676938 | 0.8765 | 3 / 3 |
| tier | tier.ultra | 1.622 | 4.034895 | 3.683884 | 0.9130 | 3 / 3 |
| tier | tier.studio | 1.622 | 7.633298 | 6.992525 | 0.9161 | 3 / 3 |
| tier | tier.reference | 1.622 | 17.423747 | 16.193506 | 0.9294 | 3 / 3 |

Command: `npm run test:heavy -- --suite performance` (built wasm required).
