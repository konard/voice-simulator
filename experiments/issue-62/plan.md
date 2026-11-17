# Issue 62: CI investigation and acceptance plan

Objective: satisfy issue 62 in PR 142, resolve conflicts with current main,
and verify every CI check without weakening the requested quality gates.

- [x] Read the complete issue, all PR conversation comments, inline comments
      and reviews; check required sub-issues and prerequisite states.
- [x] Preserve fresh failing CI logs and verify their timestamps/head SHA.
- [x] Change investigation approach: probe streaming suppression with finite
      generated frames instead of repeating threshold tuning.
- [x] Fix duplicate streaming landmarks and changing group strengths;
      add a failing-before/passing-after regression and a bounded probe.
- [x] Merge main bc76d97, retaining formants, inverse filtering, codebook,
      landmark exports/types and all numerical parity suites.
- [x] Measure the combined WASM and update its size budget and regression.
- [x] Run focused validation and npm run check with low local resource use;
      rebuild only the merged scalar/SIMD WASM needed for size/parity checks.
- [ ] Verify full npm test and workspace checks through existing CI rather
      than duplicating the runtime matrix locally.
- [x] Commit atomic changes, push only issue-62-c339234ca063, review the PR
      diff and update its title/body with implementation and validation.
- [x] Wait for all 52a62a5 checks; investigate every fresh failure log.
- [x] Fix the newly exposed anatomy download cancellation race, with
      bounded failing-before/passing-after tests across all runtimes.
- [ ] Verify the final pushed commit through all CI workflows.
- [ ] Mark PR ready only after every required acceptance criterion passes.

Acceptance requirements remain those in the complete inventory at
docs/case-studies/issue-62/README.md. No required sub-issues were returned by
the API; prerequisites 58 and 17 are closed. The supplied failure is workflow
44044032753 at 08:07:19 UTC on 0c22080 (commit time 08:06:24 UTC), preserved
as ci-logs/checks-44044032753.log. All nine test jobs fail the same three
quality gates; Pipeline Status aggregates those failures. There is no
credential or repository-access error in these jobs.

Implemented this restart: 3cbdc12 preserves band-group context and prior
same-type suppression when advancing a stream. Seed 5 previously emitted
two b- events 5 ms apart. The regression now checks both supported hops,
four chunk sizes, append-only output, exact batch equality and separation
on Node.js, Bun and Deno. The finite 128-seed probe uses a 64 MiB JS heap.
Merge fd3120f includes main bc76d97; scalar WASM is 316669 bytes, budget
327680, SIMD 323408 bytes (not shipped). Fourteen focused tests and the
merged formant parity test pass with REQUIRE_WASM=1 and no skips.

Unmet: the same three quality gates fail (63.3333% nucleus recall,
33.3333% extras, 48.2459%/47.1143% class accuracy, four missing edges).
The prescribed voiced-maximum superset covers only 98/120 centres.
causality.mjs proves the 150 ms cleanup/60 ms commitment conflict;
confirmation.mjs proves the early irrevocable confirmation/80 ms higher
peak replacement conflict. Neither requirement is silently waived. The
default branch additionally requires the npm bootstrap account action
described in the case study and PR.

Fresh run 44049699561 finished at 08:54:31 UTC on 52a62a5. It confirms all
nine streaming regressions pass and the three quality failures remain.
Deno/Windows additionally loses an anatomy archive response body; Bun/macOS
hits a 30-second anatomy test deadline. Optional cancellation now propagates
through ZIP download requests, bodies and retry backoff. Preparation runs
before test registration with a 20-second total budget and explicit transport
skip diagnostics; corrupt archives and programming errors remain failures.
Seven focused regressions pass on Node/Bun/Deno; two fail on the old downloader.
All ten Node dental tests, including the live reference comparison, pass.

Main advanced to 0b6c090 during run 44053013302; all nine runtime jobs
stopped at merge conflicts before tests. Merge both IPA recognition and
landmark modules/parity suites. Combined scalar: 364154 bytes, budget
376832; SIMD: 369754, unshipped. Seventeen focused checks and separate
formant parity pass with REQUIRE_WASM=1. The quality measurements and
98/120 candidate ceiling are unchanged. Preserve and inspect the next
current-commit CI run before reporting completion or blockers.

