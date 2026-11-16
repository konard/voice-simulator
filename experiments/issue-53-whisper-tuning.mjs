// Tuning of the whisper source (issue 53): F1 and F2 of whispered [a], [i]
// and [u] against the voiced vowels (WHISPER_OPENING), at a tier (default
// high). Usage:
//   node experiments/issue-53-whisper-tuning.mjs [tier]
import { synthesize, estimateFormants } from '../src/index.js';
import { WHISPER_OPENING } from '../src/acoustics/whisper.js';

const tier = process.argv[2] ?? 'high';
const OPTIONS = { tier, seed: 1, ipa: true, headroom: 20 };

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Median F1..F3 of 40 ms frames (hop 10 ms) over the middle 60 % of the
 * vowel of a one-vowel utterance: one LPC fit of a noise-excited vowel
 * misses formants now and then, the median of many does not.
 */
function vowelFormants(text) {
  const result = synthesize(text, OPTIONS);
  const vowel = result.plan.segments.find((s) => s.kind === 'vowel');
  const length = vowel.end - vowel.start;
  const tracks = [[], [], []];
  for (let start = vowel.start + 0.2 * length; start + 0.04 <= vowel.end - 0.2 * length; start += 0.01) {
    const found = estimateFormants(result.samples, result.sampleRate, { start, duration: 0.04, count: 3 });
    found.forEach((value, at) => tracks[at].push(value));
  }
  const whole = estimateFormants(result.samples, result.sampleRate, {
    start: vowel.start + 0.2 * length,
    duration: 0.6 * length,
    count: 3,
  });
  return { formants: tracks.map(median), whole, engine: result.engine };
}

console.log(`WHISPER_OPENING ${WHISPER_OPENING}, tier ${tier}`);
let rise = 0;
for (const vowel of ['a', 'i', 'u']) {
  const started = performance.now();
  const voiced = vowelFormants(`ˈ${vowel}`);
  const whispered = vowelFormants(`{W ˈ${vowel} W}`);
  const delta = whispered.formants.map((value, at) => value - voiced.formants[at]);
  rise += delta[0] / 3;
  console.log(
    vowel,
    'voiced',
    voiced.formants.map(Math.round),
    'whispered',
    whispered.formants.map(Math.round),
    'rise',
    delta.map(Math.round),
    'one window',
    voiced.whole.map(Math.round),
    whispered.whole.map(Math.round),
    `${((performance.now() - started) / 1000).toFixed(1)}s`
  );
}
console.log('mean F1 rise', Math.round(rise), 'Hz (target 255 ± 90)');
