# Issue 62: syllable nuclei, landmarks and broad classes

Issue: <https://github.com/konard/voice-simulator/issues/62>.
Pull request: <https://github.com/konard/voice-simulator/pull/142>.

## Status: unfinished

The implementation is an experimental draft. The requested quality gates
remain failing. Required timing rules conflict with each other, and the
prescribed peak candidates cannot reach the recall target on the current
signals. These are not waived by passing the mechanical tests.
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

### Irrevocable early confirmation conflicts with later peak replacement

Run:

```sh
node --max-old-space-size=64 experiments/issue-62/confirmation.mjs
```

The two already-smoothed sonority inputs are identical through 0.140 s.
Both have a peak at 0.100 s followed by a 6 dB dip, and both pass the
noise and periodicity gates. After its 40 ms maximum window, the issue
requires this peak to be confirmed irreversibly. One continuation stays
low; the other has a higher peak at 0.160 s, 60 ms after the first peak.
The latter must replace the first peak under the 80 ms spacing rule.

These requirements cannot both hold for a causal detector: the decision
at 0.140 s is identical for both inputs, but one later requires retracting
that decision. The finite experiment asserts the identical prefixes,
the early confirmation and the subsequent spacing conflict. The draft
keeps the first peak in both cases to preserve irreversible confirmation.
Resolving this needs a later confirmation deadline, provisional events,
or a replacement rule that exempts already confirmed peaks.

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

## Original draft measurements

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

## Follow-up CI and conflict investigation (2026-11-17)

The follow-up read the complete issue, all current issue and PR conversation
comments, inline comments and reviews. No required sub-issues were returned by
the GitHub sub-issues endpoint; prerequisites #58 and #17 remain closed.

Plan and verification:

- [x] Fetch current `main`, merge it without rewriting history, and preserve
      both the new codebook API and landmark API in the exports and types.
- [x] Download the failing workflow logs and match their head SHA and timestamps
      to the commits under investigation.
- [x] Reproduce the quality failures with focused Node.js, Bun and Deno runs.
- [x] Investigate the prescribed peak superset, causal cleanup, band-edge
      signals and class thresholds with bounded, committed experiments.
- [x] Fix the extra nucleus speech-flag gate in JavaScript and Rust, with a
      regression that fails before the fix and passes afterward.
- [x] Repair the merged README line limit and align the pitch report generator
      with the archived citation already on `main`.
- [x] Rebuild the merged WASM engine, verify numerical parity and its size,
      and regenerate the complete 24-utterance golden report.
- [ ] Verify all current-head CI jobs pass; the three quality gates are still
      unmet and must remain visible.

Merge commit `939b180` includes `main` commit `1f016e0`. Conflicts were in
`src/index.js`, `src/index.d.ts` and the pitch report citation. The existing
codebook and CLI tests pass (23 tests). The generated pitch Markdown and JSON
match their committed snapshots byte for byte after running the report test.

