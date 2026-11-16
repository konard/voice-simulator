// Issue 56: print plan channels (every 2nd frame) over the sounds of a text.
// node experiments/issue-56-channels.mjs 'Yes [laugh]' loudness,f0,breath
import { prepareUtterance } from '../src/index.js';

const [text = 'Yes [laugh]', names = 'loudness,f0,breath,voicing,aspiration'] =
  process.argv.slice(2);
const { plan, head } = prepareUtterance(text, {
  markup: true,
  seed: 1,
  tier: 'medium',
});
console.log('head.pitch', head.pitch, 'sounds', JSON.stringify(plan.sounds));
for (const sound of plan.sounds) {
  const fr = plan.frameRate;
  for (const name of names.split(',')) {
    const values = plan.channels[name].subarray(
      Math.round(sound.start * fr),
      Math.round(sound.end * fr)
    );
    console.log(
      name.padEnd(12),
      Array.from(values)
        .filter((_, i) => i % 2 === 0)
        .map((v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)))
        .join(' ')
    );
  }
}
