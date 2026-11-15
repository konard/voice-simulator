/**
 * Ablation for issue 38: which part of the articulator dynamics moves the
 * vocal tract length that analyzeVoice() reads from the female and male
 * presets (tests/voice-match.test.js). Re-plans the test sentence with the
 * leads of rounding and velum set back to 1.68 time constants and/or all
 * coarticulation resistance levels set to 0, renders it on the waveguide
 * and prints the read length and matchVoice()'s length.
 * Usage: node experiments/issue-38-voice-match-ablation.mjs
 */
import { prepareUtterance } from '../src/synthesize.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { planUtterance, ARTICULATORS } from '../src/articulation/plan.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';
import { matchVoice } from '../src/analysis/voice-match.js';
import { presetHeadConfig } from '../src/head-config.js';

const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const symmetric = Object.fromEntries(
  ['rounding', 'velum'].map((name) => [
    name,
    { lead: 1.68 * ARTICULATORS[name].timeConstant },
  ])
);
const free = { high: 0, medium: 0, low: 0, none: 0 };
const variants = {
  branch: {},
  'no long leads': { articulators: symmetric },
  'no resistance': { resistance: free },
  neither: { articulators: symmetric, resistance: free },
};
for (const preset of ['male', 'female']) {
  for (const [name, options] of Object.entries(variants)) {
    const prepared = prepareUtterance(TEXT, {
      head: presetHeadConfig(preset),
      solver: 'waveguide',
      sampleRate: 16000,
    });
    const plan = planUtterance(prepared.ipa, {
      head: prepared.head,
      language: prepared.lang,
      ...options,
    });
    const samples = renderPlan(plan, prepared.renderOptions);
    const read = analyzeVoice(samples, 16000).vocalTractLength;
    const match = matchVoice(samples, 16000, { iterations: 2 });
    console.log(
      `${preset.padEnd(6)} ${name.padEnd(14)} read ${read.toFixed(2)} match ${match.head.vocalTractLength} ${match.preset}`
    );
  }
}
