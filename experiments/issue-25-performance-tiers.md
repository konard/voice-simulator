<!-- HEAVY=1 HEAVY_LIMIT=9 node --test --test-timeout=0 tests/heavy/performance-tiers.test.js (src/engine/voice-simulator.wasm built by npm run build:wasm) -->

## Audio tiers: render time

Text: "The quick brown fox jumps over the dog.", seed 1, Node.js v26.13.0, linux x64. Real-time factor = render seconds / audio seconds (below 1 is faster than real time). Speed-up = JavaScript seconds / Rust seconds.

| Tier       | Sample rate (Hz) | Duration (s) | JS seconds | JS real-time factor | Rust seconds | Rust real-time factor | Speed-up | Rendered by |
| ---------- | ---------------- | ------------ | ---------- | ------------------- | ------------ | --------------------- | -------- | ----------- |
| telephone  | 8000             | 3.32         | 0.94       | 0.28                | 0.31         | 0.09                  | 3.02     | rust        |
| narrowband | 11025            | 3.32         | 0.82       | 0.25                | 0.36         | 0.11                  | 2.27     | rust        |
| wideband   | 16000            | 3.32         | 0.96       | 0.29                | 0.19         | 0.06                  | 5.16     | rust        |
| minimal    | 22050            | 3.32         | 0.40       | 0.12                | 0.17         | 0.05                  | 2.37     | rust        |
| low        | 32000            | 3.32         | 0.66       | 0.20                | 0.24         | 0.07                  | 2.71     | rust        |
| medium     | 48000            | 3.32         | 0.89       | 0.27                | 0.65         | 0.20                  | 1.37     | rust        |
| high       | 48000            | 3.32         | 9.58       | 2.89                | 6.94         | 2.09                  | 1.38     | rust        |
| ultra      | 48000            | 3.32         | 30.35      | 9.15                | 23.62        | 7.12                  | 1.29     | rust        |
| studio     | 48000            | 3.32         | 49.76      | 15.00               | 44.19        | 13.32                 | 1.13     | rust        |
