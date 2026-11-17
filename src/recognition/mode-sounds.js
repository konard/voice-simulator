/** Conservative pause sound cues, issue 71. Unlicense. */
import { analyzeFrames } from './frontend.js';
import { trackPitch } from './pitch.js';
import { trackFormants } from './formants.js';
import { quantile } from './mode-features.js';

// Independent duration, periodicity and formant gates define the three sounds.
// eslint-disable-next-line complexity
export function recognizeSounds(samples, sampleRate, words) {
  const pauses = [];
  let start = 0;
  for (const word of words) {
    if (word.start - start >= 0.2) {
      pauses.push({ start, end: word.start });
    }
    start = word.end;
  }
  if (samples.length / sampleRate - start >= 0.2) {
    pauses.push({ start, end: samples.length / sampleRate });
  }
  const result = [];
  for (const pause of pauses) {
    const signal = samples.subarray(
      Math.round(pause.start * sampleRate),
      Math.round(pause.end * sampleRate)
    );
    const frames = analyzeFrames(signal, sampleRate, {
      hop: 0.01,
      maxSeconds: signal.length / sampleRate + 0.1,
    });
    const peak = quantile(frames.energy.subarray(0, frames.count), 0.95);
    if (peak < -65) {
      continue;
    }
    const active = [];
    for (let t = 0; t < frames.count; t++) {
      if (frames.energy[t] > Math.max(-65, peak - 15)) {
        active.push(t);
      }
    }
    if (!active.length) {
      continue;
    }
    const pitch = trackPitch(frames, { minF0: 35 });
    // Resonant breath noise can produce a weak autocorrelation candidate.
    const voiced = active.filter(
      (t) => pitch.f0[t] > 0 && pitch.strength[t] >= 0.9
    );
    const duration = (active.at(-1) - active[0] + 1) * frames.hop;
    let sound;
    let confidence = 0.7;
    if (
      voiced.length / active.length < 0.05 &&
      duration >= 0.3 &&
      duration <= 0.7
    ) {
      sound = 'inhale';
    }
    const bursts = voiced.filter((t, i) => !i || t - voiced[i - 1] > 2);
    if (bursts.length >= 3) {
      const hz =
        (bursts.length - 1) / ((bursts.at(-1) - bursts[0]) * frames.hop);
      if (hz >= 4 && hz <= 6) {
        sound = 'laugh';
      }
    }
    if (!sound && duration > 0.2 && voiced.length / active.length > 0.8) {
      const formants = trackFormants(frames, { pitch });
      const f1 = quantile(voiced.map((t) => formants.frequency[t * 4]));
      const f2 = quantile(voiced.map((t) => formants.frequency[t * 4 + 1]));
      const f0s = voiced.map((t) => pitch.f0[t]);
      const spread = quantile(f0s, 0.95) / Math.max(1, quantile(f0s, 0.05));
      if (
        f1 >= 350 &&
        f1 <= 700 &&
        f2 >= 1000 &&
        f2 <= 1800 &&
        spread <= 1.15
      ) {
        sound = 'filler';
        confidence = 0.6;
      }
    }
    if (sound) {
      result.push({
        start: pause.start + active[0] * frames.hop,
        end: pause.start + (active.at(-1) + 1) * frames.hop,
        sound,
        notation: `⸨${sound}⸩`,
        confidence,
      });
    }
  }
  return result;
}
