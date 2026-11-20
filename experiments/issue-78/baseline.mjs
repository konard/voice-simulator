/** Measure the upstream fitter and phoneme decoder for voice sessions. Unlicense. */
import { fitVoice, presetHeadConfig, synthesize } from '../../src/index.js';
import { audioToIpa } from '../../src/recognition/decode.js';
import { performance } from 'node:perf_hooks';

const text =
  'A little bird sings in the morning. We heard it again across the green field.';
const preset = process.argv[2] ?? 'male';
const head = presetHeadConfig(preset);
const keys = ['vocalTractLength', 'pitch', 'speechRate'];
const read = (config) =>
  Object.fromEntries(keys.map((key) => [key, config[key]]));
const signal = synthesize(text, {
  head,
  tier: 'minimal',
  sampleRate: 16000,
  seed: 1,
});
console.log('truth', signal.duration, signal.ipa, read(head));
for (const renders of [1, 4, 10]) {
  const start = performance.now();
  const result = fitVoice(signal.samples, signal.sampleRate, {
    maxRenders: renders,
  });
  console.log(
    'fit',
    renders,
    read(result.head),
    result.distance,
    performance.now() - start
  );
  const decodeStart = performance.now();
  const decoded = audioToIpa(signal.samples, signal.sampleRate, {
    voice: result.head,
    language: 'en',
    sourceRate: 16000,
  });
  console.log(
    'decode',
    performance.now() - decodeStart,
    decoded.ipa,
    decoded.segments
      .filter((segment) => segment.confidence >= 0.5)
      .map(({ ipa, confidence, kind }) => [ipa, +confidence.toFixed(2), kind])
  );
}
