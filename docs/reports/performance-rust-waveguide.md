## Rust waveguide renderer: render time

Text: "The quick brown fox jumps over the dog.", seed 1, median of 3 runs, Node.js v26.13.0, linux x64. Real-time factor (RTF) = render seconds / audio seconds; speed-up = JavaScript RTF / Rust RTF; frame preparation = share of the Rust render spent preparing frames in JavaScript.

| Tier | Sample rate (Hz) | Duration (s) | JavaScript RTF | Rust RTF | Speed-up | Frame preparation | Max abs diff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| telephone | 8000 | 3.50 | 0.0592 | 0.0250 | 2.37× | 60.1% | 0 |
| narrowband | 11025 | 3.50 | 0.0444 | 0.0284 | 1.56× | 41.1% | 0 |
| wideband | 16000 | 3.50 | 0.0553 | 0.0293 | 1.89× | 32.5% | 0 |
| minimal | 22050 | 3.50 | 0.0575 | 0.0285 | 2.02× | 34.2% | 0 |
| low | 32000 | 3.50 | 0.0847 | 0.0550 | 1.54× | 30.4% | 0 |
| medium | 48000 | 3.50 | 0.1533 | 0.0896 | 1.71× | 28.1% | 0 |
