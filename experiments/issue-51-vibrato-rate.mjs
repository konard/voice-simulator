// Issue 51: f0 range (semitones) of a level carrier at vibrato rates from
// 3 to 8 Hz, for several carriers and speech rates (vibratoRate effect).
// Usage: node experiments/issue-51-vibrato-rate.mjs
import { synthesize } from '../src/synthesize.js';
import { measureVoice } from '../tests/helpers/voice-measures.js';

const base = { pitchRange: 0.5, declination: 0, accentStrength: 0, vibrato: 1 };
for (const ipa of ['ˈaː |', 'aː˥ |', 'aː˥']) {
  for (const speechRate of [1, 0.7, 0.5]) {
    const row = [3, 4, 5, 6, 7, 8].map((vibratoRate) =>
      measureVoice(
        synthesize(ipa, {
          ipa: true,
          tier: 'minimal',
          seed: 41,
          head: { ...base, speechRate, vibratoRate },
        }),
        'f0Range'
      ).toFixed(3)
    );
    console.log(
      JSON.stringify(ipa),
      'speechRate',
      speechRate,
      'rates 3..8:',
      row.join(' ')
    );
  }
}
