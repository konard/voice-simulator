// Issue 56: `[filler]` and `[um]` per language: length, voicing, F1 at the
// start and the end (LPC) and the pitch fall.
// node experiments/issue-56-fillers.mjs
import {
  formantTrack,
  pitchTrack,
  synthesize,
  voicedShare,
} from '../src/index.js';

const median = (values) => {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

for (const name of ['filler', 'um']) {
  for (const lang of ['en', 'ru', 'hi', 'zh']) {
    const result = synthesize(`[${name}]`, {
      lang,
      tier: 'medium',
      seed: 1,
      markup: true,
    });
    const { samples, sampleRate, plan } = result;
    const sound = plan.sounds[0];
    const part = samples.subarray(
      Math.round(sound.start * sampleRate),
      Math.round(sound.end * sampleRate)
    );
    const pitch = pitchTrack(part, sampleRate);
    const formants = formantTrack(part, sampleRate, { pitch });
    const f1 = formants.map((f) => (f ? f[0] : 0));
    const third = Math.floor(f1.length / 3);
    const voiced = Array.from(pitch).filter((v) => v > 0);
    const f1Start = median(f1.slice(0, third));
    const f1End = median(f1.slice(-third));
    console.log(
      name,
      lang,
      result.ipa,
      (sound.end - sound.start).toFixed(2),
      's voiced',
      voicedShare(part, sampleRate).toFixed(2),
      'F1',
      f1Start.toFixed(0),
      f1End.toFixed(0),
      `${((100 * Math.abs(f1End - f1Start)) / f1Start).toFixed(1)}%`,
      'f0',
      voiced[0]?.toFixed(0),
      '->',
      voiced.at(-1)?.toFixed(0),
      `fall ${(12 * Math.log2(voiced[0] / voiced.at(-1))).toFixed(2)} st`
    );
  }
}
