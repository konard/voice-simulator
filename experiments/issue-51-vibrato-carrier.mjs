// Issue 51: f0 range (semitones) of level carrier phrases at vibrato rates
// 3 and 8 Hz and of the vibrato depth 0 and max (the vibrato effects of
// src/parameters/expression.js).
// Usage: node experiments/issue-51-vibrato-carrier.mjs
import { synthesize } from '../src/synthesize.js';
import { measureVoice } from '../tests/helpers/voice-measures.js';

const head = { pitchRange: 0.5, declination: 0, accentStrength: 0 };
const range = (ipa, extra) =>
  measureVoice(
    synthesize(ipa, { ipa: true, tier: 'minimal', seed: 41, head: { ...head, ...extra } }),
    'f0Range'
  ).toFixed(3);
for (const ipa of process.argv.slice(2).length ? process.argv.slice(2) : ['ˈaː |', 'aː˥ |', 'aːː˥ |', 'a˥a˥ |', 'a˥ a˥ |', 'a˥ː a˥ː |', 'ˈaː˥ ˈaː˥ |']) {
  console.log(
    JSON.stringify(ipa),
    'depth 0/2:', range(ipa, { vibrato: 0 }), range(ipa, { vibrato: 2 }),
    ' rate 3/5.2/8:', range(ipa, { vibrato: 1, vibratoRate: 3 }), range(ipa, { vibrato: 1, vibratoRate: 5.2 }), range(ipa, { vibrato: 1, vibratoRate: 8 })
  );
}
