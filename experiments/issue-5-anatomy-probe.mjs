// Probe vowel/consonant states: jaw openness, areas near the lips and glottis.
// Usage: node experiments/issue-5-anatomy-probe.mjs
import { planUtterance } from '../src/articulation/plan.js';
import { sampleState, tractShape } from '../src/articulation/tract-shape.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const fmt = (values) => Array.from(values, (v) => v.toFixed(2)).join(' ');

for (const text of [
  'ˈiː',
  'ˈɑː',
  'ˈuː',
  'ˈəː',
  'ˈasa',
  'ˈaʃa',
  'ˈafa',
  'ˈata',
]) {
  const plan = planUtterance(text);
  for (const segment of plan.segments) {
    const time = (segment.start + segment.end) / 2;
    const state = sampleState(plan, time);
    const shape = tractShape(state, DEFAULT_HEAD);
    console.log(
      text,
      segment.phoneme?.symbol ?? segment.kind,
      'h',
      state.height.toFixed(2),
      'jaw',
      shape.jaw.toFixed(2),
      'sib',
      (state.sibilance ?? 0).toFixed(2),
      'fric',
      JSON.stringify({
        i: shape.frication.index,
        p: shape.frication.position,
        g: Number(shape.frication.gain.toFixed(3)),
        o: shape.frication.obstacle,
      }),
      'teeth',
      JSON.stringify(shape.teeth),
      '| first',
      fmt(shape.areas.slice(0, 6)),
      '| last',
      fmt(shape.areas.slice(-6))
    );
  }
}
