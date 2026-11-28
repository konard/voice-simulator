# Batch glottal source analysis

`inverseFilter` (issue #61) estimates the glottal flow and its derivative after
removing a recording's vocal tract. It uses analytic signal processing and the
simulator's LF pulse family; it requires no model download or recorded audio.
Run it on a finished stretch, outside the path to the first recognition result.

```js
import {
  analyzeFrames,
  inverseFilter,
  trackPitch,
  rdToTenseness,
  lfHarmonics,
} from 'voice-simulator';

const frames = analyzeFrames(samples, sampleRate);
const source = inverseFilter(frames, { pitch: trackPitch(frames) });
source.gci; // absolute closure times, seconds
source.flowDerivative; // Float32Array, frames.sampleCount samples
source.summary.rd.median; // null if there are no usable measurements
rdToTenseness(1.5); // 0.5 at reference breathiness 0.2
lfHarmonics(0.5); // fresh Float64Array: harmonics 1..10, dB
```

The frame set owns the working-rate samples; rate, hop and start time pass
through unchanged. Only valid rows and `sampleCount` samples are read, including
after front-end trimming. An optional pitch track must cover and align with the
frames. Without one, speech flags and periodicity >= 0.5 gate a local,
Hann-window-corrected autocorrelation estimate followed by a median of five.
Stationary signals may be absorbed into the front end's noise floor: pass a
known pitch for calibration signals. A local estimate can have octave errors;
the full pitch tracker is preferable for measurements of changing speech.

`INVERSE_FILTER_DEFAULTS` has `pitch: null`, `tractOrder: null`,
`glottisOrder: null`, `leak: 0.99`, `step: 0.01`, `minF0: 60`, `maxF0: 400`
and `trace: null`. Null orders derive from the working rate:
`2 * round(rate / 2000) + 4` for the tract (20 at 16 kHz, 12 at 8 kHz),
`2 * round(rate / 4000)` for the source (8 and 4).
`trace(event)` optionally reports stationary-refinement errors and the final
voicing, closure count, band flag and summaries; it is off by default.

The sample rate must be 8000..48000 Hz; LPC orders are integers 1..128;
`0 <= leak < 1`; `1 / rate <= step <= 0.032` seconds;
`20 <= minF0 < maxF0 < rate / 4`. Finite supplied voiced pitches must lie
between 20 Hz and rate / 4; zero or non-finite pitches are unvoiced. Invalid
frame layouts, non-finite input samples or invalid options throw. No randomness
or external state is used.
The cepstral baseline needs at least two bins:
`floor(rate / minF0) > ceil(0.001 * rate)`.

## Result and interpretation

`hop`, `startTime`, `count`, `rate`, `flow` and `flowDerivative` accompany:

| Field                | Definition                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `gci`                | Float64 absolute seconds, closure instants within each voiced run   |
| `f0`                 | Float32 Hz, zero when unvoiced                                      |
| `rd`, `fit`          | Best LF shape parameter and centred-harmonic RMS error, dB          |
| `oq`                 | `min(1, te + ta)` of that LF template                               |
| `naq`                | Flow excursion / (negative derivative peak \* samples per period)   |
| `h1h2`, `h1h2Source` | Harmonics 1 minus 2 on speech / recovered derivative, dB            |
| `hnr`                | Window-corrected six-period autocorrelation HNR, dB                 |
| `cpp`                | Real cepstral peak above its fitted baseline, this function's scale |
| `reliable`           | Uint8: voiced, f0 <= maxF0 and fit <= 6 dB                          |
| `lowBand`            | False when sub-250 Hz mel energy is > 4.6 ln below 300..1000 Hz     |
| `summary`            | For each of the nine measures: median, low, high, frames            |

All per-frame measures except `f0` are NaN in unvoiced frames. When `lowBand`
is false, Rd, OQ, NAQ and both H1-H2 arrays are NaN; HNR, CPP, the fit diagnostic
and voicing remain available. The reliable mask still describes voicing and LF
fit. Summaries ignore non-finite or unreliable values, interpolate the 25th,
50th and 75th percentiles, and return null percentiles with zero frames when
empty. Flow has relative amplitude, not calibrated physical units. Unvoiced
samples have zero flow. H1-H2 on speech includes formant effects.
Source H1-H2 is NaN if fewer than two analysed harmonics are available.

## Numerical method and limits

A first-order 50 Hz high-pass runs forward and backward. Every 10 ms a Hann
block of max(32 ms, 2.5 periods) passes through Alku's four IAIF stages:
order-one source tilt, first tract estimate, integrated glottal LPC, final tract
estimate. Leaky integration gives flow. Hann overlap-add divides by weights
above 0.01. FIR and integrator histories get 50 ms of warm-up **outside** the
LPC window. Without that history, resetting the filter at each block boundary
introduced artificial impulses; the known-source correlation was about 0.14
instead of 0.97 at 16 kHz before stationary refinement.

A high-order tract predictor can also absorb smooth LF source poles. For a
voiced run lasting at least 200 ms with pitch within 1% and centred speech
harmonic levels within 1 dB at its quarter, middle and three-quarter points,
a single 64 ms middle block refines the tract using the analytic LF family.
Runs with moving pitch or spectrum keep the four-stage IAIF result. Refinement
is skipped for tract orders above 32. This extension uses no closed-phase
samples or reference-source truth.

For lagged speech matrix X and current samples y, the refinement minimizes
`||y + X a - b m||²`, where m is a candidate LF derivative aligned to an IAIF
closure and b is a positive gain. Cholesky of `X'X + 1e-13 * energy * I`
projects y and m off X. Their residual correlation gives the optimal gain and
predictor; reject singular matrices, negative gain or normalized residual
error >= 0.5. A bounded search uses seven coarse LF shapes, closure shifts
within 0.5 ms, then eleven nearby shapes. Cached 4096-phase LF periods are
linearly interpolated. The refined FIR output is integrated and crossfaded
over 32 ms at the run boundaries. Changing tract shapes within a gated run,
noise and imperfect pitch can still bias source estimates.

Closure tracking starts at the negative derivative peak in the middle 30 ms
of each voiced run and follows periods in both directions with a ±0.3-period
search. Two periods per frame give NAQ and harmonic measures. Rd always comes
from the specified 38-template, centred-dB comparison: LF tenseness 0.10..0.84
in 0.02 steps, 256-point FFT harmonics 1..10. It is quantized in 0.06 steps.
OQ uses the newly exposed local `ta` from `lfParameters`.

HNR directly evaluates the two neighbouring integer lags of a six-period
Hann autocorrelation and interpolates at the pitch lag (r clipped to
0.001..0.999). Computing only those lags avoids a full FFT per frame. CPP
uses 40 ms Hann speech, next-power-of-two FFT, `10 log10(power + 1e-12)`,
real inverse FFT, and a line fitted from 1 ms to `1 / minF0`. Its peak search
runs from `1 / maxF0` to `1 / minF0`. Compare CPP only to this implementation;
its scale differs from other cepstral measures.

## Verification

Run `node --test tests/recognition-inverse-filter.test.js`,
`bun test tests/recognition-inverse-filter.test.js`, and
`deno test -A tests/recognition-inverse-filter.test.js` for known-source
correlation, six Rd fits, closure timing, known noise HNR, CPP degradation,
telephone detection, male/female speech, edge cases and CPU measurements.
The CPU test follows the existing pitch test's warmed, best-of-three protocol;
it prints `inverse filter rtf`, fails above 0.4, and is checked against the
0.10 target in a separate Ubuntu Node CI step (`INVERSE_FILTER_RTF_LIMIT=0.10`). `node experiments/issue-61/rtf.mjs` also measures
five-run averages with local and supplied pitch. The front end and synthesis
are excluded from these stage timings.

The exact source fixture has `breathiness: 0`. Since #32 its actual Rd is
`3 * (1 - tenseness) - 0.3`, bounded to 0.3..2.7, so its true values are
1.8, 1.2, 0.6 rather than the issue's earlier 2.1, 1.5, 0.9. Tests print
both sets of errors. Accuracy misses against the 0.25 goal are reported in
PR #141, as the issue requests; monotonic ordering and the 0.4 test bound
against the current source truth remain required. This estimator is not a
precision physical-fold parameter fit.

`node experiments/issue-11-audit.mjs` prints `inverse breathiness` HNR/CPP
medians alongside the older voice features. The source test helpers generate
all samples from analytic LF pulses and seeded noise; no speech data or new
dependencies are committed.

## Rust core and WebAssembly

`voice_simulator_core::inverse_filter::{Frames, Options, inverse_filter,
lf_harmonics, rd_to_tenseness}` implements the same DSP with no I/O. A `Frames`
value borrows existing front-end arrays, so it does not require a separate
Rust front-end implementation. `Result.measures` and `Result.summary` have
columns f0, rd, fit, oq, naq, h1h2, h1h2Source, hnr, cpp in that order.
Run `npm run build:wasm -- --require` and
`REQUIRE_WASM=1 node --test tests/rust-inverse-filter.test.js` for parity.
Class B comparison uses relative RMS <= 1e-6; NaN masks, reliable masks and
array lengths agree. Unreliable fit/source-H1-H2 diagnostics near silence use
an absolute 0.002 dB limit because their harmonic ratios are ill-conditioned;
reliable values keep the 1e-6 limit. The release workflow runs this test with the built engine.

The additive ABI-4 export
`vs_inverse_filter(input, length, output, capacity)` uses f64 arrays throughout
and returns the number of output values, or an existing negative error code.
Input metadata (14 values): rate, hop, window, startTime, count, sampleCount,
melBands, tractOrder (0 derives), glottisOrder (0 derives), leak, step, minF0,
maxF0, pitch flag (0/1). This is followed by samples, speech flags, periodicity,
row-major mel values and, when flagged, f0 values. Inputs are copied before
allocation or output writes, allowing overlap safely. Output:

1. count, sampleCount, gci count, lowBand (0/1).
2. flow and derivative, each sampleCount values, then the GCIs.
3. Nine frame columns in the order above, then reliable flags.
4. For each column: median, low, high (NaN when empty), frames.

Capacity `40 + 3 * sampleCount + 10 * count` covers the output. The existing
ABI version and synthesis exports keep their signatures.

The mode classifier calls
`rec_inverse_modes_f32(header, input, speech, indices, rows, output, capacity)`.
The header is the same 14 f64 values. The input holds consecutive f32 arrays
for samples, periodicity, mel and optional f0. Speech flags are bytes and the
`rows` zero-based vowel frame indices are f64. The number returned and the
output capacity count f32 values. Older engines can use `rec_inverse_modes`,
which takes the full f64 input packet followed by the vowel frame indices and
uses f64 output.

Both mode exports write three `count`-element columns in the order h1h2Source,
hnr, cpp. Entries outside the requested rows and measurements unavailable in a
requested row are NaN. The mode exports skip pulse, flow and summary analysis.

## References

Alku (1992), _Speech Communication_ 11, 109–118 (IAIF);
Alku, Bäckström and Vilkman (2002), _JASA_ 112, 701–710 (NAQ);
Boersma (1993), _Proc. Institute of Phonetic Sciences_ 17, 97–110 (HNR);
Fant (1997), _Speech Communication_ 22, 125–139 (LF source);
Hillenbrand, Cleveland and Erickson (1994), _JSHR_ 37, 769–778 (CPP).
The exact definitions and acceptance signals are recorded in issue #61.
