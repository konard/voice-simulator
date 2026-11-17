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

`node experiments/issue-62/nucleus-ceiling.mjs --smoothing-sensitivity`
also checks other common interpretations of the moving mean: a centred
nine-frame window recovers at most 94/120 (78.33%), a trailing eight-frame
window 93/120 (77.50%), and a leading eight-frame window 96/120 (80.00%).
None of these reaches 90%; the draft uses the centred eight-frame window.

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
- [x] Final formatted calibration repeatability: two byte-identical runs;
      tenth-material stability within one search step for every threshold.
- [x] Four-language synthetic tests, both voices and both sample rates;
      assertions retain the requested 90%, 10%, 85%/80% and 20 ms gates.
- [ ] Synthetic quality gates pass on Node.js, Bun and Deno.
- [x] Noise-only, streaming timing/immutability, affricate truth regression,
      and CPU tests; all nine CI runtimes measure RTF below 0.001.
- [x] Golden report on all 24 utterances, syllabifyIpa truth, counts and MARE.
- [x] Rust numerical core and WASM bridge; parity on 12 rate/voice/hop cases.
- [x] README, CLI command/help, roadmap, Rust documentation, minor changeset.
- [x] `npm run check`, Rust tests/clippy, and documentation checks pass.
- [ ] All current-commit CI tests pass (quality gates remain failing).
- [x] Latest main is included; the full PR diff was reviewed for regressions.
- [ ] PR readiness: blocked by the unmet acceptance criteria.

## Measurements

Commands are run from the repository root. Outputs during this investigation
are preserved in `/tmp/issue-62-*.log`; the reproducible scripts and persistent
report are committed. The machine is a resource-limited container, not the
reference machine, so the CPU figure is not a claim about CI.

| Command                                                                                        | Measured result                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `node --test tests/recognition-landmarks.test.js tests/rust-landmarks.test.js`                 | 9 pass, 3 fail; nucleus recall 63.3333%, extras/truth 33.3333%; class accuracy 48.2459% at 16 kHz, 47.1143% at 8 kHz; RTF 0.000595 |
| `bun test tests/recognition-landmarks.test.js`                                                 | Same three quality failures and identical counts/accuracy; RTF 0.000331                                                            |
| `deno test -A tests/recognition-landmarks.test.js`                                             | Same three quality failures and identical counts/accuracy; RTF 0.000700                                                            |
| `node --test --test-name-pattern='prints landmark' tests/cli-audio.test.js`                    | Pass: JSON stdout, saved JSON, missing-file validation                                                                             |
| `CARGO_BUILD_JOBS=1 npm run build:wasm`                                                        | Scalar and SIMD compile; scalar 235515 bytes, Rust 1.100.0; budget raised to next 16 KiB boundary, 245760                          |
| `node --test tests/rust-landmarks.test.js` (included above)                                    | All 12 combinations agree; maximum relative RMS 6.77e-17, classes and nucleus presence exact                                       |
| `CARGO_BUILD_JOBS=1 cargo test --workspace`                                                    | 91 tests pass (9 CLI, 67 core, 15 WASM)                                                                                            |
| `CARGO_BUILD_JOBS=1 cargo clippy --workspace -- -D warnings`                                   | Pass                                                                                                                               |
| `node --test --test-name-pattern='counts syllables' tests/heavy/recognition-landmarks.test.js` | Pass; all 24 utterances, MARE 19.32% (15% is not a gate)                                                                           |

The final two full calibrations produced SHA-256
`01e01bce0d21594143f2fef34dcda058430a1cac740526f2e7f9fb45356b1203`
for the generated file, byte for byte. The command
`node --test --test-name-pattern='thresholds are up to date' tests/heavy/recognition-landmarks.test.js`
passed: the tenth material selected silence 8 versus full-material 7 (one
step); all other thresholds were identical. The affricate truth correction
does not change calibration: the inventory contains no affricate tokens.

The affricate regression failed before the label correction (`Expected 6 to
be 5`) and passes afterward for voiced and voiceless frication. Both phases
share a token in the plan; only the first is closure. The sentence accuracy
above uses the corrected labels.

The missing landmark expectations are `apa` g− at 0.174 s and g+ at
0.260 s, and `ama` s− at 0.178 s and s+ at 0.230 s. The log prints all
candidates, missing edges and per-rate class confusion matrices.

`node experiments/issue-62/landmark-candidates.mjs` also examines the
draft's candidates without the rise threshold. For `apa`, the closest g−
is 0.200 s (25.93 ms late), and no g+ is available near the release. For
`ama`, the closest s− at 0.180 s has only 6.93 dB strength, below the
calibrated 9 dB gate. The nearest s+ is 0.205 s, 24.51 ms early, at
6.03 dB. Simply reducing the rise threshold cannot fix all these edges
under this candidate construction. This experiment describes the draft's
interpretation of crossing and simultaneous peaks; it does not establish
that every possible interpretation of the prose landmark rules fails.

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

## CI investigation

Release run [44033456322](https://github.com/konard/voice-simulator/actions/runs/44033456322)
started at 2026-11-17 06:44:30 UTC, after commit `349d325` (06:42:54 UTC),
with matching head SHA. Its full log is preserved locally in
`ci-logs/release-44033456322.log` (48265 lines). Node/Ubuntu reports four
failures at lines 43991–44050: the missing case-study index entry and the
three quality gates. The index entry is corrected in the follow-up commit;
the quality assertions remain unchanged. All nine OS/runtime jobs reproduce
the same quality failures. Their RTF measurements range from 0.000124 to
0.000865, below the 0.02 target. Rust Engine, compilation, lint, documentation,
line limits, simulation checks and Docker build checks all pass.

Links run [44033456196](https://github.com/konard/voice-simulator/actions/runs/44033456196)
failed on the existing PTDB-TUG citation in the pitch report: the server timed
out after retries (local `ci-logs/links-44033456196.log`, lines 225–255).
Its archive diagnostic supplies the 2026-10-05 snapshot (lines 310–327).
The report and its generator now cite that snapshot while preserving the
original registry URL. The existing report-generation check passes. No link
checks or quality gates are disabled.

## Remaining work

Resolve the contradictory timing contract and the unreachable nucleus target
before treating this as a releasable stage. Class accuracy and the four
missing landmark edges also need an effective algorithm or input change;
repeatable calibration alone does not fix them. Keep the three ordinary test
failures visible and keep PR #142 unmerged until every criterion is met.
