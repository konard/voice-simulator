---
'voice-simulator': patch
---

Add a policy check (issue 15): `npm run check:policy` (also part of `npm run check` and of the CI job "Lint and Format Check") fails when the repository depends on or imports a neural network library, contains a neural model file, or depends on a package whose licence is not in the allow list. The lists are in `scripts/policy-denylist.json`; `docs/CONTRIBUTING.md` explains how to read a finding and how an exception is approved. The example app now declares the Unlicense like the library.
