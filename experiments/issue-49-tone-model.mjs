// Issue 49: checks of the tone model and the planner.
// Usage: node experiments/issue-49-tone-model.mjs > experiments/issue-49-tone-model.txt
//
// 1. The closed form of tone-model.js solves the critically damped
//    third-order system y''' + 3λy'' + 3λ²y' + λ³(y − x) = 0: the residual
//    from finite differences of its value, and its lag behind a ramp.
// 2. The largest f0 step between frames of tonal phrases (Thai, Mandarin).
// 3. Neutral tones: f0 and durations of the second syllable.
import { approachTargets, TONE_RATES } from '../src/articulation/tone-model.js';
import { planUtterance } from '../src/articulation/plan.js';
import { normalizeHeadConfig } from '../src/head-config.js';
import { textToIpa } from '../src/g2p/index.js';

const st = (ratio) => 12 * Math.log2(ratio);

// 1. Residual of the ODE at a high frame rate.
{
  const rate = 40;
  const frameRate = 20000;
  const interval = { duration: 0.2, from: 4, to: -6, rate };
  const { values } = approachTargets(
    [interval],
    { value: 2, velocity: 30, acceleration: -500 },
    frameRate
  );
  const h = 1 / frameRate;
  const slope = (interval.to - interval.from) / interval.duration;
  let residual = 0;
  for (let k = 2; k < values.length - 2; k++) {
    const target = interval.from + (slope * k) / frameRate;
    const d1 = (values[k + 1] - values[k - 1]) / (2 * h);
    const d2 = (values[k + 1] - 2 * values[k] + values[k - 1]) / h ** 2;
    const d3 =
      (values[k + 2] - 2 * values[k + 1] + 2 * values[k - 1] - values[k - 2]) /
      (2 * h ** 3);
    const r =
      d3 +
      3 * rate * d2 +
      3 * rate ** 2 * d1 +
      rate ** 3 * (values[k] - target);
    residual = Math.max(residual, Math.abs(r) / rate ** 3);
  }
  console.log(`ODE residual / λ³ (max, st): ${residual.toExponential(2)}`);
  const ramp = approachTargets(
    [{ duration: 1, from: 0, to: 10, rate: 50 }],
    null,
    200
  ).values;
  console.log(
    `ramp 10 st/s, λ 50: y(0.5 s) = ${ramp[100].toFixed(3)} st (line 5, lag 3/λ → 4.4)`
  );
}

const head = normalizeHeadConfig({ vibrato: 0 });

/** Largest step (st) between neighbouring voiced frames inside vowels. */
function largestStep(ipa, language) {
  const plan = planUtterance(ipa, { head, language });
  const f0 = plan.channels.f0;
  let step = 0;
  for (let k = 1; k < f0.length; k++) {
    step = Math.max(step, Math.abs(st(f0[k] / f0[k - 1])));
  }
  return step;
}

// 2. Steps.
console.log('\nlargest f0 step between frames (st), whole utterance:');
for (const [ipa, language] of [
  ['pʰaː˧ maː˥˩ kʰaː˩˩˦', 'th'],
  ['ma˥˩ ma˥ ma˨˩˦ ma˧˥', 'zh'],
  [textToIpa('我很好，你好吗？', { lang: 'zh' }).ipa, 'zh'],
  ['si˥ si˧˥ si˧ si˨˩ si˩˧ si˨', 'yue'],
]) {
  console.log(`  ${language} ${ipa}: ${largestStep(ipa, language).toFixed(3)}`);
}

// 3. Neutral tones.
/** f0 (Hz) at fractions of a vowel and the vowel durations (ms). */
function vowels(ipa) {
  const plan = planUtterance(ipa, { head, language: 'zh' });
  return plan.segments
    .filter((segment) => segment.kind === 'vowel')
    .map((segment) => {
      const span = segment.end - segment.start;
      const at = (fraction) =>
        plan.channels.f0[
          Math.round((segment.start + span * fraction) * plan.frameRate)
        ];
      return {
        ms: Math.round(span * 1000),
        f0: [0.1, 0.5, 0.9].map((fraction) => Math.round(at(fraction))),
      };
    });
}
console.log('\nvowels: duration (ms) and f0 (Hz) at 10, 50, 90 %:');
for (const text of ['妈妈', '爸爸', '哥哥', '奶奶', '爷爷', '好吗？']) {
  const { ipa } = textToIpa(text, { lang: 'zh' });
  const line = vowels(ipa)
    .map(({ ms, f0 }) => `${ms} ms ${f0.join('/')}`)
    .join(' | ');
  console.log(`  ${text} ${ipa}: ${line}`);
}
for (const ipa of ['ma˥ ma', 'ma˥˩ ma', 'ma˨˩ ma', 'ma˧˥ ma', 'ma˥ ma ma˥']) {
  const line = vowels(ipa)
    .map(({ ms, f0 }) => `${ms} ms ${f0.join('/')}`)
    .join(' | ');
  console.log(`  ${ipa}: ${line}`);
}
console.log(`\nTONE_RATES ${JSON.stringify(TONE_RATES)}`);
