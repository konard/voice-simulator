#!/usr/bin/env node
/**
 * Issue 41: measure the documented effect of every head parameter. Renders
 * the effect phrase of each HEAD_PARAMETERS entry at its two effect values
 * (tests/helpers/voice-measures.js) and prints the measure at both, the
 * difference and whether its sign is `effect.sign`.
 *
 *   node experiments/issue-41-effects.mjs                 # every parameter
 *   node experiments/issue-41-effects.mjs speedJaw micAzimuth
 *   node experiments/issue-41-effects.mjs --all speedJaw  # every measure
 *
 * With --all each named parameter (or every one with sign 0) is printed
 * with all measures, to choose the measure that it moves.
 */

/* global performance */

import { HEAD_PARAMETERS } from '../src/head-config.js';
import {
  MEASURES,
  effectValues,
  measureEffect,
  measureVoice,
  renderEffect,
} from '../tests/helpers/voice-measures.js';

const args = process.argv.slice(2);
const all = args.includes('--all');
const keys = args.filter((arg) => !arg.startsWith('--'));
const selected = HEAD_PARAMETERS.filter((parameter) =>
  keys.length
    ? keys.includes(parameter.key)
    : !all || parameter.effect.sign === 0
);

const format = (value) =>
  Math.abs(value) >= 100 || value === 0
    ? value.toFixed(1)
    : value.toPrecision(4);

const started = performance.now();
let mismatches = 0;
for (const parameter of selected) {
  const { effect } = parameter;
  const [low, high] = effectValues(parameter);
  if (all) {
    const results = [low, high].map((value) => renderEffect(parameter, value));
    const line = MEASURES.map((measure) => {
      const [a, b] = results.map((result) => measureVoice(result, measure));
      const relative = (b - a) / (Math.abs(a) + 1e-12);
      return `${measure} ${relative >= 0 ? '+' : ''}${(relative * 100).toFixed(2)}%`;
    });
    console.log(`${parameter.key} [${low}, ${high}]: ${line.join(', ')}`);
    continue;
  }
  const measured = measureEffect(parameter);
  const ok = measured.sign === effect.sign;
  mismatches += ok ? 0 : 1;
  console.log(
    [
      ok ? 'ok  ' : 'FAIL',
      parameter.key.padEnd(30),
      effect.measure.padEnd(11),
      `sign ${String(effect.sign).padStart(2)}`,
      `${format(measured.low)} -> ${format(measured.high)}`,
      `(${measured.difference >= 0 ? '+' : ''}${format(measured.difference)})`,
    ].join(' ')
  );
}
const seconds = (performance.now() - started) / 1000;
console.log(
  `${selected.length} parameters, ${mismatches} mismatches, ${seconds.toFixed(1)} s`
);
process.exitCode = mismatches ? 1 : 0;
