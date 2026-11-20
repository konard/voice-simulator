/** Report possible whisper false positives on the voiced #17 golden set. Unlicense. */
import { analyzeFrames, findWhisper, trackPitch } from '../src/index.js';
import { energyRatio } from '../src/analysis/mode-features.js';
import { loadGolden } from '../tests/helpers/golden.js';

for (const { id, samples, sampleRate } of loadGolden()) {
  const frames = analyzeFrames(samples, sampleRate);
  const pitch = trackPitch(frames);
  const spans = findWhisper(samples, sampleRate, frames, pitch);
  for (const span of spans) {
    const from = Math.round(span.start / frames.hop);
    const to = Math.round(span.end / frames.hop);
    const slice = (track) => Array.from(track.subarray(from, to));
    console.log(
      JSON.stringify({
        id,
        duration: samples.length / sampleRate,
        ...span,
        ratio: energyRatio(
          samples,
          sampleRate,
          span.start * sampleRate,
          span.end * sampleRate
        ),
        peak: Math.max(...slice(frames.energy)),
        voiced: slice(pitch.f0).filter(Boolean).length / (to - from),
        active: slice(frames.speech).filter(Boolean).length / (to - from),
        globalVoiced:
          pitch.f0.subarray(0, pitch.count).filter(Boolean).length /
          pitch.count,
      })
    );
  }
}
