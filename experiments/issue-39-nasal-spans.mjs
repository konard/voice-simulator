/**
 * Issue 39: the nasal-murmur measurement of tests/head-parameters.test.js
 * ("lowers the nasal murmur with higher nasal losses") for words whose
 * [m] has different planned lengths.
 * Usage: node experiments/issue-39-nasal-spans.mjs [src path]
 */
const root = process.argv[2] ?? '../src';
const { planUtterance } = await import(`${root}/articulation/plan.js`);
const { renderPlan } = await import(`${root}/acoustics/voice.js`);
const { normalizeHeadConfig, HEAD_PARAMETERS } = await import(
  `${root}/head-config.js`
);
const RATE = 16000;
const rms = (samples, start, end) => {
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / Math.max(1, end - start));
};
const parameter = HEAD_PARAMETERS.find((entry) => entry.key === 'nasalLoss');
for (const ipa of ['ˈama', 'aˈma', 'ˈamːa']) {
  let span = 0;
  const level = (nasalLoss) => {
    const head = normalizeHeadConfig({ nasalLoss });
    const plan = planUtterance(ipa, { head });
    const samples = renderPlan(plan, { sampleRate: RATE, seed: 3 });
    const nasal = plan.segments.find((item) => item.kind === 'consonant');
    span = nasal.end - nasal.start;
    return rms(
      samples,
      Math.floor(nasal.start * RATE),
      Math.floor(nasal.end * RATE)
    );
  };
  const [low, middle, high] = [
    parameter.min,
    parameter.default,
    parameter.max,
  ].map(level);
  console.log(
    `${ipa.padEnd(6)} [m] ${(span * 1000).toFixed(0)} ms, max/default ${(high / middle).toFixed(3)}, default/min ${(middle / low).toFixed(3)}`
  );
}
