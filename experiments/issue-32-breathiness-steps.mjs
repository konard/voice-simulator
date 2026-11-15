// Issue 32: HNR and H1-H2 of MATCH_TEXT rendered on tier `minimal`, seed 1,
// for breathiness 0, 0.25, 0.5, 0.75 and 1 (the scenario of the test
// "measures breathiness in both features"). Extra heads come from the
// command line as JSON, e.g. '{"jitter":0}'.
// Run: node experiments/issue-32-breathiness-steps.mjs ['{"key":value}']
import { synthesize } from '../src/synthesize.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';
import { MATCH_TEXT } from '../src/analysis/voice-match.js';

const extra = JSON.parse(process.argv[2] ?? '{}');
for (const breathiness of [0, 0.25, 0.5, 0.75, 1]) {
  const { samples, sampleRate } = synthesize(MATCH_TEXT, {
    tier: 'minimal',
    seed: 1,
    head: { ...extra, breathiness },
  });
  const f = analyzeVoice(samples, sampleRate);
  console.log(
    `breathiness ${breathiness}: hnr ${f.hnr.toFixed(2)} h1h2 ${f.h1h2.toFixed(2)} f0 ${f.f0.toFixed(1)} voiced ${f.voicedDuration.toFixed(2)}`
  );
}
