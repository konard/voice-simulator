/** Compare tone model timing against oracle-aligned whispered ma probes. Unlicense. */
import { analyzeFrames } from '../src/index.js';
import { toneCurve } from '../src/articulation/tone-model.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const tones = [[5], [3, 5], [2, 1, 4], [5, 1]];
const expected = [1.0544, 1.078, 1.1251, 1.0072];
const center = (values) =>
  values.map((value) => value - values.reduce((a, b) => a + b) / values.length);
const sample = (values, index) => {
  const i = Math.floor(index);
  return (
    values[i] +
    (values[Math.min(i + 1, values.length - 1)] - values[i]) * (index - i)
  );
};
for (const preset of ['male', 'female']) {
  const { samples, sampleRate, timeline, plan } = renderWhisper(
    '[whisper] 妈 麻 马 骂',
    'zh',
    preset
  );
  const frames = analyzeFrames(samples, sampleRate);
  const avg =
    timeline.words.reduce((sum, { end, start }) => sum + end - start, 0) /
    timeline.words.length;
  let lastEnd;
  const choices = {};
  for (const [index, word] of timeline.words.entries()) {
    const vowel = plan.segments.find(
      (segment) =>
        segment.kind === 'vowel' && segment.start >= word.start - 1e-9
    );
    for (const interval of [0, 1]) {
      for (const startState of [0, 1]) {
        const first = vowel.start;
        const end = word.end;
        const begin = interval ? (lastEnd ?? first) : first;
        const pitch = tones[index - 1]?.at(-1);
        const pressed =
          startState && pitch !== undefined ? (pitch - 3) * 2 : undefined;
        const energy = center(
          Array.from({ length: 10 }, (_, i) =>
            sample(
              frames.energy,
              (first + ((end - first - 0.005) * i) / 9) / frames.hop
            )
          )
        );
        const scores = tones.map((tone, t) => {
          const curve = toneCurve(tone, {
            count: 101,
            duration: end - begin,
            start: pressed,
          });
          const observed = center(energy);
          const predicted = center(
            Array.from({ length: 10 }, (_, i) =>
              sample(
                curve,
                (100 * (first - begin + ((end - first - 0.005) * i) / 9)) /
                  (end - begin)
              )
            )
          );
          const shape = Math.min(
            1,
            Math.sqrt(
              predicted.reduce(
                (sum, val, k) => sum + (val * 0.7 - observed[k]) ** 2,
                0
              ) / 10
            ) / 4
          );
          const length = Math.min(
            1,
            2 * Math.abs((end - word.start) / avg - expected[t])
          );
          return 0.6 * shape + 0.4 * length;
        });
        (choices[`${interval}/${startState}`] ??= []).push(
          scores.indexOf(Math.min(...scores)) + 1
        );
      }
    }
    lastEnd = vowel.end;
  }
  console.log(preset, choices);
}
