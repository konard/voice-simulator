// Unlicense. Planned utterance duration (no rendering) versus measured
// speech seconds, over heads, texts and speech rates (issue 63).
import { prepareUtterance, synthesize } from '../../src/synthesize.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { prepareLegacyVoice } from '../../src/analysis/voice-features.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const texts = {
  match: MATCH_TEXT,
  north: 'The north wind and the sun.',
  passage: 'The north wind and the sun were disputing which was the stronger.',
};
const heads = {
  default: {},
  male: presetHeadConfig('male'),
  female: presetHeadConfig('female'),
  B: { vocalTractLength: 18.5, pitch: 100, tenseness: 0.75 },
};
const p = prepareUtterance(MATCH_TEXT, { head: {} });
console.log(
  Object.keys(p.plan),
  p.plan.duration,
  Object.keys(p.timeline ?? {})
);
for (const [tn, text] of Object.entries(texts)) {
  for (const [hn, head] of Object.entries(heads)) {
    const row = [];
    for (const speechRate of [0.85, 1, 1.15]) {
      const h = { ...head, speechRate };
      const plan = prepareUtterance(text, { head: h, seed: 1 }).plan;
      const { samples } = synthesize(text, {
        head: h,
        seed: 1,
        sampleRate: 16000,
        solver: 'waveguide',
        engine: 'js',
      });
      const legacy = prepareLegacyVoice(Float32Array.from(samples), 16000, {
        diagnosticsOnly: true,
      }).rateFeatures;
      row.push(
        `${speechRate}: plan ${plan.duration?.toFixed(3)} speech ${(legacy.activeDuration + 0.03).toFixed(3)} total ${(samples.length / 16000).toFixed(3)}`
      );
    }
    console.log(tn, hn, row.join(' | '));
  }
}
