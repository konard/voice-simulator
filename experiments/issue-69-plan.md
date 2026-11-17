# Issue 69 work plan

- [x] Read issue 69 and all comments; dependency 68 is closed. PR 147 has no conversation comments, inline comments or reviews.
- [x] Build lazy count-weighted symbol unigram/bigram/trigram tables from current recognition tries; implement syllable scoring, tone cues, pause-aware Viterbi, island smoothing, ambiguous-span lexical checks, confidence and shares.
- [x] Extend IPA decoding to search all span languages together, with language-labelled candidates, span and transition costs, same-language bigrams and Mandarin joining.
- [x] Export APIs, types, CLI and help; update README/roadmap; add a minor changeset.
- [x] Port numerical scoring, path, confidence, shares and mixed decoding to Rust and extend wasm parity tests.
- [x] Add 12 fixed mixed fixtures (three per requested language pair) and regression/acceptance tests, including seeded noise, confusion matrix, timed input, validation and warmed performance.
- [x] Measure and tune without changing the requested thresholds. Keep scripts in experiments/; no recognition data changes or new dependencies.
- [ ] Focused local tests and npm check/test; use sequential low-memory Rust checks and CI for full builds/runtime/platform coverage.
- [ ] Review complete PR diff, merge current main, commit/push only issue-69-747cdfb224e7, update PR title/body with measured evidence, wait for all current-commit CI checks, mark PR 147 ready.
