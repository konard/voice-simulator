/** Bounded audit of recognition/replay stability for every speech label. */
import { synthesize, toPlanModes } from '../../src/index.js';
import {
  LABELS,
  HEAD,
  render,
  recognize,
  dominant,
} from '../../tests/helpers/recognition-modes.js';

const lang = process.env.LANG_CODE ?? 'en';
const requested = process.argv.slice(2);
for (const label of LABELS.filter(
  (s) => !requested.length || requested.includes(s)
)) {
  const traces = [];
  const trace = (event) => {
    if (event.stage === 'words') {
      traces.push(event);
    }
  };
  const first = recognize(render(lang, label), lang, { trace });
  const replay = synthesize(first.ipa, {
    ipa: true,
    lang,
    head: HEAD,
    tier: 'minimal',
    seed: 1,
    engine: 'js',
    modes: toPlanModes(first.modes),
  });
  const second = recognize(replay, lang, { trace });
  const field = ['allegro', 'lento'].includes(label) ? 'tempo' : 'quality';
  console.log(
    JSON.stringify({
      lang,
      source: label,
      first: dominant(first.modes, field),
      replay: dominant(second.modes, field),
      modes: first.modes,
      replayModes: second.modes,
      ...(process.env.TRACE_MODES ? { traces } : {}),
    })
  );
}
