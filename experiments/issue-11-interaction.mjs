/**
 * Source-tract interaction on static vowels (issue 34). For [ɑ], [i] and
 * [u] held at 120 Hz (800 Pa, adduction 0.5, the folds of the default
 * head on a 44-section waveguide shaped as the middle of the vowel), with
 * and without interaction, it prints:
 *
 * - the pitch of the glottal flow;
 * - the skew of the flow pulse: the time from the opening (5 % of the
 *   flow range above its minimum) to the peak divided by the open time;
 * - the ripple on the rising part of the pulse: the flow minus its 3 ms
 *   local quadratic trend, its dominant frequency and its RMS relative
 *   to the peak flow;
 * - F1 of the output and its -3 dB bandwidth (LPC, order 12 at 11025 Hz);
 * - H1-H2 of the output;
 *
 * and then the three lowest resonances of the subglottal line with their
 * -3 dB bandwidths at the step of each vowel. All measurements take the
 * last 200 ms of a 400 ms run (tests/helpers/interaction.js).
 *
 *   node experiments/issue-11-interaction.mjs > experiments/issue-11-interaction.txt
 */

import {
  firstFormant,
  flowRipple,
  harmonicDifference,
  pulseSkew,
  runVowel,
  subglottalResonances,
  tail,
} from '../tests/helpers/interaction.js';
import { flowPitch } from '../src/acoustics/folds.js';

const VOWELS = [
  ['ɑ', 'ˈɑː'],
  ['i', 'ˈiː'],
  ['u', 'ˈuː'],
];

const pad = (value, width) => String(value).padStart(width);

console.log('Source-tract interaction on static vowels at 120 Hz (issue 34)');
console.log('node experiments/issue-11-interaction.mjs');
console.log('');
console.log(
  'vowel  interaction  pitch Hz  skew   ripple Hz  ripple %  F1 Hz  F1 BW Hz  H1-H2 dB'
);
const lines = new Map();
for (const [name, ipa] of VOWELS) {
  for (const interaction of [false, true]) {
    const run = runVowel(ipa, { interaction });
    const flow = tail(run.flow, run.rate);
    const output = tail(run.output, run.rate);
    const ripple = flowRipple(flow, run.rate, { part: 'rising' });
    const f1 = firstFormant(output, run.rate);
    lines.set(name, { head: run.head, dt: 1 / run.rate });
    console.log(
      [
        pad(`[${name}]`, 5),
        pad(interaction ? 'yes' : 'no', 12),
        pad(flowPitch(flow, run.rate).toFixed(1), 9),
        pad(pulseSkew(flow).toFixed(3), 6),
        pad(ripple.frequency, 10),
        pad((100 * ripple.size).toFixed(2), 9),
        pad(f1.frequency.toFixed(0), 6),
        pad(f1.bandwidth.toFixed(0), 9),
        pad(harmonicDifference(output, flow, run.rate).toFixed(1), 9),
      ].join(' ')
    );
  }
}
console.log('');
console.log('Subglottal resonances (Hz) and -3 dB bandwidths (Hz):');
for (const [name, { head, dt }] of lines) {
  const peaks = subglottalResonances(head, dt);
  const resonances = peaks
    .map(
      ({ frequency, bandwidth }) =>
        `${frequency.toFixed(0)} (${bandwidth.toFixed(0)})`
    )
    .join(', ');
  console.log(`  [${name}] step ${(dt * 1e6).toFixed(2)} us: ${resonances}`);
}
