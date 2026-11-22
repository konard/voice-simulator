# Copy synthesis

```sh
voice-simulator copy speech.wav -o copy.wav --score speech-score.json
voice-simulator copy --from-score speech-score.json -o replay.wav
```

`copyRecording(samples, sampleRate, options)` analyzes mono speech and synthesizes a copy from its recognized phonemes, timing, pitch, loudness, and measured voice modes. It returns the audio, a voice file, the editable score, the recognition result, and acoustic metrics. Pass `voice` or `--voice voice.json` to reuse a fitted voice. Choose a synthesis tier with `tier` or `--tier`. Set one of `impose.durations`, `impose.pitch`, `impose.loudness`, or `impose.modes` to `false` to use the corresponding synthesis defaults. Optional `refine: true` or `--refine` searches for a closer articulation. The JavaScript option `refineBudget` limits its draft renders and defaults to 200.

With the default copy controls, short English recordings at 16 kHz can recover the stock simulator voice and prosody. The copy path estimates a preset from pitch, proposes readings from the pronunciation dictionary, and uses a synthesis plan when its newly rendered waveform closely agrees with the input. Other recordings use voice fitting and recognition.

Use `renderScore(score, options)` or `--from-score` after editing the score's `segments` (IPA and times in seconds), `f0` (Hz, with zero marking unvoiced frames), or `loudness` (linear gain). `toScore(plan, recognition, voice)` also exports an existing synthesis plan. Copy quality depends on recognition and voice fitting. The CLI prints recognized text and measured differences, with `--json` for structured output.

The [copy synthesis report](reports/copy-synthesis.md) records the objective results for the public-domain golden recordings at medium and studio quality.
