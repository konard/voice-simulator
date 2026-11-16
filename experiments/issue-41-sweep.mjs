#!/usr/bin/env node
/**
 * Issue 41: sweep one head parameter and print the effect measures at
 * each value (tests/helpers/voice-measures.js), to see whether a measure
 * is monotonic over the range.
 *
 *   node experiments/issue-41-sweep.mjs foldStiffness 0.5 0.75 1 1.5 2
 *   node experiments/issue-41-sweep.mjs vibrato 0 0.5 1 --measures f0,f0Range
 */

import { HEAD_PARAMETERS } from '../src/head-config.js';
import {
  MEASURES,
  measureVoice,
  renderEffect,
} from '../tests/helpers/voice-measures.js';

const args = process.argv.slice(2);
const option = args.indexOf('--measures');
const measures = option >= 0 ? args[option + 1].split(',') : MEASURES;
const [key, ...rest] = option >= 0 ? args.slice(0, option) : args;
const parameter = HEAD_PARAMETERS.find((entry) => entry.key === key);
if (!parameter) {
  throw new Error(`Unknown head parameter "${key}"`);
}
const values = rest.length
  ? rest.map(Number)
  : [0, 0.25, 0.5, 0.75, 1].map(
      (fraction) => parameter.min + fraction * (parameter.max - parameter.min)
    );
for (const value of values) {
  const result = renderEffect(parameter, value);
  const line = measures.map(
    (measure) => `${measure} ${measureVoice(result, measure).toPrecision(4)}`
  );
  console.log(`${key} = ${value}: ${line.join(', ')}`);
}
