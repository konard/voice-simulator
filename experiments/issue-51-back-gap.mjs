// Issue 51: F1 (median of the vowels, LPC) for backGap min/default/max on
// several carriers (backGap effect of tests/head-parameters.test.js).
// Usage: node experiments/issue-51-back-gap.mjs [ipa ...]
import { synthesize } from '../src/synthesize.js';
import { HEAD_PARAMETERS } from '../src/head-config.js';
import { measureVoice } from '../tests/helpers/voice-measures.js';

const parameter = HEAD_PARAMETERS.find((entry) => entry.key === 'backGap');
const values = [parameter.min, parameter.default, parameter.max];
for (const ipa of process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['ˈmumu ˈsusu', 'u˥ u˥', 'ˈmu˥mu˥ ˈsu˥su˥', 'ˈuː', 'ˈmumu ˈsusu ˈmumu']) {
  const f1 = values.map((backGap) =>
    measureVoice(
      synthesize(ipa, {
        ipa: true,
        tier: 'minimal',
        seed: 41,
        head: { backGap },
      }),
      process.env.MEASURE ?? 'f1'
    ).toFixed(1)
  );
  console.log(
    JSON.stringify(ipa),
    'backGap',
    values.join('/'),
    process.env.MEASURE ?? 'f1',
    f1.join(' ')
  );
}
