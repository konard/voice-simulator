# Issue 68 work plan and evidence

Objective: fully implement and verify issue 68 in
[PR 144](https://github.com/konard/voice-simulator/pull/144). Keep unmet
criteria open. Work only on `issue-68-60e84c80a49f`; leave the PR unmerged.

Research: issue 68, every issue comment, and all three PR comment/review
endpoints were read. Prerequisite 47 closed on 2026-11-16. There are no
required implementation sub-issues. The forty fixed evaluation sentences
are posted in [the issue](https://github.com/konard/voice-simulator/issues/68#issuecomment-6941363838)
and committed in `tests/fixtures/recognition/ipa-sentences.json`.

## Requirements mapped to implementation and verification

- [x] Public-domain corpora exceed one million accepted words per language.
      `src/recognition/data/SOURCES.md` lists every text, author, death year,
      publication year, source URL and exact processed-input SHA-256. Raw
      texts remain outside Git; CI never downloads them.
- [x] `scripts/build-recognition-data.mjs` validates words using the existing
      lexicons/pronouncers and writes descending count tables: 20000 words
      and 40000 observed bigrams per language, no fabricated pairs. Builder
      tests cover deterministic output, hashes, historical spelling,
      sentence/file boundaries and lossless source escapes. All generated
      files are below 800000 bytes; the directory is 2700 KiB.
- [x] `phone-distance.js` implements the specified bounded, symmetric feature
      costs, coarticulated places, stress, tone sandhi and reduced gap costs.
      Tests cover every inventory pair and extra feature combinations.
- [x] `lexicon.js` builds and caches current forward pronunciations, all listed
      variants, Hindi schwas and Russian clitics. Keys omit stress and retain
      Mandarin tones. Lexicon revisions invalidate the cache.
- [x] `candidates.js` and `ipa-to-text.js` implement bounded edit search,
      discounted bigrams, dynamic programming, unknown spelling, pauses,
      supplied/searched boundaries and distinct n-best paths. Exact-path
      priority, acoustic weight 10 and unknown cost 3 + 2n are documented
      calibrations of the issue's starting values.
- [x] `phones-to-letters.js` supplies rule spelling in four scripts. The
      automated held-out test removes 200 words from each reverse trie;
      sound recovery is 83%, 95.5%, 100%, 95.5% (en/ru/hi/zh).
- [x] `input.js` / `result.js` retain timing, confidence and stress. Shared
      `phoneCounts` and `syllableSpans` reproduce timeline spelling. Tests
      cover null string times, timed sounds, pauses and hello -> hel/lo.
- [x] Export, declarations, CLI/help, README, roadmap, API documentation and
      a minor changeset are included. All three requested CLI examples pass.
- [x] Rust core feature/edit/count/beam code and additive WebAssembly exports
      match JS. Six parity checks cover all phone pairs, four languages,
      unknowns, n-best output and malformed packets. Merged scalar/SIMD
      files measure 332646 / 338849 bytes within a 336 KiB budget.
- [x] `tests/ipa-to-text.test.js` verifies all requested accuracy gates.
      First 5000 words per language: 100% sound recovery and 96.70–97.92%
      spelling. All forty sentences preserve sounds. Sentence spelling,
      searched boundaries and seed-1 noise gates pass in every language.
      Mandarin sound units are the forward engine's character syllables;
      spelling is measured by characters. Full numbers and final costs are
      recorded in `docs/ipa-to-text.md`.
- [x] Cold tries: 1.524 / 1.918 / 1.222 / 1.812 seconds. Warm 120 sounds,
      beam 8: 3.2 ms. Commands and limits are recorded beside the results.
- [x] Local focused checks, native Rust recognition tests, clippy, rustfmt,
      required scalar/SIMD builds and the feature-specific WebAssembly
      parity checks pass. Local `npm run check` passes.
- [x] Latest main (`bc76d97`) is merged, preserving source-analysis, formant and
      codebook APIs and their tests. Atomic feature commits are retained.
- [ ] Final-commit Node/Bun/Deno CI, all other PR checks, and the full manual
      performance suite pass; its artifact is added to the performance trend.
- [ ] Review final PR diff, refresh main/comments, update PR title/body with
      costs and measurements, preserve `Fixes #68`, verify a clean tree and
      mark PR 144 ready.

## Verification protocol

Large outputs go to ignored `ci-logs/` or `/tmp/issue-68-*.log`. Local Rust
commands use one build job and reduced debug information. Full source tests,
platform matrices, native threading and expensive renders run in CI.
Individual recognition test cases stay under approximately ten seconds;
corpora are built once offline and the bounded measurement script is reusable.

For CI investigation:

1. List the latest five branch runs with timestamps and head SHA.
2. Compare each run with the latest pushed commit before interpreting it.
3. Download each failed run's complete log into `ci-logs/`.
4. Read actual errors in chunks no larger than 1500 lines.
5. Record the error and exact log line, fix it, then verify a fresh run.

The first partial-code run (44034203224) failed because its changeset had
not yet been committed: `ci-logs/release-44034203224.log`, lines 3498–3499.
The minor changeset is present; subsequent changeset checks pass.
