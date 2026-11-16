---
'voice-simulator': patch
---

Track the real-time factor of every audio tier on the JavaScript and the Rust engine: the heavy check `performance-tiers` compares it with a committed baseline (scaled by a calibration loop) and fails on a slower tier, a Rust tier slower than JavaScript, or a waveguide tier above half of real time; `scripts/performance.mjs` compares reports, replaces the baseline and keeps the trend in `docs/reports/performance.md`, and a quick smoke test in `npm test` checks the cheapest tiers on every runtime.
