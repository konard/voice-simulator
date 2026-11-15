---
'voice-simulator': patch
---

Add a golden set of real speech for tests (issue 17). `tests/fixtures/golden/` holds 24 short public-domain LibriVox sentences, 6 each in English, Russian, Hindi and Mandarin. They are 16 kHz mono 16-bit FLAC files, 1 987 767 bytes in total. `manifest.json` gives each file's text, hand-written IPA, reader, duration and SHA-256, the LibriVox section and the seconds it was cut from, the printed text and the review state. `scripts/golden.mjs` finds the pauses of a recording (`pauses`), cuts a sentence with 10 ms fades and a −3 dBFS peak (`cut`) and checks the folder (`verify`). The tests read the files through `loadGolden({ lang, reviewedOnly })` of `tests/helpers/golden.js`. Every file starts unreviewed until a person who knows the language confirms it. The package does not ship `tests/`, so the library itself does not change.
