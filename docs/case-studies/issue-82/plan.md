# Issue 82: engine parity

Objective: implement and verify every requirement of
[issue #82](https://github.com/konard/voice-simulator/issues/82) in
[PR #145](https://github.com/konard/voice-simulator/pull/145).
All seven prerequisite issues (#25, #33, #34, #35, #36, #53, #54) are closed.
Issue #82 has no comments or sub-issues; PR #145 initially has no conversation,
inline comments or reviews.

- [x] Inventory every acoustics module in frozen ENGINE_FEATURES or reasoned JS_ONLY.
- [x] Expose unique Rust FEATURES through native, wasm and Engine.features().
- [x] Enforce inventory, metadata and module coverage with a build-free checker,
      JSON output, fixture override, npm check and Rust CI.
- [x] Port folds, interaction/subglottal, whisper and 2D; audit turbulence,
      losses, articulators, effort, phonation and narrowband already in Rust.
      Preserve the JS numerical reference; one feature per port commit.
- [x] One finite, short JS probe and wasm parity test per feature, with stated
      sample/spectrum tolerance, seeded randomness and zero render handoffs.
- [x] Generate short JS reference vectors with --write-vectors and compare
      every ported feature in Rust tests without new runtime dependencies.
- [x] Remove missing-feature handoffs, keep load failure handling and count it
      with reasons. Preserve custom solvers and browser WebGPU as explicit JS.
- [x] Benchmark every feature probe and every tier on one thread for at least
      two seconds; median Rust/JS <= 1.0; commit engine-parity report and trend.
- [x] README, contributing, Rust docs, roadmap, types, CLI help and minor changeset.
- [x] Focused regressions, npm check/test, cargo workspace tests/clippy/fmt, wasm
      parity and current-commit CI; save and inspect any failing CI logs.
- [ ] Merge latest main, review complete PR diff, update title/body with Closes #82,
      push only prepared branch, clean tree and mark PR #145 ready; never merge.

Scope: text/IPA planning and geometry construction stay in JavaScript as in the
existing engine architecture; all per-step numerical acoustics must run in Rust.
Recognition remains issue #77. WebGPU host/shader stays JavaScript by issue scope.

Verification: local inventory, npm check, workspace tests/clippy/fmt and seeded
wasm probes pass. The new CI probes and native reference vectors also pass in
[run 44036861775](https://github.com/konard/voice-simulator/actions/runs/44036861775).
That run exposed three obsolete assertions (ABI 4, rejection of folds and 2D)
and README at 1505 lines. Logs are preserved locally under `ci-logs/`:
`rust-44036861775.log:862`, `:873`, `:886`, and
`line-limits-44036861775.log:325`. The assertions now check ABI 5 and rejection
of unknown solvers/sources; the README is within the 1500-line limit.
Current-commit CI and the full performance run remain required before completion.

The next CI merge included four README lines from newly merged main (issue 64),
so `line-limits-44037755178.log:327` reported 1502 lines. Merged main explicitly
and condensed the thread guide while retaining its API and benchmark links.

The runtime matrix then caught two case-study conventions: the plan must link
to its repository issue and appear in the case-study index. Both are now covered
by the existing `tests/case-study-folders.test.js` checks; the original failures
are preserved in `ci-logs/deno-ubuntu-44038066963.log:3887` and `:3895`.

The complete performance suite in
[run 44036883016](https://github.com/konard/voice-simulator/actions/runs/44036883016)
passed all existing performance checks and 27 of the 28 new rows, but the
coarse 3D feature probe took 1.5132 times JS (`heavy-44036883016.log:437`).
The bounded `experiments/issue-82-fdtd-performance.mjs --profile` traced the
extra cost to boxing and copying the large subcell opening table. Packing now
copies its typed-array views directly into the final little-endian buffer.
A 10,262,656-byte coarse model has the same SHA-256 before and after
(`eb10f9bc83c3d087c83302693560443e192e20ce91bc4a2beab6d641b61ef9e0`);
local packing fell from 170–255 ms to 11–17 ms. The existing Rust byte-for-byte
repack test passes. A focused Node 24 performance run (`HEAVY_LIMIT=2` with
`tests/heavy/performance-parity.test.js`) passes at 0.8684 Rust/JS for this probe;
the complete CI performance suite must still pass before its report is copied.

All nine Node/Bun/Deno by Linux/macOS/Windows test jobs and the Rust job passed
on commit 6962734 in
[run 44038929770](https://github.com/konard/voice-simulator/actions/runs/44038929770).

Final API review also found that folds must retain the reference's empty
transferable source state. The Rust wrapper now returns an empty array and
ignores supplied state for this source, while LF save/restore is unchanged.
The new `preserves the empty transferable state of the fold source` regression
fails with the pre-fix wrapper and passes with the fix.

While the final tests ran, main merged source analysis (issue 61). The next
matrix run failed at merge simulation, before tests, with conflicts in the
workflow, build budget and size assertion (`ci-logs/checks-44041210533.log:10611`,
`:10615`, `:10623`). Merged main 722373a, retained both sets of Rust parity
tests and measured the combined wasm: scalar 329,242 bytes, SIMD 338,207.
The size budget follows the existing rounding rule at 344,064 bytes (336 KiB).

The second complete performance run,
[44040834671](https://github.com/konard/voice-simulator/actions/runs/44040834671),
passed the existing performance files and 27 new rows. Coarse 3D still narrowly
failed at 1.0155 Rust/JS (`ci-logs/heavy-44040834671.log:437`). Packing the model
directly into its temporary wasm input allocation removes the remaining large
host copy, without excluding initialization from the benchmark. Byte-layout
tests cover reused aligned and unaligned buffers, including zero padding and
untouched surrounding bytes. All 33 wasm feature/API parity checks and eight
layout checks pass; the focused Node 24 benchmark passes at 0.9068 for coarse
3D. The full performance suite must still pass before publishing its report.

The final reset audit found that 3D retained its incident glottal pressure after
reset. The two-cell native `fdtd_reset` regression fails before clearing the
three new interaction state values and passes afterward in both flow and
microphone modes, matching JavaScript without changing its reference behavior.

All nine runtime/OS matrix jobs and the Rust job pass with both follow-up fixes
in [run 44044540737](https://github.com/konard/voice-simulator/actions/runs/44044540737)
on commit 6e2c448. The remaining broken-link errors point only to the performance
report, which is added after the complete speed suite passes.

The complete, unlimited performance suite passes on the same commit in
[run 44044547448](https://github.com/konard/voice-simulator/actions/runs/44044547448):
all five test files pass, including all 18 feature and 10 tier rows of the new
strict speed gate. Rust/JS medians range from 0.4568 to 0.9722; coarse 3D is
0.9417. The raw artifact was checked for finite measurements, at least two
seconds per engine and at least three runs in every row. Its measured table is
committed as `docs/reports/engine-parity.md`; its passing tier report updates
`performance-history.json` and `performance.md` through the existing trend
command. This final commit contains documentation and measured reports only;
the PR status checks verify it before the PR is marked ready, without merging.

Main subsequently merged formant recognition (issue 60, bc76d97). Retained its
new core module alongside folds and measured the combined wasm again: scalar
335,481 bytes, SIMD 344,421. The existing rounding rule gives 360,448 bytes
(352 KiB). The synthesis sources are unchanged by this upstream merge; the full
performance suite is rerun to verify the combined binary before finalization.

That rerun, [44047874277](https://github.com/konard/voice-simulator/actions/runs/44047874277),
passes all four existing performance files and 27 new rows, but the reference
tier measures 1.02295 Rust/JS on AMD EPYC 7763 (`ci-logs/heavy-44047874277.log:437`).
The strict limit remains 1.0; the earlier passing report is retained while the
scalar kernel is investigated with bounded, interleaved experiments.

The field comparison in that investigation caught a direct-packing regression:
the model header reader ignored the input's offset within wasm memory, causing
`RustVoiceRenderer.field()` to return an empty pressure array. The new
`returns the complete field after packing into wasm memory` regression fails
before the fix (`Expected 0 to be 695`) and passes afterward, comparing finite
cell pressures with JavaScript within 1e-4. Header reads now accept the model
offset without copying the packed model.

Bounded scalar-kernel comparisons did not find a reliable gain from checked
loop unrolling, alternate optimization levels or bounds proofs; these variants
were reverted. The wasm disassembly showed repeated index checks and address
calculations. `Fdtd3d::step_grid` now advances pointers through its private,
validated arrays, preserving the exact scatter order and keeping the public
`Grid::step` checked. Construction also rejects mismatched endpoint lengths.
The unsafe exception is confined to that method, documented and enforced by
the existing architecture test; native and SIMD steps retain their old path.

Command: `node --max-old-space-size=256 --stack-size=512 experiments/issue-82-validated-grid.mjs before.wasm after.wasm`.
On the fixed studio grid (4,690 cells), two interleaved five-run comparisons
measured median times of 661.65 vs 572.32 ms and 579.75 vs 537.29 ms per 10,000
steps after 100,000 warm-up steps. The pressure fields match bit for bit.
The native `fdtd_reset` target passes both the reset test and rejection of
out-of-range endpoints and mismatched arrays. All 50 focused wasm parity,
3D solver/field, size and architecture checks pass without skips. The builds
measure 336,038 bytes scalar and 344,435 bytes SIMD within the existing budget.
The complete CI speed gate remains required before finalizing the implementation.
