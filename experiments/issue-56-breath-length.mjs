// Issue 56: the length of the inserted breath vs the syllables up to the
// next sentence pause (min(0.7, 0.3 + 0.03 n)).
// node experiments/issue-56-breath-length.mjs
import { prepareUtterance } from '../src/synthesize.js';

for (const text of [
  'One. Two three four five six seven.',
  'One. Two.',
  'One. Two three four five six seven eight nine ten eleven twelve thirteen fourteen.',
]) {
  const { plan, timeline } = prepareUtterance(text, { breaths: true });
  const breath = plan.sounds.find((sound) => sound.name === 'inhale');
  const next = timeline.words[1];
  console.log(
    text,
    breath ? (breath.end - breath.start).toFixed(3) : 'none',
    breath ? `gap ${(next.start - breath.end).toFixed(3)}` : ''
  );
  const parts = plan.segments.filter((s) => s.soundOf?.breath);
  console.log(
    ' parts',
    parts.map((s) => `${s.kind}:${(s.end - s.start).toFixed(3)}`).join(' ')
  );
}
