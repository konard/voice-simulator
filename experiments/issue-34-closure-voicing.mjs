/**
 * Checklist item d of issue 34: voicing through the closure of [b] and [p]
 * on tier medium (the waveguide at 44100 Hz) with the fold source, with and
 * without the source-tract interaction (the LF source has no glottal flow
 * to measure: its voicing follows the plan).
 *
 * The lips close when the narrowest oral area of the block shape (the
 * frication constriction, which the air flow model uses) first falls below
 * CLOSED cm² in the consonant. A glottal pulse is a peak of the flow that is
 * the largest within half a period on both sides and rises more than
 * VOICED of the peak-to-peak flow of the 10 ms before the closure above
 * the lowest flow of the period before it; voicing lasts until the last
 * pulse before the lips open again. Prints, per utterance, the closure
 * time and length, the mouth pressure 40 ms in and how long voicing lasts
 * after the closure.
 *
 *   node experiments/issue-34-closure-voicing.mjs
 */
import { planUtterance } from '../src/articulation/plan.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';
import { flowPitch } from '../src/acoustics/folds.js';

const RATE = 44100;
const CLOSED = 0.001;
const VOICED = 0.1;
/** Other pulse thresholds, to show how much the result depends on VOICED. */
const THRESHOLDS = [0.05, 0.2];
const WINDOW = Math.round(0.01 * RATE);
const SETUPS = {
  folds: { source: 'folds' },
  interaction: { source: 'folds', interaction: true },
};

function trace(ipa, options) {
  const plan = planUtterance(ipa);
  const renderer = new VoiceRenderer(plan, {
    sampleRate: RATE,
    seed: 1,
    ...options,
  });
  const flow = new Float64Array(renderer.totalSamples);
  const opening = new Float64Array(renderer.totalSamples);
  const mouth = new Float64Array(renderer.totalSamples);
  const one = new Float32Array(1);
  for (let index = 0; index < flow.length; index++) {
    renderer.render(one);
    flow[index] = renderer.glottis.u;
    opening[index] = renderer.shape.frication.area;
    mouth[index] = renderer.airflow?.oralPressure ?? 0;
  }
  const consonant = plan.segments.find((entry) => entry.kind !== 'vowel');
  return { flow, opening, mouth, consonant };
}

function peakToPeak(flow, from, to) {
  let low = Infinity;
  let high = -Infinity;
  for (let index = Math.max(0, from); index < to; index++) {
    low = Math.min(low, flow[index]);
    high = Math.max(high, flow[index]);
  }
  return high - low;
}

function voicingAfterClosure({ flow, opening, consonant }, voiced = VOICED) {
  let closed = Math.round(consonant.start * RATE);
  while (closed < opening.length && opening[closed] >= CLOSED) {
    closed++;
  }
  let reopened = closed;
  while (reopened < opening.length && opening[reopened] < CLOSED) {
    reopened++;
  }
  const before = peakToPeak(flow, closed - WINDOW, closed);
  // The period of the flow in the 50 ms before closing.
  const period = Math.round(
    RATE / flowPitch(flow.subarray(closed - 5 * WINDOW, closed), RATE)
  );
  const half = Math.round(period / 2);
  let last = closed;
  for (let index = closed; index < reopened; index++) {
    const around = flow.subarray(index - half, index + half + 1);
    if (
      flow[index] === Math.max(...around) &&
      flow[index] - Math.min(...flow.subarray(index - period, index)) >
        voiced * before
    ) {
      last = index;
    }
  }
  return {
    closed: closed / RATE,
    closure: (reopened - closed) / RATE,
    period: period / RATE,
    voicing: (last - closed) / RATE,
  };
}

console.log(
  `closure: frication area < ${CLOSED} cm²; pulse: a flow peak > ${VOICED * 100} % of the peak-to-peak flow of the 10 ms before the closure`
);
for (const ipa of ['ˈaba', 'ˈapa']) {
  for (const [name, options] of Object.entries(SETUPS)) {
    const run = trace(ipa, options);
    const result = voicingAfterClosure(run);
    const at = Math.round((result.closed + 0.04) * RATE);
    console.log(
      `[${ipa}] ${name.padEnd(11)} closes at ${(1000 * result.closed).toFixed(1)} ms for ` +
        `${(1000 * result.closure).toFixed(1)} ms, mouth pressure 40 ms in ` +
        `${(run.mouth[at] / 10).toFixed(0)} Pa, voicing ` +
        `${(1000 * result.voicing).toFixed(1)} ms (period ${(1000 * result.period).toFixed(1)} ms; ` +
        THRESHOLDS.map(
          (voiced) =>
            `${(1000 * voicingAfterClosure(run, voiced).voicing).toFixed(1)} ms at ${voiced * 100} %`
        ).join(', ') +
        ')'
    );
  }
}
