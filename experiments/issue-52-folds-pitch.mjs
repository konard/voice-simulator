// Step 8 of issue 52: the pitch rise the fold model gives on its own when
// the effort raises the lung pressure, measured on `ˈa`. The LF source
// sounds the planned pitch; the shift of the fold source beyond the shift
// of the LF source (each re its plain `ˈa`) is the rise of the folds.
// Without a compensation it printed -0.18, +0.40 and +1.34 st on the `ˈa`
// of issue 52. The statement tune of issue 51 changed the contour of `ˈa`
// (a level start, then the fall), and it printed -0.34, 0.00 and +0.74 st;
// these are the points of FOLD_PITCH_RISE (src/articulation/effort.js),
// with -0.39 at -10 dB, where -0.34 left -0.06 st. With them the rise left
// is within ±0.01 st.
// Usage: node experiments/issue-52-folds-pitch.mjs
import { analyzeVoice, synthesize } from '../src/index.js';

const marks = ['{p ˈa p}', '{f ˈa f}', '{ff ˈa ff}'];

function shifts(source) {
  const options = { tier: 'medium', seed: 1, ipa: true, headroom: 20, source };
  const f0 = (ipa) => {
    const r = synthesize(ipa, options);
    return analyzeVoice(r.samples, r.sampleRate).f0;
  };
  const plain = f0('ˈa');
  return marks.map((ipa) => 12 * Math.log2(f0(ipa) / plain));
}

const lf = shifts('lf');
const folds = shifts('folds');
marks.forEach((ipa, index) => {
  console.log(
    ipa.padEnd(10),
    `lf ${lf[index].toFixed(2)} st`,
    `folds ${folds[index].toFixed(2)} st`,
    `rise of the folds ${(folds[index] - lf[index]).toFixed(2)} st`
  );
});