## Fourth restart: verify the contract through the public API

- [x] Re-read issue 62, every issue/PR conversation comment, inline comment
      and review, and the empty required-sub-issues endpoint. Both
      prerequisites remain closed; no later feedback changes the contract.
- [x] Fetch the default branch. Main remains 0b6c090, already an ancestor
      of HEAD 0025dcb; no merge or history rewrite is needed.
- [x] Download current failing run 44054878814 again and verify it started
      after its matching commit. All nine jobs fail exactly the three
      quality assertions; no missing credential causes the runtime failures.
- [x] Independently repeat the nucleus candidate superset, smoothing
      sensitivity and landmark candidate measurements with finite inputs.
- [x] Change approach from internal helper counterexamples to actual PCM:
      stream-closure.mjs reproduces the incompatible batch/stream labels
      through both public analyzers and both public landmark APIs on all
      three runtimes. Signals and all feature prefixes are identical at
      the commitment deadline, including front-end window lookahead.
- [x] Run the focused Node suite: 9 pass, 3 unchanged quality failures.
- [x] Validate, commit and push the public-API counterexample and updated
      evidence in a6e3e83; review its final diff and clean working tree.
- [x] Inspect all a6e3e83 CI results and preserve the complete failure log.
      All nine jobs have the same three quality failures; other checks pass.
- [x] Merge newly advanced main 80b9c3d, retaining the feature inventory,
      engine parity and landmark parity suites. Measure combined WASM:
      scalar 415183, SIMD 421828 (unshipped), next 16 KiB budget 425984.
- [x] Verify the merged engine: 70 focused checks pass without skips;
      cargo fmt passes. The public PCM conflict repeats on all runtimes,
      and the focused quality suite retains the same three failures.
- [x] Commit and push the merge, inspect all resulting CI and update
      PR 142 with the final evidence.
- [ ] Complete all original quality and timing requirements. Blocked by
      the unchanged incompatible contract; class and edge accuracy also
      remain unresolved. No test waiver is authorised by this finding.
- [ ] Mark ready only after all requirements and all CI checks pass.

## Fifth restart: independently bound the fine-band edge candidates

- [x] Re-read the complete issue, all comments and reviews; required
      sub-issues remain empty and prerequisites remain closed.
- [x] Fetch origin and confirm main 80b9c3d is already in HEAD 311681b.
- [x] Download latest failed run 44062832031 and default-branch run
      44060989726, verify SHAs/timestamps, and inspect actual failures.
- [x] Reproduce the focused quality suite: nine pass, three fail, with
      unchanged nucleus, class and edge measurements.
- [x] Change approach: independently enumerate the necessary fine-band
      falling peaks through the public analyzer, without calling the
      detector or any of its numerical helpers. Check rounding both ways,
      literal 13 ms interpolation and all continuous-time slope changes.
      No allowed peak is within 20 ms of the requested apa closure edge.
- [x] Recheck nucleus smoothing sensitivity and class-search diagnostics.
      Neither provides a valid route to the required quality gates.
- [x] Verify the new finite experiment on Node.js, Bun and Deno; check
      formatting/lint and commit the experiment and exact evidence.
- [ ] Push only issue-62-c339234ca063, review the current diff, update
      PR 142 and wait for every resulting CI job to finish.
- [ ] All acceptance criteria pass. Blocked by the unchanged nucleus,
      fine-peak placement and causal commitment contradictions. Class
      accuracy also remains unresolved; do not waive its gate.
- [ ] Mark ready only after every requirement and all checks pass.

### New main during the fifth-restart CI

- [x] Wait for every 855b325 workflow, preserve full run 44067794069 and
      inspect all nine runtime error blocks. Only the same three quality
      assertions fail; all other applicable checks pass.
- [x] Fetch newly advanced main eeb2869 and resolve both WASM modules and
      the measured size-budget conflicts, retaining all APIs and suites.
      Combined scalar is 467028 bytes, SIMD 473723 (unshipped), next
      16 KiB budget 475136. Build with CARGO_BUILD_JOBS=1.
- [x] Verify the merged build with focused parity, check the unchanged
      quality failures and feasibility probes, and run formatting/lint.
- [ ] Commit and push the merge, review its diff, inspect all resulting
      CI and update the PR with final measurements and blockers.
