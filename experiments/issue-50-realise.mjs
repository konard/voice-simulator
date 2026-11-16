// What the plan does with speech modes: rate, pitch and level against the
// plain text, timed pauses and sounds, and plan.modes coverage.
// Run: node experiments/issue-50-realise.mjs
import { textToIpa } from '../src/g2p/index.js';
import { planUtterance, modeAt } from '../src/articulation/plan.js';

const plan = (text, options = {}) => {
  const result = textToIpa(text, options);
  return { result, plan: planUtterance(result.ipa, { modes: result.modes }) };
};
const words = 'Hello there, my good friend';
/** Seconds of the segments of tokens in IPA words [from, to). */
const wordTime = (target, from, to) =>
  target.segments
    .filter((s) => s.token && s.token.word >= from && s.token.word < to)
    .reduce((sum, s) => sum + s.duration, 0);
const plain = plan(`${words}, and more.`);
const fast = plan(`[fast]${words}[/fast], and more.`, { markup: true });
const span = fast.result.modes[0];
console.log('fast ipa:', fast.result.ipa);
const ratio =
  wordTime(fast.plan, span.from, span.to) /
  wordTime(plain.plan, span.from, span.to);
console.log(`[fast] duration ratio ${ratio.toFixed(3)} (expect 0.77 ± 0.05)`);

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const plainAll = plan(`${words}.`);
const high = plan(`[pitch +12]${words}.[/pitch]`, { markup: true });
const f0Ratio =
  mean(Array.from(high.plan.channels.f0)) /
  mean(Array.from(plainAll.plan.channels.f0));
console.log(`[pitch +12] mean f0 ratio ${f0Ratio.toFixed(4)} (expect 2 ± 3 %)`);
const soft = plan(`[soft]${words}.[/soft]`, { markup: true });
const peak = (target) => Math.max(...target.plan.channels.loudness);
const level = peak(soft) / peak(plainAll);
console.log(
  `[soft] peak loudness ratio ${level.toFixed(4)} (expect 0.32 ± 0.02)`
);

const timed = plan('Wait [pause 1.5] now [laugh] then [cough 0.5] ok.', {
  markup: true,
});
console.log('timed ipa:', timed.result.ipa);
console.log(
  'timed pauses:',
  timed.plan.segments
    .filter((s) => s.timed)
    .map((s) => `${s.sound ?? 'pause'} ${s.duration.toFixed(3)} s`)
    .join(', ')
);
console.log('sounds:', JSON.stringify(timed.plan.sounds));
const { modes, duration } = fast.plan;
const covers =
  modes[0].start === 0 &&
  modes.at(-1).end === duration &&
  modes.every((m, i) => i === 0 || m.start === modes[i - 1].end);
console.log(
  `fast plan.modes: ${modes.length} spans, cover 0..${duration.toFixed(3)}: ${covers}`
);
console.log('modeAt(0.3).rate =', modeAt(fast.plan, 0.3).rate);
const whisperText = plan('[whisper]Hello[/whisper] world.', { markup: true });
const whisperIpa = planUtterance(whisperText.result.ipa);
console.log(
  'text and IPA give the same plan.modes:',
  JSON.stringify(whisperText.plan.modes) === JSON.stringify(whisperIpa.modes)
);
