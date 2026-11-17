# Issue 61 implementation and verification

Objective: fully implement issue 61 in PR 141 on issue-61-12f3a026e073.
Issue and PR conversation, inline comments, reviews and sub-issue list read;
all are empty. Prerequisite 58 and breathiness fix 32 are closed.

- [x] Read vision, roadmap, contributing rules and existing front end/pitch code.
- [x] Implement batch IAIF, supplied/local pitch, high-pass, overlap-add and GCI.
- [x] Implement NAQ, LF/Rd/OQ fitting, both H1-H2, HNR, CPP, low-band detection,
      reliability and quartile summaries, with validation and typed exports.
- [x] Add known-source, noise, closure, telephone, speech, edge and CPU checks.
- [x] Port the same numerical code to Rust and extend parity checks.
- [x] Update README, command-line help, roadmap, issue-11 audit and minor changeset.
- [x] Verify Node/Bun/Deno, npm check/test, Rust fmt/clippy/test and parity.
- [x] Measure six Rd errors, audit trends and CI RTF <= 0.10.
- [x] Reconcile latest main, review gh pr diff, commit, push only prepared branch.
- [x] Update PR title/body with requirements/evidence and Fixes #61; track the
      final CI SHA and readiness in PR 141. No acceptance target silently relaxed.

Finalization gate, checked on GitHub after the last push: all CI green, clean
working tree, then mark ready. The PR records this state without another commit.

CI protocol: list latest five runs with timestamps/SHA, compare latest commit;
save every failing log under ci-logs, read specific failures, fix and recheck.
Local memory-heavy commands run sequentially; Rust uses one build job.

Focused Node/Bun/Deno checks pass (11 tests each). `npm run check`, Rust
fmt/clippy and workspace tests pass (92 Rust tests). Full Node suite passes
with two CPUs available: 2897 passed, zero failures, 15 skipped. Rebuilt Wasm
parity passes all five cases, including the missing-low-band branch.
Node isolated CPU check: 0.0964 RTF (0.10 enforced); Bun 0.0590, Deno 0.0787.
Derivative correlation: 0.99594 at 16 kHz, 0.99720 at 8 kHz. Known-noise HNR:
19.425 dB. Clean-minus-noise CPP: 7.2124 dB. Closure single/accurate: 100%/100%.
Rd medians at 110 Hz: 1.50, 1.08, 0.54; at 220 Hz: 1.74, 1.14, 0.54.
Current source truth after #32 is 1.8, 1.2, 0.6 for breathiness zero; all six
are within 0.4. The first misses the 0.25 goal by 0.05; report all errors and
the issue's stale nominal targets (2.1, 1.5, 0.9) explicitly in the PR.

`node experiments/issue-11-audit.mjs` gives HNR 15.9642, 15.2868, 7.3600 dB
and CPP 3.3428, 1.1606, 0.8008 for breathiness 0, 0.5, 1: both decrease.
CI run 44035343600 on 326405d passed the nine runtime jobs and the Rust engine;
the dedicated Ubuntu Node CPU check measured 0.03350 RTF. Its companion link
run 44035343515 failed on an existing PTDB-TUG citation (saved as
`ci-logs/links-job-133876788349.log`, lines 225, 246, 271). Its suggested
2026-10-05 archive replaces that citation in the registry
and generated pitch report. Latest-head CI must pass before readiness.

A bounded Rust regression reproduced a panic for supplied f0 = rate / 4:
the harmonic table then has only one entry, so H1-H2 must be NaN as in JS.
`ci-logs/inverse-boundary-before.log` records the failure; the same test passes
after replacing the second-harmonic index with a checked lookup. JS and rebuilt
Wasm parity tests also cover the boundary. Final measured scalar/SIMD files:
278782 / 286142 bytes after merging main through 1f016e0 (the articulatory
codebook), below the unchanged 294912-byte ceiling. Both public APIs are
preserved, and the generated pitch citation uses the archived label from main.
