// Issue 51: every voice measure for foldMass 0.5, 1 and 2 on level and
// accented carriers (which measure does the fold mass move?).
// Usage: node experiments/issue-51-fold-mass.mjs
import { synthesize } from '../src/synthesize.js';
import { MEASURES, measureVoice } from '../tests/helpers/voice-measures.js';

for (const ipa of ['a˥', 'ˈa', 'ˈmama ˈsasa']) {
  const results = [0.5, 1, 2].map((foldMass) =>
    synthesize(ipa, { ipa: true, tier: 'minimal', seed: 41, head: { foldMass }, source: 'folds' })
  );
  for (const measure of ['rms', 'f0', 'hnr', 'h1h2', 'centroid', 'f1']) {
    console.log(JSON.stringify(ipa), measure, results.map((r) => measureVoice(r, measure).toFixed(3)).join(' '));
  }
}
void MEASURES;
