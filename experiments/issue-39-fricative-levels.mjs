/**
 * Issue 39: the measurements of the turbulence test "weakens the noise of
 * voiced fricatives" (tests/acoustics.test.js) and of the nasal-murmur
 * test (tests/head-parameters.test.js) for several words, so that a word
 * whose consonant is long enough for the middle 60 % to be steady can be
 * chosen. Usage: node experiments/issue-39-fricative-levels.mjs [src path]
 */
const root = process.argv[2] ?? '../src';
const { synthesize } = await import(`${root}/index.js`);
const { Biquad } = await import(`${root}/acoustics/filters.js`);

const rms = (samples, start, end) => {
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / Math.max(1, end - start));
};
const render = (ipa) =>
  synthesize(ipa, { ipa: true, tier: 'medium', seed: 1, head: {} });
const consonantLevel = ({ samples, sampleRate, plan }, filter) => {
  const segment = plan.segments.find((item) => item.kind === 'consonant');
  const span = segment.end - segment.start;
  const start = Math.floor((segment.start + 0.2 * span) * sampleRate);
  const end = Math.floor((segment.end - 0.2 * span) * sampleRate);
  const signal = filter ? Float32Array.from(samples, filter) : samples;
  return {
    level: 20 * Math.log10(rms(signal, start, end)),
    ms: span * 1000,
  };
};
const above4k = (sampleRate) => {
  const first = new Biquad();
  const second = new Biquad();
  first.highpass(4000, Math.SQRT1_2, sampleRate);
  second.highpass(4000, Math.SQRT1_2, sampleRate);
  return (sample) => second.process(first.process(sample));
};
for (const [s, z] of [
  ['ˈasa', 'ˈaza'],
  ['aˈsa', 'aˈza'],
  ['ˈasːa', 'ˈazːa'],
  ['ˈas', 'ˈaz'],
]) {
  const a = render(s);
  const b = render(z);
  const x = consonantLevel(a, above4k(a.sampleRate));
  const y = consonantLevel(b, above4k(b.sampleRate));
  console.log(
    `${s.padEnd(6)} ${z.padEnd(6)} [s] ${x.ms.toFixed(0)} ms, [z] ${y.ms.toFixed(0)} ms, difference ${(x.level - y.level).toFixed(2)} dB`
  );
}
