# Issue 62: second CI restart

Objective: satisfy issue 62 in PR 142, resolve conflicts with current main,
and verify every CI check without weakening the requested quality gates.

- [x] Read the complete issue, all PR conversation comments, inline comments
      and reviews; check required sub-issues and prerequisite states.
- [x] Preserve fresh failing CI logs and verify their timestamps/head SHA.
- [x] Merge current main, retaining both inverse-filter and landmark APIs,
      both WASM parity suites, and the current release preflight behavior.
- [x] Reproduce the quality failures after merging and investigate a different
      approach from repeated threshold tuning.
- [x] Fix reproducible implementation defects with focused regression tests
      in both JavaScript and Rust; preserve existing behavior elsewhere.
- [x] Recheck the nucleus candidate ceiling and causal timing counterexamples
      against the merged code. Map any impossible criteria to exact evidence.
- [x] Run focused validation and npm run check with low local resource use;
      rebuild only the merged scalar/SIMD WASM needed for size/parity checks.
- [ ] Verify full npm test and workspace checks through existing CI rather
      than duplicating the runtime matrix locally.
- [ ] Commit atomic changes, push only issue-62-c339234ca063, review the PR
      diff and update its title/body with implementation and validation.
- [ ] Wait for all current-commit checks; investigate any fresh failure logs.
- [ ] Mark PR ready only after every required acceptance criterion passes.

Acceptance requirements remain those in the complete inventory at
docs/case-studies/issue-62/README.md. No required sub-issues were returned by
the API; prerequisites 58 and 17 are closed. The latest failure is workflow
44040092585 at 07:37:04 UTC on 9d409e0 (commit time 07:36:54 UTC), preserved
as ci-logs/checks-44040092585.log. All nine test jobs fail the same three
quality gates; Pipeline Status aggregates those failures. There is no
credential or repository-access error in these jobs.

Implemented: merge 93ad6d9 includes main 722373a; boundary-strength bug fix
2355653 has three failing-before/passing-after public-API regressions on
Node.js, Bun and Deno, a Rust unit test, and two WASM parity cases. The
combined engine measures 310436 bytes; a3b0c98 budgets the next 16 KiB
boundary (311296). Focused JS/WASM/inverse-filter checks pass (13 tests),
focused Rust tests pass (3), and npm run check passes.

Unmet: the same three quality gates fail (63.3333% nucleus recall,
33.3333% extras, 48.2459%/47.1143% class accuracy, four missing edges).
The prescribed voiced-maximum superset covers only 98/120 centres.
causality.mjs proves the 150 ms cleanup/60 ms commitment conflict;
confirmation.mjs proves the early irrevocable confirmation/80 ms higher
peak replacement conflict. Neither requirement is silently waived.
