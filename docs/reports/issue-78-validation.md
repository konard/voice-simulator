# Voice session validation

## Synthetic recovery

The recovery test uses 20 seconds from each of four 16 kHz, seed-1 minimal
renderings. It passes the audio and English language code to the session.
The expected text and source voice are held by the test.

| Speaker | Tract error | Pitch error | Rate error | Passes | Converged |
| --- | ---: | ---: | ---: | ---: | --- |
| Male | 1.26% → 1.26% | 0.78% → 0.78% | 12.95% → 12.95% | 19 | No |
| Female | 1.42% → 1.42% | 0.97% → 0.97% | 27.86% → 27.86% | 18 | No |
| Child | 1.26% → 1.26% | 0.48% → 0.48% | 19.91% → 19.91% | 19 | No |
| Custom male | 3.84% → 3.84% | 0.00% → 0.00% | 5.56% → 5.56% | 19 | No |

The error columns show the first and last passes. The
[per-parameter measurements](issue-78-synthetic.json) contain the absolute
errors in each parameter's native unit, the target values for the three
thresholded parameters, pass distances and pass counts. Every speaker
finished in `inverting`. Speech-rate error exceeded
5% for each speaker. The custom male also exceeded the 3% tract-length
threshold. The sessions returned no jackknife uncertainty because they never
converged.

## Reproduction

```sh
node experiments/issue-78/session.mjs
node experiments/issue-78/baseline.mjs
node experiments/issue-78/default-plan.mjs d52d5cd
HEAVY_OUT=/tmp/voice-78-heavy node --test --test-concurrency=1 tests/heavy/copy-voice-session.test.js
npm run test:heavy -- --suite copy
```

The public API probe uses a 5.275-second synthetic sentence with the same
sample rate, tier and seed. It enters `collecting`, `fitting`, then
`inverting`. It completes four passes at distance 1.03425 and synthesizes
23,399 samples for “Hello.” with the first fitted voice. The run took 36.83 s
elapsed and 38.21 s of process CPU time.

The upstream decoder probe supplies the voice from `fitVoice` directly to
`audioToIpa`. It returns zero non-pause segments with confidence at least
0.5 after one or four fit renders, and one consonant after ten renders.
Refinement requires ten such segments, including three distinct vowels.

With the true source head supplied directly to the decoder, none of the
segments reached confidence 0.5. At 8 kHz with beam width 8, one of 14 vowel
predictions matched the synthesis plan at its midpoint. At 16 kHz, two of 16
matched with beam widths 32 and 128.

## Focused checks

The fast session tests on Node.js, Bun and Deno cover the state machine with
controlled pass outputs, deterministic chunking, fit step control, voice-file
round trips and synthesis. The default-plan comparison checks the serialized
planner output against the base revision for English, Russian, Hindi and
Mandarin. Rust and WASM parity checks cover the statistical reductions.

The scheduler yields between generator steps. The existing batch acoustic
analysis, synthesis and IPA decoding can take longer than the required 10 ms
slice. End-to-end convergence, the heavy thresholds and the slice deadline
are open acceptance criteria.
