/** Bounded audit of recognition/replay stability for every speech label. */
import { synthesize, toPlanModes } from '../../src/index.js';
import {
  LABELS,
  HEAD,
  render,
  recognize,
  dominant,
} from '../../tests/helpers/recognition-modes.js';

const requested = process.argv.slice(2);
for (const label of LABELS.filter(
  (s) => !requested.length || requested.includes(s)
)) {
  const first = recognize(render('en', label), 'en');
  const replay = synthesize(first.ipa, {
    ipa: true,
    head: HEAD,
    tier: 'minimal',
    seed: 1,
    engine: 'js',
    modes: toPlanModes(first.modes),
  });
  const second = recognize(replay, 'en');
  const field = ['allegro', 'lento'].includes(label) ? 'tempo' : 'quality';
  console.log(
    JSON.stringify({
      source: label,
      first: dominant(first.modes, field),
      replay: dominant(second.modes, field),
      modes: first.modes,
      replayModes: second.modes,
    })
  );
}
