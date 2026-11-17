// Steady vowels through trackFormants against the planned formants
// (tubeFormants of the planned area function) per frame, as in the test
// `tracks steady vowels` of tests/recognition-formants.test.js: 10 vowels of
// 0.5 s, presets male, female and child, 16000 and 8000 Hz, with the tract
// length estimated (the default) and with the tract length of the head.
// Per preset and rate: masked-in frames, frames with F1 .. F3 not all valid,
// frames with a formant more than 20 % off, the mean error per formant (%)
// and the audit line of experiments/issue-11-audit-m4a.txt it is held to,
// and with --verbose the vowels whose mean error exceeds 15 %.
// Run: node experiments/issue-60-vowels.mjs > experiments/issue-60-vowels.txt
import {
  analyzeFrames,
  formantErrors,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  trackFormants,
} from '../src/index.js';
import { plannedFormants } from '../tests/helpers/recognition-truth.js';

const VOWELS = ['i', 'e', 'ɛ', 'a', 'ɑ', 'ɔ', 'o', 'u', 'ə', 'y'];
/** meanErrorPercent of the `formants` lines of the audit (estimateFormants). */
const AUDIT = {
  'male@16000': [7, 5.2, 3.6],
  'male@8000': [6.4, 5.4, 3.7],
  'female@16000': [12.2, 6.8, 6.1],
  'female@8000': [12, 6.7, 7.1],
  'child@16000': [16.7, 12.3, 6.6],
  'child@8000': [12.7, 6.9, 5.4],
};
const verbose = process.argv.includes('--verbose');

/** F1 .. F3 of the masked-in frames, the invalid ones and those 20 % off. */
function compare(truth, track) {
  const vr = [];
  const vt = [];
  let bad = 0;
  let off = 0;
  for (let t = 0; t < track.count; t++) {
    if (!truth.mask[t]) {
      continue;
    }
    const row = [0, 1, 2].map((k) =>
      track.valid[t * 4 + k] ? track.frequency[t * 4 + k] : 0
    );
    const r = truth.formants[t].slice(0, 3);
    bad += row.some((v) => !(v > 0)) ? 1 : 0;
    off += row.some((v, k) => v > 0 && Math.abs(v / r[k] - 1) > 0.2) ? 1 : 0;
    vr.push(r);
    vt.push(row);
  }
  return { vr, vt, bad, off };
}

const renders = new Map();
for (const fixed of [false, true]) {
  console.log(fixed ? 'tract length of the head' : 'tract length estimated');
  let bad = 0;
  let over = 0;
  for (const preset of ['male', 'female', 'child']) {
    for (const rate of [16000, 8000]) {
      const key = `${preset}@${rate}`;
      const reference = [];
      const test = [];
      let invalid = 0;
      let over20 = 0;
      const worst = [];
      for (const vowel of VOWELS) {
        const head = presetHeadConfig(preset);
        if (!renders.has(`${key}:${vowel}`)) {
          const plan = planUtterance(`${vowel}ː`, { head, durations: [0.5] });
          const samples = renderPlan(plan, {
            head,
            solver: 'waveguide',
            sampleRate: rate,
            seed: 1,
          });
          renders.set(`${key}:${vowel}`, { plan, samples });
        }
        const { plan, samples } = renders.get(`${key}:${vowel}`);
        const frames = analyzeFrames(samples, rate);
        const track = trackFormants(
          frames,
          fixed ? { vocalTractLength: head.vocalTractLength } : {}
        );
        const truth = plannedFormants(plan, head, frames.hop, track.count);
        const { vr, vt, bad: frameBad, off } = compare(truth, track);
        invalid += frameBad;
        over20 += off;
        reference.push(...vr);
        test.push(...vt);
        const e = formantErrors(vr, vt);
        const means = [e.f1, e.f2, e.f3].map((x) => x.percent ?? Infinity);
        if (Math.max(...means) > 15) {
          worst.push(
            `${vowel} ${means.map((x) => x.toFixed(0)).join('/')} ` +
              `L ${track.vocalTractLength.toFixed(1)}`
          );
        }
      }
      const e = formantErrors(reference, test);
      const means = [e.f1, e.f2, e.f3].map((x) => x.percent ?? Infinity);
      const above = means.filter((x, k) => !(x < AUDIT[key][k])).length;
      bad += invalid + over20;
      over += above;
      console.log(
        `  ${key}: frames ${reference.length} invalid ${invalid} ` +
          `over20 ${over20} mean % ${means.map((x) => x.toFixed(1)).join(' ')} ` +
          `audit ${AUDIT[key].join(' ')} above ${above}`
      );
      if (verbose && worst.length > 0) {
        console.log(`    vowels above 15 %: ${worst.join(', ')}`);
      }
    }
  }
  console.log(`  total invalid + over20 ${bad}, means above the audit ${over}`);
}
