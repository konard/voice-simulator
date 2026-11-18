// Unlicense. Issue 63: the no-transcript half of the golden gate of
// tests/heavy/copy-voice-fit.test.js: the fitted head's objective distance
// against that of its nearest preset, both rendering MATCH_TEXT.
// Usage: node golden-none-fit.mjs [part parts]   (default: 0 1, all items)
import { fitVoice, synthesize } from '../../src/index.js';
import {
  nearestPreset,
  featureVector,
  vectorDistance,
} from '../../src/analysis/voice-fit.js';
import {
  accumulate,
  emptyState,
} from '../../src/analysis/voice-fit-statistics.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
import { loadGolden } from '../../tests/helpers/golden.js';
const [part = 0, parts = 1] = process.argv.slice(2).map(Number);
const items = loadGolden().filter((_, i) => i % parts === part);
let failed = 0;
for (const item of items) {
  const fit = fitVoice(item.samples, item.sampleRate, {
    language: item.lang,
    maxRenders: 40,
  });
  const preset = nearestPreset(fit.head, fit.preset).head;
  const before = synthesize(MATCH_TEXT, {
    head: preset,
    lang: 'en',
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const presetDistance = vectorDistance(
    featureVector(fit.state),
    featureVector(accumulate(emptyState(), before.samples, 16000)),
    false,
    null
  );
  const passed = fit.distance <= presetDistance;
  failed += !passed;
  console.log(
    JSON.stringify({
      id: item.id,
      distance: Number(fit.distance.toFixed(4)),
      presetDistance: Number(presetDistance.toFixed(4)),
      passed,
      tract: Number(fit.head.vocalTractLength.toFixed(2)),
      pitch: Number(fit.head.pitch.toFixed(1)),
      rate: Number(fit.head.speechRate.toFixed(3)),
    })
  );
}
console.log(`failed ${failed}/${items.length}`);
