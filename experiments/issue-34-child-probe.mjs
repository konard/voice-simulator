/**
 * Probe: the child preset's static [ɑ] on tier medium with the LF source,
 * the fold source and the fold source with interaction: the head pitch,
 * and the RMS and pitch of the middle 80 ms.
 *
 *   node experiments/issue-34-child-probe.mjs
 */
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { estimatePitch, rms } from '../src/acoustics/analysis.js';
import { presetHeadConfig } from '../src/head-config.js';

const RATE = 16000;
for (const preset of ['male', 'female', 'child']) {
  const head = presetHeadConfig(preset);
  for (const options of [
    { source: 'lf' },
    { source: 'folds' },
    { source: 'folds', interaction: true },
  ]) {
    const plan = planUtterance('ˈɑː', { head });
    const samples = renderPlan(plan, { sampleRate: RATE, ...options });
    const segment = plan.segments.find((entry) => entry.kind === 'vowel');
    const start = (segment.start + segment.end) / 2 - 0.04;
    const from = Math.round(start * RATE);
    const to = from + Math.round(0.08 * RATE);
    console.log(
      preset,
      head.pitch,
      JSON.stringify(options),
      'rms',
      rms(samples, from, to).toFixed(4),
      'f0',
      estimatePitch(samples, RATE, { start, duration: 0.08, min: 70 }).toFixed(
        1
      )
    );
  }
}
