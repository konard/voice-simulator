---
'voice-simulator': minor
---

Drive frication, aspiration and breath noise by the air flow: the new head parameter `lungPressure` pushes air through the glottis and the narrowest place of the mouth, the mouth pressure follows with the lag of the oral compliance, and the noise at each orifice grows as dp^1.5 A^0.5 (Stevens 1971) above a critical Reynolds number, in a band centred on the Strouhal frequency of the jet. The release of a stop adds a burst transient from the flow derivative, and voiceless obstruents open the glottis. [s] now peaks near 7 kHz, 1.2 kHz above [ʃ], and aspirated stops get a voice onset time of about 60 ms. The air flow and the source strengths are exported (`Aerodynamics`, `sourceStrength`, `steadyFlow`, `strouhalFrequency`, ...) and ported to the Rust core with parity tests.
