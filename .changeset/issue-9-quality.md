---
'voice-simulator': minor
---

Improve the quality of the voice (issue 9). Full 3D acoustics are the default of the library, the CLI, the server and the web app: the new `studio` tier (0.5 cm cells, `DEFAULT_AUDIO_TIER`) resolves the incisors, the piriform fossae, the vallecula and transverse modes above 5 kHz, and the `reference` tier (0.4 cm) goes further; `tier: 'medium'` (`--tier medium`) keeps the real-time 1D waveguide. The web app renders slow tiers ahead, shows the progress and starts playback once the rest of the utterance will be ready before the player reaches it. The 3D model gains its own piriform fossae and vallecula. Audio resumes after the tab was in the background, and the release before this one stays online at /v2/.
