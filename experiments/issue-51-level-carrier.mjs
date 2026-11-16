// Issue 51: f0 range (5th-95th percentile, semitones) of carrier phrases
// with and without vibrato: the vibrato effects need a level contour.
// Usage: node experiments/issue-51-level-carrier.mjs
import { synthesize } from '../src/synthesize.js';
import { measureVoice } from '../tests/helpers/voice-measures.js';

const head = { pitchRange: 0.5, declination: 0, accentStrength: 0 };
for (const ipa of ['ˈaː |', 'aː˥ |', 'a˥ː |', 'ˈaː˥ |', 'aː˥']) {
  const row = [];
  for (const extra of [
    { vibrato: 0 },
    { vibrato: 1, vibratoRate: 3 },
    { vibrato: 1, vibratoRate: 8 },
  ]) {
    const result = synthesize(ipa, {
      ipa: true,
      tier: 'minimal',
      seed: 41,
      head: { ...head, ...extra },
    });
    row.push(measureVoice(result, 'f0Range').toFixed(3));
  }
  console.log(
    JSON.stringify(ipa),
    'vibrato 0 / rate 3 / rate 8:',
    row.join(' ')
  );
}
