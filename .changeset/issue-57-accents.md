---
'voice-simulator': minor
---

Accents beyond English and foreign accents: regional accents of every language (`en-CA`, `ru-x-north`, `ru-x-south`, `hi-x-east`, `zh-TW`, `zh-x-south`) and the 12 foreign accents `<target>-x-<first>` of English, Russian, Hindi and Mandarin (`en-x-ru`: `the thing` zə ˈsʲink). An accent is a code or an accent file (`voice-simulator/accent`: g2p switches, IPA rules, phonotactics, prosody and articulation; `loadAccent`) with a strength from 0 to 1 (`accent: { code, strength }` or `accentLevel`) in `textToIpa`, `prepareUtterance` and `synthesize`, the CLI (`--accent <code|file.json>`, `--accent-level`), the server (`accent`, `accentLevel`) and voice files (`accent`). New exports: `getAccent`, `applyAccent`, `explainAccent`, `loadAccent`, `foreignAccent`, `accentSettings`. Every code and its rules are listed in `docs/accents.md`. Without an accent the output is unchanged.
