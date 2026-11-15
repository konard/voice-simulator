## Rust 3D FDTD renderer: render time

Text: "The quick brown fox jumps over the dog.", seed 1, median of 3 runs, Node.js v26.13.0, linux x64. Real-time factor (RTF) = render seconds / audio seconds. JavaScript = VoiceRenderer with `kernel: 'wasm'`; speed-up = JavaScript RTF / Rust scalar RTF; SIMD ratio = Rust scalar RTF / Rust SIMD RTF.

| Tier | dx (cm) | Duration (s) | JavaScript RTF | Rust scalar RTF | Rust SIMD RTF | Speed-up | SIMD ratio | Max abs diff (scalar, SIMD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| high | 1 | 3.50 | 1.3699 | 0.9582 | 0.9036 | 1.43× | 1.060× | 0, 0 |
| ultra | 0.6 | 3.50 | 6.9878 | 6.2683 | 5.7286 | 1.11× | 1.094× | 0, 0 |
| studio | 0.5 | 3.50 | 12.5854 | 11.2744 | 10.4155 | 1.12× | 1.082× | 0, 0 |

SIMD / scalar on `high`: 1.060×, below 1.15: do not ship src/engine/voice-simulator-simd.wasm
