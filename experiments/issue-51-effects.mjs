// Issue 51: low/high values of selected head-parameter effects
// (tests/head-parameters.test.js) to compare branches.
// Usage: node experiments/issue-51-effects.mjs [key ...]
import { HEAD_PARAMETERS } from '../src/head-config.js';
import { measureEffect } from '../tests/helpers/voice-measures.js';

const keys = process.argv.slice(2);
for (const key of keys.length
  ? keys
  : ['subglottalLength', 'foldMass', 'vibratoRate']) {
  const parameter = HEAD_PARAMETERS.find((entry) => entry.key === key);
  const { low, high, sign } = measureEffect(parameter);
  console.log(
    key,
    parameter.effect.measure,
    parameter.effect.ipa ?? '',
    JSON.stringify(parameter.effect.head ?? {}),
    low.toFixed(4),
    high.toFixed(4),
    sign,
    'expected',
    parameter.effect.sign
  );
}
