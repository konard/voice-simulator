# Issue 9: research notes on anatomy, datasets, 3D acoustics, voice types and browser audio

Prepared 2026-10-18 for [konard/voice-simulator#9](https://github.com/konard/voice-simulator/issues/9).

Scope: research for a browser JavaScript physical voice simulator. Its pipeline runs text → IPA → articulation → area function, then into either a 1D Kelly-Lochbaum waveguide or a 3D sparse-voxel FDTD solver.

Conventions:

- Every factual claim carries a URL. Where a source was only seen as an abstract or metadata record, the text says so.
- "Unverified", "uncertain" or "inferred" mark claims the authors did not confirm against a primary source.
- Byte sizes are exact values from the figshare/Zenodo APIs or HTTP headers, fetched on 2026-10-18.

Contents:

1. Anatomical reference datasets (Birkholz 2020 DVTD first)
2. Anatomical dimensions
3. State of the art of 3D acoustic simulation of the vocal tract, and competing projects
4. Beating neural TTS / path to SOTA
5. Female and child voice acoustics
6. Browser audio in background tabs
7. Tools

Files: [1](1-anatomical-datasets.md), [2](2-anatomical-dimensions.md), [3](3-3d-acoustics-sota.md), [4](4-path-to-sota.md), [5](5-female-child-voices.md), [6 and 7](6-7-browser-audio-and-tools.md).
