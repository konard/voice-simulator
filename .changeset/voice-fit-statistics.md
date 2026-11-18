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
Start Deno's matching queue on macOS's Bash 3.2 without expanding an empty array
under nounset; preserve process reaping and the existing suite deadlines.
Read stage A breathiness from pitch-conditioned CPP and tenseness from a
calibrated rd table; with a transcript, read speech rate and pitch range from
the planned speaking time and f0 range. Keep the stage A preset while the
fitted tract stays within 1 cm of its range.
Count syllable nuclei with findLandmarks across updates, keeping the last 2 s
of sound in the state. With a transcript, read pitch against the planned
median f0, correct the stage A tract with one render, compare speaking times
in the objective and keep the stage A speech rate out of the first round.
