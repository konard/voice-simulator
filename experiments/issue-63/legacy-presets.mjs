// Unlicense. Trace the three legacy matchVoice preset cases (issue 63):
// stage A head versus truth and the best head after each render.
import { synthesize, fitVoice } from '../../src/index.js';
import { presetHeadConfig } from '../../src/head-config.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const KEYS = [
  'vocalTractLength',
  'pitch',
  'pitchRange',
  'tenseness',
  'speechRate',
  'breathiness',
];
const pick = (h) => Object.fromEntries(KEYS.map((k) => [k, +h[k].toFixed(3)]));
const only = process.argv[2];
for (const [preset, size] of [
  ['female', undefined],
  ['male', undefined],
  ['female', 0.2],
]) {
  if (only && only !== `${preset}${size ?? ''}`) {
    continue;
  }
  const target = presetHeadConfig(preset, size);
  const { samples, sampleRate } = synthesize(TEXT, {
    head: target,
    solver: 'waveguide',
    sampleRate: 22050,
  });
  const stage = fitVoice(samples, sampleRate, {
    refine: false,
    transcript: TEXT,
  });
  console.log(preset, size, 'truth', JSON.stringify(pick(target)));
  console.log('  stageA', JSON.stringify(pick(stage.head)));
  let best = Infinity;
  const result = fitVoice(samples, sampleRate, {
    transcript: TEXT,
    maxRenders: 40,
    trace: (e) => {
      if (e.stage !== 'voice-fit-render') {
        return;
      }
      const mark = e.cost < best ? '*' : ' ';
      best = Math.min(best, e.cost);
      console.log(
        `  ${mark}${e.renders} cost ${e.cost.toFixed(3)} mcd ${e.mcd?.toFixed(2)} pen ${e.penalty.toFixed(3)}`,
        JSON.stringify(pick(e.head))
      );
    },
  });
  console.log('  final', JSON.stringify(pick(result.head)));
}
