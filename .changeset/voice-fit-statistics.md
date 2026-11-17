---
'voice-simulator': minor
---

Add voice configuration fitting with per-parameter uncertainty, bounded
analysis-by-synthesis refinement and resumable fixed-memory statistics.
Route legacy voice matching through the fitter while retaining its result shape.
Reuse identical search vertices and the winning render's prepared pitch analysis
when completing source diagnostics.
Defer legacy pitch analysis to envelope peaks during candidate evaluation,
then complete the winning render's diagnostics without changing its features.
Retain improved simplex reflections when the render budget prevents contraction,
including in the Rust numerical implementation.
