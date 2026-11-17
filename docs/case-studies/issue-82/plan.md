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
- [ ] Benchmark every feature probe and every tier on one thread for at least
      two seconds; median Rust/JS <= 1.0; commit engine-parity report and trend.
- [x] README, contributing, Rust docs, roadmap, types, CLI help and minor changeset.
- [ ] Focused regressions, npm check/test, cargo workspace tests/clippy/fmt, wasm
      parity and current-commit CI; save and inspect any failing CI logs.
- [ ] Merge latest main, review complete PR diff, update title/body with Fixes #82,
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
