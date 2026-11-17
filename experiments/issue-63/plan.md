# Issue 63: voice configuration fit

Objective: implement and verify the complete scope of issue 63 in PR 146.
Prerequisites 59, 60, 61, 17 and 32 are closed. Issues 33 and 41 are
merged; include optional fold-source refinement and saveVoice compatibility.
Issue 62 is open and landmarks.js is absent: use envelope syllable nuclei.
The issue and PR have no comments, inline comments or reviews at start.

## Requirements and verification

- [ ] Stage A: shared frame/pitch/formant/source analysis; fixed JSON
      histograms, counts, mel and perturbation sums; 20-frame rejection.
- [ ] Part selection, default parameters, bounded estimates and MAD SDs;
      committed reproducible calibration of pitch range, breathiness and rate.
- [ ] Stage B: scaled feature objective, aligned MCD with transcript,
      regularisation and deterministic two-round bounded Nelder-Mead search.
- [ ] Budget, seed, callback, progress generator, final simplex SD and full
      result, with all legacy feature keys plus source diagnostics.
- [ ] Incremental fitter and JSON continuation, fixed state size, split
      recording agreement, optional refinement of an explicitly supplied stretch.
- [ ] Legacy match wrappers and unchanged tests; example worker compatibility.
- [ ] Rust numerical implementation and automated parity tests.
- [ ] Public exports and declarations, README, CLI help, roadmap, minor changeset.
- [ ] Unit gates: two specified heads, transcript/no transcript/8 kHz,
      uncertainty, continuation, determinism and exactly five legacy result keys.
- [ ] Heavy copy suite: all 20 seeded heads, error/coverage gates; every
      golden speaker with/without transcript, distance and aligned MCD versus
      nearest preset, tract length with manifest sex; committed report copy.
- [ ] Stage A <= 0.3 RTF and default fit <= 60 s for 10 s audio, measured.
- [ ] Node/Bun/Deno focused tests, npm check/test, app tests and Rust checks.
- [ ] Preserve useful atomic commits, merge latest main, push only prepared
      branch, review PR diff, update PR title/body with Fixes #63, verify current
      CI and heavy runs, clean tree, mark PR ready after completion.

## Work sequence

1. Read guidance and related APIs/PRs; establish reproducible baseline probes.
2. Draft all library, tests, Rust and documentation requirements.
3. Run focused checks, investigate measured failures without relaxing gates.
4. Commit/push, run heavy/performance and standard CI, preserve failure logs,
   correct failures, commit reports and finalise PR.

Logs stay in this experiment directory and CI failures in ci-logs/ (ignored).
No required criteria are complete until backed by measured evidence below.
