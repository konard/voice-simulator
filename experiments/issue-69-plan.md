# Issue 69 work plan

- [x] Read issue 69 and all comments; dependency 68 is closed. PR 147 has no conversation comments, inline comments or reviews.
- [x] Build lazy count-weighted symbol unigram/bigram/trigram tables from current recognition tries; implement syllable scoring, tone cues, pause-aware Viterbi, island smoothing, ambiguous-span lexical checks, confidence and shares.
- [x] Extend IPA decoding to search all span languages together, with language-labelled candidates, span and transition costs, same-language bigrams and Mandarin joining.
- [x] Export APIs, types, CLI and help; update README/roadmap; add a minor changeset.
- [x] Port numerical scoring, path, confidence, shares and mixed decoding to Rust and extend wasm parity tests.
- [x] Add 12 fixed mixed fixtures (three per requested language pair) and regression/acceptance tests, including seeded noise, confusion matrix, timed input, validation and warmed performance.
- [x] Measure and tune without changing the requested thresholds. Keep scripts in experiments/; no recognition data changes or new dependencies.
- [x] Focused local tests and npm check/test; use sequential low-memory Rust checks and CI for full builds/runtime/platform coverage.
- [ ] Review complete PR diff, merge current main, commit/push only issue-69-747cdfb224e7, update PR title/body with measured evidence, wait for all current-commit CI checks, mark PR 147 ready.

- [x] Tighten mixed transcription verification to exact word boundaries in every language. Reproduce 63/75 (84%) with mismatch cost 2, tune only that cost to 1 and verify 64/75 (85.33%), plus 76/79 (96.20%) syllable-aligned units. Mirror the final cost in Rust.
- [x] Preserve the existing unknown-source CLI diagnostic on the Rust path; the existing regression test now passes with built wasm.
- [ ] Import the unlimited green heavy performance artifact into the trend and engine parity report; finalize current-commit CI and PR metadata.
