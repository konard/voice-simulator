---
'voice-simulator': patch
---

Rewrite the vision and add the roadmap (issue 11): `docs/VISION.md` now describes one physical model that speaks and listens, copies voices, uses no neural networks and stays in the public domain, and `docs/ROADMAP.md` lists the GitHub issues that lead there, with their blockers. The library itself does not change. Refresh the development dependencies that `npm audit` reports (ESLint, minimatch and launch-editor in the library; Electron, undici and Vite in `examples/universal-app`) and repair a dead link in the changeset notes so that the security and link checks pass.
