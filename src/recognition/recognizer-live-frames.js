/** Acoustic timing for narrowband live word recognition. Unlicense. */
import { createFrameAnalyzer } from './frontend.js';
import { createPitchTracker } from './pitch.js';

export function createLiveFrames(
  sampleRate,
  options,
  { hop = 0.01, reportPitch = true } = {}
) {
  const input = createFrameAnalyzer(sampleRate, { ...options, hop });
  const { frames } = input;
  const pitch = createPitchTracker(frames, {
    kernels: options.kernels,
    frameOnly: !reportPitch,
  });

  function advance(final) {
    const start = pitch.track.committed;
    pitch.advance(final);
    if (!reportPitch) {
      return undefined;
    }
    const voiced = [];
    for (let row = start; row < pitch.track.committed; row++) {
      const f0 = pitch.track.f0[row];
      if (f0 > 0) {
        voiced.push({ time: row * frames.hop, f0 });
      }
    }
    return { voiced };
  }

  return {
    frames,
    push(samples) {
      input.push(samples);
      return advance(false);
    },
    flush() {
      input.flush();
      return advance(true);
    },
    result() {
      return { frames, tracks: { pitch: pitch.track } };
    },
  };
}
