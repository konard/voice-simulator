# Issue 71 work plan

Objective: implement every applicable requirement of issue 71 in PR 148 and
verify every acceptance criterion. No reduced synthetic accuracy gates or deferred scope.

Research (2026-11-17): complete issue and comments read; PR conversation,
inline comments and reviews empty; no sub-issues. Blockers 61, 52, 53, 54,
55 and 17 closed. Conditional dependencies 56, 14, 16 merged; 70, 72, 73,
75 open. Use fallback whisper rule; export standalone integration API.

- [x] Read vision, roadmap and contributing rules; inspect analysis and markup.
- [x] Per-word vowel features, synthesized voice baseline/cache and utterance
      median fallback; F1 matched by vowel; optional diagnostic tracing.
- [x] Effort inversion/confidence, ordered quality rules and graded labels;
      neighbouring-word rate, smoothing, minimum duration and effort ramps.
- [x] Phrase activation and synthesized emotion references, abstention,
      confidence/intensity and removal of preset effects applied twice.
- [x] Pause sounds (inhale, laughter, filler), IPA writing, plan conversion,
      preserving existing result fields and spans; short-phrase abstention.
- [x] Public exports/types, README, CLI help, roadmap and minor changeset.
- [x] Rust numerical core and JavaScript/Rust parity checks.
- [x] Fast tests on Node, Bun, Deno: neutral speech, 15 labels, boundaries,
      ramps, activation, all emotion classes, baseline-free, 8 kHz, replay.
- [x] RESD registry/license/checksums, heavy first-100 evaluation, 24 golden
      false alarms, measured report and initial measured-minus-5-point gates.
- [ ] Focused tests/check, full CI at current SHA, review diff, merge latest
      main, clean tree, accurate PR description and mark ready when complete.

Verification commands and measured results will be recorded alongside the
implementation and in the final PR description. Heavy work runs sequentially
or in CI within the 2.92 GiB container budget.

Measured locally: focused Node matrix 141/141 passing, eight plain sentences
empty; effort 14/16 exact, 16/16 within one step; whisper 4/4; other
labels 39/40; telephone whisper 4/4, others 53/56; emotion names 46/48,
activation signs 28/28. All twelve reference classes separate in all four
languages. Boundary, crescendo, unknown-voice and all fifteen English label replay checks pass.

Heavy first 100 RESD rows: activation 55%, names 11%; golden false alarms
1/24. Initial ratchets 50%, 6%, <=1/24. Report in docs/reports.
Pause sounds and partial-mode planner integration: 12/12 passing. Dataset
registry/download checks: 17/17 passing. Focused Rust core test passes.
`npm run check` passes. Rust WASM parity, Node/Bun/Deno and full matrix
verification are assigned to current-head CI before finalization.

CI investigation: initial atomic sampling-fix run 44063684431 failed only
because the feature changeset had not yet been committed (log line 984).
The complete draft includes its minor changeset. Logs retained in ci-logs.

Review regressions: preserve cached head snapshots, ramp continuity through
overlapping modes, and short-phrase abstention during ramp fitting. Phrase
pitch range includes intonation between words. Eleven integration checks pass.
Merged-CI failures 44066292401: README line limit (log 8047) and Rust
Clippy fixed-size chunks (log 2678), both corrected; local Clippy passes.

Final phrase-range calibration: 55% activation, 11% names, 1/24 alarms.
The preliminary 63%/18% used median word ranges; the corrected full-phrase
measurement establishes initial 50%/6% gates before this new feature merges.
Synthetic gates retain every requested threshold; names are now 46/48.

Public API review: compile-only `experiments/issue-71/types.ts` failed with
TS2322/TS2561 before correcting partial-mode declarations and passes with
TypeScript 5.9.3. High-level synthesis ignored explicit mode spans; a
regression reproduces neutral instead of angry before the fix and passes
after it. Integration suite 10/10 and focused whisper replay pass.

Performance CI 44066289770: 74/75 passing, strict engine parity gate fails
at ultra/studio/reference (Rust/JS 1.044/1.061/1.057). Logs and artifacts
retained in ci-logs; investigate without relaxing the gate.

Final review: existing sound tokens plus a detected pause sound crashed at
`words[token.word].start`; a regression fails before the fix and passes
after preserving the original token and inserting only new detections.
Integration 11/11 passing. Deno Linux CI 44068609204 failed only its
per-probe CPU budget (log 4683, engine-features line 55); the probe took
304 ms wall time but process CPU included other parallel Deno workers.
Thread CPU accounting retains the 1 s limit; focused Deno 20/20 passing.
Merged main eeb2869 including language recognition without removing either
API. Local bounded ultra benchmark: Rust/JS 0.977, three interleaved runs.

Expanded replay audit: all 15 English labels now retain the exact recognized
word spans through synthesis and a second recognition. Previously pp became
bored (regression log activation-replay-before.log, line 24): activation
was commanding a second change of pitch, effort and rate. `toPlanModes`
retains overlapping anonymous activation with `emotion.realized: true`;
named presets and standalone activation still produce their effects. Node
focused recognition/integration: 153/153 passing. Heavy recognition run
44071583815 passes all four files, including RESD and golden gates.

All regular checks at f03f151 pass across Node/Bun/Deno on all three OSes.
Performance run 44071578193 again passes 74/75; strict parity fails only
studio/reference (1.01477/1.00558, log line 442) on AMD EPYC 7763.
The earlier main green run used Intel Xeon 6975P-C. A bounded byte-offset
cache experiment gave negligible improvement and was reverted; investigate
scalar loop code generation without weakening the existing gate.

Scalar FDTD investigation: the LLVM-generated link loop performs its branch
and pointer bookkeeping once per link. Four ordered updates per iteration
reduce that cost without adding allocations or changing any floating-point
operation; two and eight updates were also compared with the same bounded
`TIER=ultra RUNS=3 TEXT=a node --max-old-space-size=384
experiments/issue-23-render-speed.mjs <before.wasm> <after.wasm>` probe.
Short studio timings vary between comparisons, so the full CI performance
suite remains the acceptance evidence. Native bitwise regression (all prefix
lengths and remainders, shared endpoints and empty grids) passes; WASM solver
and default/teeth/enclosure render parity pass, with zero sample differences.
Clippy passes and the scalar WASM is 441308 bytes (458752-byte budget).
