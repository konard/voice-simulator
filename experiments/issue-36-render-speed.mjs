/**
 * Issue 36 acceptance: the sentence of experiments/issue-11-audit-m2.mjs
 * renders at most 8 % slower on tier `medium` with the frequency-dependent
 * losses. Renders the plan with this checkout and with SOURCE (another src
 * directory, e.g. a worktree of main), alternating them so that both see
 * the same machine load, and prints the median time of each.
 *
 * Run: git worktree add /tmp/main main
 *      SOURCE=/tmp/main/src node experiments/issue-36-render-speed.mjs
 */
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = await import('../src/index.js');
const other = process.env.SOURCE
  ? await import(
      new URL(`file://${process.env.SOURCE.replace(/\/?$/, '/')}index.js`).href
    )
  : null;

const text = 'Please call Stella and ask her to bring these things with her.';
const options = { tier: 'medium', seed: 1 };
const runs = Number(process.env.RUNS ?? 9);

function prepare(api) {
  const { plan, samples, sampleRate } = api.synthesize(text, options);
  return { api, plan, seconds: samples.length / sampleRate, times: [] };
}
const subjects = [prepare(here), ...(other ? [prepare(other)] : [])];
for (let run = 0; run < runs; run++) {
  for (const subject of subjects) {
    const start = performance.now();
    subject.api.renderPlan(subject.plan, options);
    subject.times.push((performance.now() - start) / 1000);
  }
}
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const labels = ['this checkout', process.env.SOURCE];
subjects.forEach((subject, index) => {
  console.log(
    `${labels[index]}: ${subject.seconds.toFixed(2)} s of audio, median ` +
      `render ${median(subject.times).toFixed(3)} s over ${runs} runs`
  );
});
if (other) {
  const ratio = median(subjects[0].times) / median(subjects[1].times);
  console.log(`slowdown: ${((ratio - 1) * 100).toFixed(1)} % (limit 8 %)`);
}
