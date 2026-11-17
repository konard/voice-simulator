# Issue 62: syllable nuclei, landmarks and broad classes

Issue: <https://github.com/konard/voice-simulator/issues/62>.
Pull request: <https://github.com/konard/voice-simulator/pull/142>.

## Status: unfinished

The implementation is an experimental draft. The requested quality gates
remain failing. Two requirements also conflict with the prescribed algorithm
or its available input. These are not waived by passing the mechanical tests.
The pull request must remain a draft and must not be merged as a completed
implementation of issue 62.

Both prerequisites (#58 and #17) were closed when work began. The issue has no
comments or required sub-issues; the prepared PR had no conversation comments,
inline comments or reviews. The existing frontend and pitch stage (#139) supply
the stage pattern. The JavaScript implementation reads existing frame features;
it does not recompute spectra or add a dependency.

## Reproducible blockers

### Required local maxima cannot reach 90% recall on the specified renders

Run:

```sh
node experiments/issue-62/nucleus-ceiling.mjs
```

This renders all four specified sentences, male and female, at 16000 and
8000 Hz, with the JavaScript waveguide solver and seed 1. Truth is the middle
of the planned vowel group identified by `syllabifyTokens`, as requested.
Sonority is the specified mel energy with a 40 ms moving mean.

The experiment allows **every** voiced maximum within ±40 ms, including tied
maxima, without applying any noise, dip, spacing or confirmation rejection.
For each true nucleus it asks whether any such maximum is within 50 ms.
There are only **98 recoverable centres out of 120 (81.6667%)**. Matching is
optimistic: one candidate may cover multiple truth centres, so this is an
upper bound, not detector recall. Threshold calibration can only remove
candidates from this superset; it cannot meet 90% with the current signals,
required voicing gate, local-maximum rule and truth tolerance.

| Language | Male, each rate | Female, each rate |
| -------- | --------------: | ----------------: |
| English  |           12/15 |             12/15 |
| Russian  |             6/6 |               4/6 |
| Hindi    |             6/6 |               4/6 |
| Mandarin |             3/3 |               2/3 |

Resolving this requires a change to the permitted signals/detector rules,
timing truth or quality criterion. No unrequested change to the synthesizer
has been made to move its waveform toward this test's labels.

### Retrospective closure cleanup conflicts with immutable classes at 60 ms

Run:

```sh
node experiments/issue-62/causality.mjs
```

At a 5 ms hop, compare 200 ms of vowel followed by either 100 ms or 200 ms
of silence, followed by vowel. The class input through frame 56 is identical.
Frame 44's commitment deadline is frame 56. The final cleanup must label
frame 44 closure in the first recording (bounded silence under 150 ms) and
silence in the second. The return to speech in the first recording is frame
60, after that deadline. The experiment asserts identical prefixes and the
two different required final labels.

No causal stage can make both decisions correctly by the stated deadline.
The draft preserves committed labels and performs retrospective cleanup in
batch mode. Consequently these labels can differ between batch and streaming.
That is a documented unresolved requirement, not a claim of full compliance.
A resolution needs either provisional labels, longer commitment or a different
closure rule.

### Calibration objective does not identify the nucleus thresholds

The specified score is mean recall of the eight broad classes. Neither
`nucleusAboveNoise` nor `nucleusDip` participates in the class tree or cleanup.
Every value of these coordinates has the same score. The deterministic draft
keeps the previous value on ties, so these remain at the specified initial
10 dB and 2 dB. A separate nucleus objective would be needed to learn them.
The issue gives no allowed numeric search ranges; the draft declares its
inclusive ranges in `SEARCH_RANGES` and uses 21 evenly spaced values.

## Requirement inventory

Checked items describe implemented mechanics or completed measurements, not
acceptance of the issue as a whole.

- [x] Sonority: mel centres 300–3000 Hz (2800 Hz at 8 kHz), 40 ms mean,
      capacity-sized `Float32Array`.
- [x] Nucleus stage, gates, valley boundaries, append-only confirmation;
      20 ms chunk tests verify timing and batch/stream nucleus times.
- [ ] Full nucleus peak replacement rules with irrevocable confirmation;
      draft retains already confirmed peaks. Recall/extras gates fail.
- [x] Coarse/fine band rises, signed g/s/b candidates and deduplication.
- [ ] All requested landmark edges within 20 ms.
- [x] Eight broad classes in the requested order, fixed decision tree,
      median and run cleanup; capacity-sized `Uint8Array`.
- [ ] Retrospective closure cleanup with exact 60 ms commitment, as above.
- [x] Public batch/stream APIs, configurable thresholds, exports/types.
- [x] Calibration renders all 63 consonants × 3 vowels × 3 voices × 3 rates
      × clean/noisy = 3780 recordings, with seeded noise 20 dB below speech;
      excludes frames within 10 ms of segment boundaries; three rounds of
      21-point coordinate search; generated recall comments.
- [ ] Final formatted calibration repeatability and tenth-material stability
      verification (recorded below when complete).
- [x] Four-language synthetic tests, both voices and both sample rates;
      assertions retain the requested 90%, 10%, 85%/80% and 20 ms gates.
- [ ] Synthetic quality gates pass on Node.js, Bun and Deno.
- [x] Noise-only, streaming timing/immutability, and CPU tests.
- [x] Golden report on all 24 utterances, syllabifyIpa truth, counts and MARE.
- [x] Rust numerical core and WASM bridge; parity on 12 rate/voice/hop cases.
- [x] README, CLI command/help, roadmap, Rust documentation, minor changeset.
- [ ] All repository checks and current-commit CI pass.
- [ ] Final clean working tree, main included, final PR review and readiness.

## Measurements

Commands are run from the repository root. Outputs during this investigation
are preserved in `/tmp/issue-62-*.log`; the reproducible scripts and persistent
report are committed. The machine is a resource-limited container, not the
reference machine, so the CPU figure is not a claim about CI.

| Command                                                                                        | Measured result                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `node --test tests/recognition-landmarks.test.js tests/rust-landmarks.test.js`                 | 8 pass, 3 fail; nucleus recall 63.3333%, extras/truth 33.3333%; class accuracy 48.2837% at 16 kHz, 47.1520% at 8 kHz; RTF 0.000396 |
| `bun test tests/recognition-landmarks.test.js`                                                 | Same three quality failures and identical counts/accuracy; RTF 0.000307                                                            |
| `deno test -A tests/recognition-landmarks.test.js`                                             | Same three quality failures and identical counts/accuracy; RTF 0.000665                                                            |
| `node --test --test-name-pattern='prints landmark' tests/cli-audio.test.js`                    | Pass: JSON stdout, saved JSON, missing-file validation                                                                             |
| `CARGO_BUILD_JOBS=1 npm run build:wasm`                                                        | Scalar and SIMD compile; scalar 235515 bytes, Rust 1.100.0; budget raised to next 16 KiB boundary, 245760                          |
| `node --test tests/rust-landmarks.test.js` (included above)                                    | All 12 combinations agree; maximum relative RMS 6.77e-17, classes and nucleus presence exact                                       |
| `CARGO_BUILD_JOBS=1 cargo test --workspace`                                                    | 91 tests pass (9 CLI, 67 core, 15 WASM)                                                                                            |
| `CARGO_BUILD_JOBS=1 cargo clippy --workspace -- -D warnings`                                   | Pass                                                                                                                               |
| `node --test --test-name-pattern='counts syllables' tests/heavy/recognition-landmarks.test.js` | Pass; all 24 utterances, MARE 19.32% (15% is not a gate)                                                                           |

The missing landmark expectations are `apa` g− at 0.174 s and g+ at
0.260 s, and `ama` s− at 0.178 s and s+ at 0.230 s. The log prints all
candidates, missing edges and per-rate class confusion matrices.

The golden report is generated at `reports/heavy/recognition-landmarks.md`
and `.json`; a reviewable snapshot is in [golden-report.md](golden-report.md).
All golden transcripts remain marked unreviewed, as in the manifest; no human
review status was changed.

Full-material calibration reaches mean per-class recall **35.2732%** over
371070 labelled frames. In class order the recalls are 71.727%, 21.695%,
10.742%, 89.790%, 0%, 86.117%, 2.057%, 0.058%. This objective favours nasal
recall at the expense of vowel frame accuracy; it is not the requested
synthetic sentence accuracy. The numerical result is retained even though it
is poor. The nucleus and class gates have not been lowered or skipped.

## Remaining work

Resolve the contradictory timing contract and the unreachable nucleus target
before treating this as a releasable stage. Class accuracy and the four
missing landmark edges also need an effective algorithm or input change;
repeatable calibration alone does not fix them. Keep the three ordinary test
failures visible and keep PR #142 unmerged until every criterion is met.
