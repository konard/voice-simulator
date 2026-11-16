// Issue 51: f0 (Hz) for foldMass 0.5/1/2 and the spectral centroid (Hz) for
// subglottalLength 0.8/1/1.25 on several carriers (fold-source effects of
// tests/head-parameters.test.js).
// Usage: node experiments/issue-51-fold-effects.mjs [ipa ...]
import { synthesize } from '../src/synthesize.js';
import { measureVoice } from '../tests/helpers/voice-measures.js';

const render = (ipa, head, options) =>
  synthesize(ipa, { ipa: true, tier: 'minimal', seed: 41, head, ...options });
for (const ipa of process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['ˈa', 'a˥', 'ˈa |', 'ˈaː']) {
  const f0 = [0.5, 1, 2].map((foldMass) =>
    measureVoice(render(ipa, { foldMass }, { source: 'folds' }), 'f0').toFixed(
      2
    )
  );
  const centroid = [0.8, 1, 1.25].map((subglottalLength) =>
    measureVoice(
      render(ipa, { subglottalLength }, { source: 'folds', interaction: true }),
      'centroid'
    ).toFixed(1)
  );
  console.log(
    JSON.stringify(ipa),
    'foldMass f0:',
    f0.join(' '),
    ' subglottalLength centroid:',
    centroid.join(' ')
  );
}
