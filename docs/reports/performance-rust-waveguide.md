## Rust waveguide renderer: render time

Text: "The quick brown fox jumps over the dog.", seed 1, median of 3 runs, Node.js v26.13.0, linux x64. Real-time factor (RTF) = render seconds / audio seconds; speed-up = JavaScript RTF / Rust RTF; frame preparation = share of the Rust render spent preparing frames in JavaScript.

| Tier | Sample rate (Hz) | Duration (s) | JavaScript RTF | Rust RTF | Speed-up | Frame preparation | Max abs diff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| telephone | 8000 | 3.50 | 0.0765 | 0.0387 | 1.98× | 50.9% | 0 |
| narrowband | 11025 | 3.50 | 0.0797 | 0.0411 | 1.94× | 38.5% | 0 |
| wideband | 16000 | 3.50 | 0.0923 | 0.0602 | 1.53× | 25.8% | 0 |
| minimal | 22050 | 3.50 | 0.1087 | 0.0542 | 2.01× | 27.2% | 0 |
| low | 32000 | 3.50 | 0.1239 | 0.0793 | 1.56× | 22.3% | 0 |
| medium | 48000 | 3.50 | 0.2245 | 0.1399 | 1.60× | 23.4% | 0 |