Run [44035526815](https://github.com/konard/voice-simulator/actions/runs/44035526815)
started at 07:01:34 UTC on `2fddc67` (committed at 07:00:55 UTC). All nine test
jobs failed the same three quality assertions; the full log is preserved in
`ci-logs/release-44035526815.log`. The Node/Ubuntu assertions are at lines
18024, 18036 and 18050. This is an algorithm-quality failure, with no missing
secret or private-repository access involved.

After the merge, run
[44038269916](https://github.com/konard/voice-simulator/actions/runs/44038269916)
started at 07:23:02 UTC on `939b180` (committed at 07:22:47 UTC). It failed
before the test matrix because the combined README had 1502 lines (full log
`ci-logs/release-44038269916.log`, lines 3348–3352). Reflowing existing prose
reduces it to 1498 without removing content. The file-line-limit script passes.
The four other workflows passed on that merge commit, as did Rust Engine.

The latest default-branch release run,
[44037340756](https://github.com/konard/voice-simulator/actions/runs/44037340756),
started at 07:15:48 UTC on `1f016e0`. Its tests pass; Release Preflight and
Pipeline Status fail because the package is not yet published to npm and no
bootstrap token is configured (local log
`ci-logs/release-main-44037340756.log`, lines 158–160 and 44804–44805).
The existing workflow already reports this credential failure without blocking
PR checks, and fails explicitly on `main`. A maintainer must add an
`NPM_TOKEN` repository secret containing a granular token allowed to publish
`voice-simulator` at the repository's Actions secrets settings, then rerun the
release. After its first publication, configure the trusted publisher for
`konard/voice-simulator`, workflow `release.yml`, at the npm package's access
settings and delete the bootstrap secret. No publishing credentials are
available to complete that account action here.

The extra `speech !== 0` nucleus gate was not in issue rule 3: only sonority,
noise and periodicity gate an eligible local maximum. The new regression
constructs a voiced sonority peak with `speech` zero; it previously returned
zero nuclei and now returns one. A Rust unit test checks the same condition.
The synthetic sentence measurements are unchanged by this correction.

| Follow-up command                                                                              | Result                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `node --test tests/recognition-landmarks.test.js`                                              | 9 pass, 3 quality failures; recall 63.3333%, extras/truth 33.3333%; classes 48.2459% / 47.1143% at 16 / 8 kHz                     |
| `bun test tests/recognition-landmarks.test.js`                                                 | Same 9 pass and 3 failures; RTF 0.000389 (use the repository's normal `--timeout 30000` for the full suite)                       |
| `deno test -A tests/recognition-landmarks.test.js`                                             | Same 9 pass and 3 failures; RTF 0.000647                                                                                          |
| `CARGO_BUILD_JOBS=1 cargo test --locked -p voice-simulator-core landmarks::tests`              | Both focused tests pass                                                                                                           |
| `CARGO_BUILD_JOBS=1 node scripts/build-wasm.mjs --require --check-size`                        | Pass; scalar 240350 bytes, below 245760; SIMD builds but is not shipped                                                           |
| `REQUIRE_WASM=1 node --test tests/rust-landmarks.test.js tests/engine-size.test.js`            | 4 tests pass; all 12 parity combinations agree, maximum relative RMS 6.77e-17                                                     |
| `node --test --test-name-pattern='counts syllables' tests/heavy/recognition-landmarks.test.js` | 24 utterances; refreshed snapshot MARE 24.41%, versus 19.32% before removing the extra gate; the 15% target remains a measurement |

The new `edge-signals.mjs` experiment prints the coarse and fine band rises
around `apa` and `ama`; it confirms the measured edge mismatches described
above. `stream-landmarks.mjs` finds exactly the same 16 landmarks in batch and
streams with 5, 10, 20 and 40 ms chunks on `apa asa ama aba`.

`node --max-old-space-size=256 experiments/issue-62/class-search.mjs` tries a
finite three-round coordinate search directly on the sentence labels as a
**diagnostic only**. It reaches 70.9166% at 16 kHz and 69.7473% at 8 kHz, still
below the gates. This is not a mathematical upper bound. Those held-out labels
must not choose shipped thresholds, so the specified full-material calibration
and its thresholds are preserved. This attempt has not resolved class accuracy.

The nucleus-ceiling and causality experiments reproduce the same blockers
after merging `main` and correcting the nucleus gate. No CI quality assertion
has been weakened, skipped or converted to an allowed failure. The PR remains
unfinished; the specification conflicts need resolution before every requested
acceptance criterion can pass.

## Second CI restart and inverse-filter merge (2026-11-17)

The latest supplied failure,
[44040092585](https://github.com/konard/voice-simulator/actions/runs/44040092585),
started at 07:37:04 UTC after commit `9d409e0` at 07:36:54 UTC. All nine
runtime jobs fail the same three quality assertions. Its preserved log is
`ci-logs/checks-44040092585.log`: Node/Ubuntu's assertions are at lines
44124 (nuclei), 44136 (classes) and 44150 (landmarks); measurements are at
42173–42181. Pipeline Status reports the failed test matrix at line 48363.
This is fresh evidence, not a failure from a commit preceding the changes.

Merge `93ad6d9` incorporates `main` at `722373a`, preserving both the
inverse-filter and landmark APIs, their declarations, Rust/WASM modules,
both parity suites in CI, and the archived pitch citation. The prior
codebook implementation is retained. No existing feature was removed.

A newly isolated defect left nucleus strength stale when a later peak
revealed a deeper boundary minimum. The three public-API regressions in
`tests/recognition-landmark-boundaries.test.js` failed before the fix:
`31.375` was returned instead of `39.44318199157715`. Both implementations
now recompute strength whenever a completed boundary changes. Batch,
trailing-nonspeech and streamed cases pass on Node.js, Bun and Deno;
a focused Rust unit test and two additional WASM parity cases cover the
same correction.

Validation after the merge and boundary correction:

| Command                                                                                                                                                             | Result                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                                                                                                     | Pass: lint, formatting, duplication budget and dependency policy                                                             |
| `node --test --test-timeout=30000 tests/recognition-landmarks.test.js`                                                                                              | 9 pass, the same 3 quality failures; recall 63.3333%, extras 33.3333%, classes 48.2459% / 47.1143%, RTF 0.000696             |
| `node --test tests/recognition-landmark-boundaries.test.js`                                                                                                         | All 3 regressions pass; Bun and Deno also pass all 3                                                                         |
| `CARGO_BUILD_JOBS=1 cargo test --locked -p voice-simulator-core landmarks::tests`                                                                                   | All 3 focused unit tests pass                                                                                                |
| `CARGO_BUILD_JOBS=1 node scripts/build-wasm.mjs --require --check-size`                                                                                             | Scalar 310436 bytes, below the 311296-byte budget; SIMD 317184 bytes builds but is not shipped                               |
| `REQUIRE_WASM=1 node --test tests/rust-landmarks.test.js tests/rust-inverse-filter.test.js tests/engine-size.test.js tests/recognition-landmark-boundaries.test.js` | All 13 tests pass, no skips; original 12 landmark parity cases plus both new boundary cases; inverse-filter parity preserved |

The merged scalar WASM exceeded `main`'s 294912-byte budget by 15524 bytes.
The new budget is the next 16 KiB boundary, 311296 bytes (304 KiB), for the
measured combined implementation. The byte count is checked during builds
and in the engine-size regression. The scalar SHA-256 is
`c85d4f5d355540f8c518cb46e22c68b39c969ced18f2ea0288aa1e2d919cb78a`.
No accuracy assertion was changed. Full runtime suites and workspace checks
remain assigned to CI rather than duplicating those builds locally.

The candidate-superset experiment still recovers only 98/120 centres after
the merge. The closure experiment still requires two different final labels
for identical input prefixes at the commitment deadline. The new finite
confirmation experiment above isolates a second incompatible timing pair;
it does not turn an unmet requirement into a passing test.

Latest default-branch run
[44041583200](https://github.com/konard/voice-simulator/actions/runs/44041583200)
on `722373a` passes the runtime tests and fails only Release Preflight and
its aggregate Pipeline Status. Its log, preserved as
`ci-logs/main-checks-44041583200.log`, explains the npm bootstrap at lines
147–160. The existing workflow already passes this credential-dependent
preflight on pull requests and fails explicitly on `main`.

A maintainer must add repository Actions secret `NPM_TOKEN` containing a
granular token allowed to publish `voice-simulator`, then rerun the release.
After first publication, configure the npm trusted publisher for repository
`konard/voice-simulator`, workflow `release.yml`, then delete that bootstrap
secret. This external account action is separate from the three quality
failures on this PR.

## Third CI restart: streaming suppression and formant merge (2026-11-17)

The supplied run
[44044032753](https://github.com/konard/voice-simulator/actions/runs/44044032753)
started at 08:07:19 UTC on `0c22080` (commit 08:06:24 UTC). All nine runtime
jobs failed the same three quality tests. Its full log is preserved in
`ci-logs/checks-44044032753.log`; Node/Ubuntu prints nucleus measurements
at line 21478, class accuracy at 21479–21480, four missing edges at 21485,
and RTF at 21486. The issue, comments, sub-issues and all three PR comment
endpoints were read again; there are no additional requirements.

This investigation used generated streaming frames to test suppression
history instead of repeating calibration. Seed 5 in
`experiments/issue-62/stream-candidates.mjs` produced two `b-` landmarks at
0.165 and 0.170 s in streaming mode; batch mode kept only the first.
Recomputing a window discarded an earlier suppression decision and nearby
band peaks used in group strength. Commit `3cbdc12` carries the last prior
candidate of each type into suppression and retains the neighbouring bands.
The bounded window still limits repeated candidate processing.

`tests/recognition-landmark-streaming.test.js` fails on the previous source
and passes after the correction on Node.js, Bun and Deno. It covers both
supported hops, a nonzero start time, four chunk sizes, immutable appended
events, exact batch equality and the 20 ms same-type separation. The finite
probe checks 128 seeds with four chunk sizes:

```sh
node --max-old-space-size=64 experiments/issue-62/stream-candidates.mjs
```

Merge `fd3120f` includes `main` at `bc76d97`, retaining the formant tracker,
inverse-filter and codebook APIs and their Rust/WASM parity coverage. The
combined scalar measures **316669 bytes**, SHA-256
`cc60fc93e8a11ce1a3c6fafcf957c2d18f5b1da6deb8cebcb270fab844537367`;
the next 16 KiB size budget is **327680 bytes**. SIMD builds at 323408 bytes
and remains unshipped. The measurement command was
`CARGO_BUILD_JOBS=1 node scripts/build-wasm.mjs --require --check-size`.

With `REQUIRE_WASM=1`, the landmark/inverse-filter parity, engine-size,
boundary and streaming files pass all 14 focused tests without skips. The
separate `Rust formant primitives` test passes at both 8 and 16 kHz, with
zero measured candidate-frequency difference. These checks verify the merge
and the streaming correction; they do not satisfy the three quality gates.

Default-branch run
[44046913741](https://github.com/konard/voice-simulator/actions/runs/44046913741)
on `bc76d97` still fails Release Preflight for the npm bootstrap account
action. Its log is `ci-logs/main-checks-44046913741.log`, lines 152–160.
The existing PR preflight skips that credential-dependent operation and
explains why; `main` reports the exact maintainer action described above.

## Remaining work

Resolve the contradictory timing contract and the unreachable nucleus target
before treating this as a releasable stage. Class accuracy and the four
missing landmark edges also need an effective algorithm or input change;
repeatable calibration alone does not fix them. Keep the three ordinary test
failures visible and keep PR #142 unmerged until every criterion is met.
