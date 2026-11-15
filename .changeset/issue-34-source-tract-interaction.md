---
'voice-simulator': minor
---

Add source-tract interaction for the fold source: `interaction: true` (CLI `--interaction`) solves the glottal flow from the sound pressures above and below the glottis (`interactiveFlow()`, Titze 2008), with `glottalLoad()` and `setGlottalReflection()` on the waveguide, the 2D and the 3D solver, and `subglottal` (default: as `interaction`) adds the windpipe as a second Kelly-Lochbaum line (`Subglottal`, `subglottalShape()`, head parameter `subglottalLength`). `interaction: true` with `source: 'lf'` throws `Interaction needs source: 'folds'`. `DEFAULT_INTERACTION` is `false` and `DEFAULT_SOURCE` stays `'lf'`; without interaction every render is bit-identical to before.
