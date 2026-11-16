// Phonation types on the two-mass fold source (issue 54, step 8):
// breathy = folds further apart (lower adduction), pressed = pressed
// together (higher adduction), creaky = thick slack folds at low pressure
// (lower tension, FOLD_CREAK_PRESSURE), falsetto = thin stiff folds an
// octave up. Prints the plan's fold drive (mean adduction, fold tension
// and lung pressure over the voiced frames) and the measures of the
// issue's table for source 'lf' and 'folds', and whether each target of
// tests/phonation.test.js holds on the folds.
// node experiments/issue-54-folds.mjs
import { synthesize, analyzeVoice } from '../src/index.js';
import { cpp, jitterPercent, pulseF0 } from '../src/analysis/mode-features.js';

const TEXT = 'Please call Stella.';
const TYPES = ['breathy', 'lax', 'pressed', 'creaky', 'falsetto', 'harsh'];
const semi = (a, b) => 12 * Math.log2(a / b);
const f = (x) => x.toFixed(2);

function render(name, source) {
  const text = name
    ? `<speak><vs:phonation name="${name}" degree="1">${TEXT}</vs:phonation></speak>`
    : TEXT;
  const r = synthesize(text, { tier: 'medium', seed: 1, markup: true, source });
  const { channels } = r.plan;
  const mean = (values) => {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      if (channels.voicing[i] > 0.5) {
        sum += values[i];
        count++;
      }
    }
    return sum / count;
  };
  const v = analyzeVoice(r.samples, r.sampleRate);
  return {
    ...v,
    adduction: mean(channels.adduction),
    foldTension: mean(channels.foldTension),
    lungPressure: mean(channels.lungPressure),
    cpp: cpp(r.samples, r.sampleRate),
    jitter: jitterPercent(r.samples, r.sampleRate),
    pulse: pulseF0(r.samples, r.sampleRate),
  };
}

// The thresholds of tests/phonation.test.js for the whole sentence.
const TARGETS = {
  breathy: (m, o) =>
    m.h1h2 >= 7 &&
    m.h1h2 >= o.h1h2 + 4 &&
    m.hnr <= o.hnr - 4 &&
    m.cpp <= o.cpp - 3 &&
    Math.abs(semi(m.f0, o.f0)) <= 1,
  lax: (m, o) =>
    m.h1h2 - o.h1h2 >= 2 && m.h1h2 - o.h1h2 <= 6 && m.hnr >= o.hnr - 2,
  pressed: (m, o) => m.h1h2 <= 0 && m.h1h2 <= o.h1h2 - 4 && m.hnr >= o.hnr - 2,
  creaky: (m, o) => Math.abs(semi(m.pulse, o.pulse) + 12) <= 2 && m.jitter >= 5,
  falsetto: (m, o) => Math.abs(semi(m.f0, o.f0) - 12) <= 1 && m.h1h2 >= 8,
  harsh: (m, o) => m.h1h2 <= 0 && m.hnr <= o.hnr - 5 && m.jitter >= 3,
};

for (const source of ['lf', 'folds']) {
  console.log(`source ${source}`);
  const modal = render(null, source);
  for (const name of [null, ...TYPES]) {
    const m = name ? render(name, source) : modal;
    const passes = name ? (TARGETS[name](m, modal) ? 'pass' : 'FAIL') : '';
    console.log(
      `  ${(name ?? 'modal').padEnd(9)} adduction ${f(m.adduction)} foldTension ${f(m.foldTension)} lung ${f(m.lungPressure)} Pa | f0 ${f(m.f0)} (${f(semi(m.f0, modal.f0))} st) pulseF0 ${f(m.pulse)} (${f(semi(m.pulse, modal.pulse))} st) h1h2 ${f(m.h1h2)} hnr ${f(m.hnr)} cpp ${f(m.cpp)} jitter ${f(m.jitter)} % ${passes}`
    );
  }
}
