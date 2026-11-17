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
- [ ] Verify Node/Bun/Deno, npm check/test, Rust fmt/clippy/test and parity.
- [ ] Measure six Rd errors, audit trends and CI RTF <= 0.10.
- [ ] Merge latest main, review gh pr diff, commit, push only prepared branch.
- [ ] Update PR title/body with requirements/evidence and Fixes #61; all CI green,
      clean working tree; mark ready. No acceptance target silently relaxed.

CI protocol: list latest five runs with timestamps/SHA, compare latest commit;
save every failing log under ci-logs, read specific failures, fix and recheck.
Local memory-heavy commands run sequentially; Rust uses one build job.

Focused Node/Bun/Deno checks pass. `npm run check`, Rust fmt/clippy and
workspace tests pass. Final full Node suite and rebuilt Wasm parity pending.
Node isolated CPU check: 0.0964 RTF (0.10 enforced); Bun 0.0590, Deno 0.0787.
Derivative correlation: 0.99594 at 16 kHz, 0.99720 at 8 kHz. Known-noise HNR:
19.425 dB. Clean-minus-noise CPP: 7.2124 dB. Closure single/accurate: 100%/100%.
Rd medians at 110 Hz: 1.50, 1.08, 0.54; at 220 Hz: 1.74, 1.14, 0.54.
Current source truth after #32 is 1.8, 1.2, 0.6 for breathiness zero; all six
are within 0.4. The first misses the 0.25 goal by 0.05; report all errors and
the issue's stale nominal targets (2.1, 1.5, 0.9) explicitly in the PR.
