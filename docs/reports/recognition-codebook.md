# Simulator-generated codebook measurements (issue 64)

Command: `npm run test:heavy -- --suite recognition`, from
[the successful recognition CI run](https://github.com/konard/voice-simulator/actions/runs/44033806209)
at commit `6675b0a4f931e197f428a3df58108aea77e7e6e4`. The codebook has
20000 rows, seed 1, and the default head. Builds and queries use one core.

| Measurement | Result | Requirement or target |
| --- | --- | --- |
| Build | 18.70 s | At most 60 s; target 30 s |
| Query, mean of 10000 row observations | 17.21 microseconds | At most 50 microseconds |
| Independent unseen shapes, F1-F3 within 5% in the top 16 | 499/500 (99.8%) | At least 95% |
| Non-unique rows, four formants within 3% and a channel over 25% apart | 78.53% | Measured and reported |
| Pure length scaling, maximum vowel F1-F3 error at 14 cm | 3.69% | At most 2%; otherwise build per length |
| Per-length fallback, maximum vowel F1-F3 error at 14 cm | 1.10% | At most 2% |
| Rendered vowels at 16 kHz, height/backness within 0.15 in the top 16 | 23/31 (74.19%) | Target 90%, not met |
| Rendered vowels at 8 kHz, height/backness within 0.15 in the top 16 | 21/31 (67.74%) | Target 90%, not met |

The serialized 20000-row SHA-256 is
`748cf19607fee5ea57cc6d1e367d145ed073585c7c9660ed1052d222821eaa9c`.
The same bytes were produced locally. The complete generated report is
available in the run's `heavy-recognition-44033806209` artifact.

The [runtime matrix](https://github.com/konard/voice-simulator/actions/runs/44033759626)
passed on Node.js, Bun and Deno on Ubuntu 24.04, macOS 15 and Windows 2025.
All nine jobs printed the same 2000-row serialized SHA-256:
`d09d50f9bb9d90142d61de67cf07703ffe9cf095b0deb50710254f152f02eda3`.
Each reported 200/200 agreement with exhaustive search. The Rust Engine job
built WebAssembly and passed the transfer-response and key parity tests.

The [full performance suite](https://github.com/konard/voice-simulator/actions/runs/44034571807)
also passed without an item limit: Rust waveguide/FDTD, native/WebAssembly
threading and all nine audio tiers. Its artifact supplies the new row in
[the performance trend](performance.md); the baseline is unchanged.

Accepted row counts are neutral 1, oral vowels 30, nasal vowels 31,
consonants 172, mixtures 4271, perturbed seeds 9810 and random vowels 5685.
One oral vowel duplicates neutral and is removed by the specified duplicate
rule. There are exactly 2000 rows with an open velum (10%). Sampling proposals
follow 25% mixtures, 50% perturbations and 25% random vowels; rejection changes
the accepted proportions.

Length-dependent wall losses prevent pure frequency scaling from reaching
the 2% tolerance. The implementation therefore uses the requested length
rounded to 0.5 cm in the build geometry and cache identity, as specified by
the issue's fallback. All normalized head parameters participate in identity
because they can affect the current forward model.

The rendered-vowel results use 300 ms waveguide sounds and the middle frame
of `analyzeFrames` at each sample rate. They measure the raw `frameEnvelope`
contract: LPC levels, normalized over the first 16 bands. That observation
retains source coloration, whereas oral table rows describe the tract's
transfer function. The six-dimensional search key removes linear tilt;
envelope reranking still compares the specified raw levels. These numbers
must not be interpreted as achieving the 90% target.

`node experiments/issue-64-query.mjs 20000` saves a local table under
`reports/`; `node experiments/issue-64-rendered.mjs 20000` compares raw
observations with explicit neutral-source calibration. That diagnostic
reproduced the raw 23/31 and 21/31 results and reached 28/31 and 29/31 after
calibration, respectively. This supports source mismatch as the limiting
factor; calibration is a diagnostic, not part of `frameEnvelope`'s specified
formula.
`node experiments/issue-64-analysis.mjs` reuses that table and checks 18
finite front-end parameter combinations per sample rate. The latter probe
reached at most 24/31 matches, so changing the analysis window, LPC order or
pre-emphasis alone did not reach the target. The public observation and query
formulas remain those requested in issue 64.
