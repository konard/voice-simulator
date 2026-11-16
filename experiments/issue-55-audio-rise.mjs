// The rise of the last vowel of "[tag]…[/tag]" measured in the audio
// (pulseF0 of its first and last third), issue 55.
// node experiments/issue-55-audio-rise.mjs [tag,…]
import { pulseF0, synthesize } from '../src/index.js';

const TEXT = 'The train leaves at seven.';
const BASE = { tier: 'medium', seed: 1, markup: true, headroom: 20 };
for (const tag of (process.argv[2] ?? 'afraid,surprised,hesitant').split(',')) {
  const input = tag === 'plain' ? TEXT : `[${tag}]${TEXT}[/${tag}]`;
  const { samples, sampleRate, plan } = synthesize(input, BASE);
  const last = plan.segments.filter((s) => s.kind === 'vowel').at(-1);
  const third = (last.end - last.start) / 3;
  const a = pulseF0(samples, sampleRate, {
    start: last.start,
    end: last.start + third,
  });
  const b = pulseF0(samples, sampleRate, {
    start: last.end - third,
    end: last.end,
  });
  console.log(
    tag.padEnd(10),
    a.toFixed(1),
    b.toFixed(1),
    (12 * Math.log2(b / a)).toFixed(2),
    'st'
  );
}
