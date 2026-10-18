/**
 * Segment levels of ˈata and ˈasa (as the acoustics tests measure them),
 * relative to the stressed vowel. Args: [solver]
 */
import { rms } from '../src/acoustics/analysis.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { planUtterance } from '../src/articulation/plan.js';

const RATE = 24000;
const solver = process.argv[2] ?? 'waveguide';
function level(samples, plan, index) {
  const s = plan.segments[index];
  return rms(samples, Math.floor(s.start * RATE), Math.floor(s.end * RATE));
}
const plan = planUtterance('ˈata');
const samples = renderPlan(plan, { sampleRate: RATE, solver });
const kinds = plan.segments.map((s) => s.kind);
const vowel = level(samples, plan, kinds.indexOf('vowel'));
const closure = level(samples, plan, kinds.indexOf('consonant'));
for (const text of ['ˈasa', 'ˈaʃa', 'ˈafa', 'ˈaθa', 'ˈaxa']) {
  const p = planUtterance(text);
  const f = renderPlan(p, { sampleRate: RATE, solver });
  const i = p.segments.findIndex((s) => s.kind === 'consonant');
  console.log(
    text,
    'fricative/vowel',
    (level(f, p, i) / vowel).toFixed(3),
    `(${(20 * Math.log10(level(f, p, i) / vowel)).toFixed(1)} dB)`
  );
}
console.log(
  'vowel',
  vowel.toFixed(4),
  'closure/vowel',
  (closure / vowel).toFixed(3)
);
