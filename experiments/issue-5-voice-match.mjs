// Round trip: synthesize known heads, match them back and compare.
// Usage: node experiments/issue-5-voice-match.mjs [iterations] [transcript]
import { synthesize } from '../src/synthesize.js';
import { matchVoiceSteps } from '../src/analysis/voice-match.js';
import { presetHeadConfig, randomHeadConfig } from '../src/head-config.js';

const iterations = Number(process.argv[2] ?? 4);
const withTranscript = process.argv[3] === 'transcript';
const text =
  'The north wind and the sun were disputing which was the stronger.';
const keys = [
  'pitch',
  'pitchRange',
  'vocalTractLength',
  'tenseness',
  'breathiness',
  'speechRate',
];
const cases = [];
for (const preset of ['male', 'female', 'child']) {
  cases.push([`${preset} typical`, presetHeadConfig(preset)]);
  for (const seed of [1, 2]) {
    cases.push([`${preset} ${seed}`, randomHeadConfig(seed, { preset })]);
  }
}
for (const [name, target] of cases) {
  const { samples, sampleRate } = synthesize(text, {
    head: target,
    sampleRate: 22050,
  });
  const started = globalThis.performance.now();
  const steps = matchVoiceSteps(samples, sampleRate, {
    iterations,
    transcript: withTranscript ? text : undefined,
  });
  let result = steps.next();
  while (!result.done) {
    const { step, head, distance } = result.value;
    console.log(
      `  ${name} step ${step}`,
      keys.map((key) => `${key}=${head[key]}`).join(' '),
      `d=${distance.toFixed(2)}`
    );
    result = steps.next();
  }
  const { head, preset, distance } = result.value;
  console.log(
    name.padEnd(16),
    `-> ${preset} d=${distance.toFixed(2)}`,
    keys
      .map(
        (key) =>
          `${key} ${target[key]}->${head[key]} (${(
            (100 * (head[key] - target[key])) /
            target[key]
          ).toFixed(0)}%)`
      )
      .join(' '),
    `${((globalThis.performance.now() - started) / 1000).toFixed(1)}s`
  );
}
