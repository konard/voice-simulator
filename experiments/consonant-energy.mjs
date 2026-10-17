// Per-segment RMS for consonant/vowel sequences (checks frication, nasals, bursts).
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';

const rate = 48000;
for (const ipa of process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'ˈasa',
      'ˈaʃa',
      'ˈafa',
      'ˈaza',
      'ˈapʰa',
      'ˈata',
      'ˈama',
      'ˈana',
      'ˈala',
      'ˈara',
      'ˈaxa',
      'ˈaha',
    ]) {
  const plan = planUtterance(ipa, { language: 'en' });
  const samples = renderPlan(plan, { sampleRate: rate });
  const parts = plan.segments.map(
    (s) =>
      `${s.token?.symbol ?? '#'}${s.kind === 'release' ? '^' : ''}:${(rms(samples, Math.floor(s.start * rate), Math.floor(s.end * rate)) * 100).toFixed(1)}`
  );
  console.log(ipa.padEnd(6), parts.join(' '));
}
