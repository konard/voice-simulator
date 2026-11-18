// Unlicense. Issue 63: measured median f0 (stage A histogram) of renders over
// the median of the synthesizer's planned f0 of voiced frames, and over the
// head's pitch, by text, pitch, pitchRange, speechRate and tract length.
import { synthesize, fitVoice, DEFAULT_HEAD } from '../../src/index.js';
import { prepareUtterance } from '../../src/synthesize.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const TEXTS = [
  MATCH_TEXT,
  'The north wind and the sun.',
  'The north wind and the sun were disputing which was the stronger.',
  'A traveller came along wrapped in a warm cloak.',
];
export function plannedMedian(text, head) {
  const { plan } = prepareUtterance(text, { head, seed: 1 });
  const { f0, voicing } = plan.channels,
    values = [];
  for (let i = 0; i < plan.frameCount; i++) {
    if (voicing[i] > 0.5 && f0[i] > 0) {
      values.push(f0[i]);
    }
  }
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
}
const cases = [];
for (const t of TEXTS.keys()) {
  for (const pitch of [100, 150, 210]) {
    for (const pitchRange of [2, 3, 4.5]) {
      cases.push([t, { pitch, pitchRange }]);
    }
  }
  cases.push([t, { pitch: 150, speechRate: 0.8 }]);
  cases.push([t, { pitch: 150, speechRate: 1.25 }]);
  cases.push([t, { pitch: 150, vocalTractLength: 13 }]);
  cases.push([t, { pitch: 150, vocalTractLength: 18.5 }]);
}
const ratios = [];
for (const [t, change] of cases) {
  const head = { ...DEFAULT_HEAD, ...change };
  const { samples, sampleRate } = synthesize(TEXTS[t], {
    head,
    seed: 1,
    sampleRate: 16000,
    solver: 'waveguide',
    engine: 'js',
  });
  const measured = fitVoice(samples, sampleRate, { refine: false }).features.f0;
  const planned = plannedMedian(TEXTS[t], head);
  ratios.push(measured / planned);
  console.log(
    JSON.stringify({
      t,
      ...change,
      planned: +planned.toFixed(2),
      measured: +measured.toFixed(2),
      overPlanned: +(measured / planned).toFixed(4),
      overPitch: +(measured / head.pitch).toFixed(4),
      plannedOverPitch: +(planned / head.pitch).toFixed(4),
    })
  );
}
ratios.sort((a, b) => a - b);
console.log(
  'measured / planned: median',
  ratios[ratios.length >> 1].toFixed(4),
  'min',
  ratios[0].toFixed(4),
  'max',
  ratios.at(-1).toFixed(4)
);
