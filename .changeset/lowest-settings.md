---
'voice-simulator': patch
---

Certify every feature at 8 kHz on one core: `scripts/lowest-settings.mjs`
measures the synthesis, recognition, streaming, voice-fit, session, copy,
modes and app rows with the JavaScript and Rust engines and publishes
`docs/reports/lowest-settings.md` and the README matrix. `createVoiceSession`
and `copyRecording` take an `engine` option.
