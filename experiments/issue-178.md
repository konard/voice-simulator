# Telephone copy experiments

The certification measures the public `copyRecording` result on all 24 golden
recordings at 8000 Hz, on one CPU with a 192 MB V8 heap. It compares the
synthesized wave with the source for pitch and independently recognizes the
copy for syllable timing and phoneme agreement. It requires a mean pitch error
of 1.5 semitones or less, a mean timing error of 30 ms or less, and pooled
phoneme agreement of at least 90%.

Run the probes from the repository root with the bundled golden set.
Substitute an allowed CPU for core 0. Build the scalar WebAssembly engine for
the Rust row with `node scripts/build-wasm.mjs --require`.

```sh
export UV_THREADPOOL_SIZE=1
taskset -c 0 node --max-old-space-size=192 scripts/lowest-settings.mjs --row copy --engine js --trace-copy
taskset -c 0 node --max-old-space-size=192 scripts/lowest-settings.mjs --row copy --engine rust --trace-copy

node --max-old-space-size=192 experiments/issue-178-copy.mjs
node --max-old-space-size=192 experiments/issue-178-copy.mjs --exact en-01 en-02 ru-01 ru-02 hi-01 hi-02 zh-01 zh-02
node --max-old-space-size=192 experiments/issue-178-bandwidth.mjs
node --max-old-space-size=192 experiments/issue-178-bandwidth.mjs --source en-03 ru-01
node --max-old-space-size=192 experiments/issue-178-lattice-copy.mjs en-01 en-02 en-03 en-04
node --max-old-space-size=192 experiments/issue-178-plan-controls.mjs en-01
node --max-old-space-size=192 experiments/issue-178-plan-controls.mjs --low en-03 ru-01
node --max-old-space-size=192 experiments/issue-178-plan-controls.mjs --single en-03 ru-01
node --max-old-space-size=192 experiments/issue-178-source-probe.mjs en-01 en-03 en-06
node --max-old-space-size=192 experiments/issue-178-source-probe.mjs --feedback en-01 en-03 en-06
node --max-old-space-size=192 experiments/issue-178-source-probe.mjs --yin en-01 ru-01
node --max-old-space-size=192 experiments/issue-178-spectral-fit.mjs en-01 en-03
```

## Results before the packed decoder merge

The public benchmark ran at `5978d3f1` on Node 26.13.1. Both engines completed
`en-01` under the cap with identical quality measurements of 5.3978 semitones,
237.1 ms and 43.75% agreement. Peak RSS was 376 MB for JavaScript and 383 MB for
scalar Rust WebAssembly. The memory cap applies to the V8 heap.

On the same revision, JavaScript finished all 24 recordings under the cap
in CI. It measured 4.7335 semitones mean pitch error, 305.2 ms mean syllable
error, 42.11% pooled agreement and 482.5 MB peak RSS. This run was superseded
after its JavaScript result and before its Rust result. [Run log](https://github.com/konard/voice-simulator/actions/runs/46096390478)

| Probe                      | Result                                                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spectral resynthesis       | Across all 24 recordings, 1.0162 semitones and 58.3 ms mean error with 78.1% pooled agreement. Both readings use the corpus language label.                                                                                                                       |
| Telephone output filter    | Applying only the telephone output filter gave 79.0% pooled phoneme agreement on the first two recordings per language. On `ru-01`, agreement was 0% and mean syllable drift was 140 ms.                                                                          |
| LPC tube lattice           | Across four recordings with 10, 18 and 28 poles, the highest phoneme agreement was 46.7%.                                                                                                                                                                         |
| Planned controls           | On `en-01`, removing excess breath and harshness reduced pitch error from 5.40 to 1.89 semitones and raised agreement from 43.75% to 50.0%. Removing duration bounds raised agreement to 68.75% and pitch error to 7.49 semitones.                                |
| Noise and gain             | On `en-01`, damping breath and harshness using periodicity reduced pitch error to 2.35 semitones. Relaxing the voicing gain on `en-06` raised agreement from 41.4% to 55.2% and increased syllable drift from 84 ms to 267 ms in this single-language diagnostic. |
| Pitch feedback             | On `en-03`, four render-and-measure passes reduced pitch error from 5.44 to 3.31 semitones and raised agreement from 33.3% to 40.0%. Syllable drift rose from 603 ms to 1455 ms in the single-language diagnostic.                                                |
| Articulator trajectory fit | Fitting oral and phonation channels to the local spectra reduced pitch errors to 4.50 and 3.09 semitones and raised phoneme agreement to 62.5% and 60.0% on `en-01` and `en-03`, respectively.                                                                    |

The waveform probes generate a new periodic and noise excitation and measure
acoustic and recognition sensitivity. The spectral resynthesis reconstructs
an envelope outside the shared articulatory renderer. The waveform probes
use the corpus labels and compare two low-tier readings. The production
benchmark uses the copy's own analysis as its reference. The probes are
diagnostics and the certification runs only through the public copy path.

## Results after the packed decoder merge

On the merged packed decoder at `3557d429`, both engine benchmarks found
12 phone edits over 16 reference phones on `en-01` (25.0% agreement). The
pitch and timing measurements were 5.3978 semitones and 237.1 ms. The scalar
Rust WebAssembly process peaked at 371.4 MB RSS under the V8 heap cap.

The `--exact` spectral probe uses unsmoothed magnitude spectra. On the first
two clips per language it yielded 0.4514 semitones and 125.1 ms mean error with
80.8% pooled agreement. On `hi-01`, the spectral DTW alignment had zero
mean shift, while the independently recognized syllable starts drifted by
639.7 ms and only 48.1% of phones agreed.

Using centered YIN with planned voicing reduced pitch error from 5.40 to
2.04 semitones on `en-01` and from 3.96 to 2.53 semitones on `ru-01`.
Agreement fell to 18.75% and 43.75%, respectively, and syllable drift rose on
both recordings in the single-language diagnostic.

The unchanged-source control compares the copy analysis to a separate
low-tier reading of exactly the same 8 kHz input, using the language selected
by the copy analysis. Agreement was 53.3% on `en-03` and 43.75% on `ru-01`, or
48.4% pooled. Mean syllable start differences were 17.5 and 230 ms.
Running the copy analysis at the low tier gave the same readings and copy
metrics as the default analysis on these two 8 kHz recordings. At this rate,
the word decoder uses the same trained model and feature extraction at both
recognition tiers.

Reanalyzing the input in the selected language with the batch recognizer
changed the score, but worsened recognition of the rendered copies.
Agreement fell to 11.1% on `en-03` and 20.0% on `ru-01`. Syllable drift was
560 and 570 ms, respectively. The `ru-01` copy had no jointly voiced pitch
frames on which to measure pitch error.
