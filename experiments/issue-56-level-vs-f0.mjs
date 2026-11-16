// Issue 56: level of a steady breathy ə (the laugh vowel) against f0.
// Run with LAUGH_FLAT=1 so that every call has the pitch and level of the
// first one (sounds.js reads it only in this experiment's runs).
// node experiments/issue-56-level-vs-f0.mjs
import { estimateFormants, synthesize } from '../src/index.js';
import { callPeaks } from './issue-56-laugh-peaks.mjs';

for (let shift = -6; shift <= 4; shift += 0.5) {
  const text = `<speak>Yes <prosody pitch="${shift >= 0 ? '+' : ''}${shift}st"><vs:sound name="laugh"/></prosody></speak>`;
  const result = synthesize(text, { tier: 'medium', seed: 1, markup: true });
  const peaks = callPeaks(result).slice(0, 3);
  const sound = result.plan.sounds[0];
  const f0 =
    result.plan.channels.f0[
      Math.round((sound.start + 0.35) * result.plan.frameRate)
    ];
  const formants = estimateFormants(result.samples, result.sampleRate, {
    start: sound.start + 0.33,
    duration: 0.04,
    count: 3,
  });
  const mean = peaks.reduce((sum, p) => sum + p.level, 0) / peaks.length;
  console.log(
    shift.toFixed(1),
    f0.toFixed(1),
    mean.toFixed(2),
    peaks.map((p) => p.level.toFixed(1)).join(' '),
    'F',
    formants.map((f) => f.toFixed(0)).join(' ')
  );
}
