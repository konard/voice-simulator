// Unlicense. Issue 63: measured 5th-95th percentile f0 range (semitones, stage
// A) of renders versus the range of the synthesizer's planned f0 over voiced
// frames, by text, pitchRange and pitch.
import { synthesize, fitVoice, DEFAULT_HEAD } from '../../src/index.js';
import { prepareUtterance } from '../../src/synthesize.js';
import { MATCH_TEXT } from '../../src/analysis/voice-fit-calibration.js';
const TEXTS = [
  MATCH_TEXT,
  'The north wind and the sun.',
  'The north wind and the sun were disputing which was the stronger.',
];
const pct = (s, q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
export function plannedRange(text, head) {
  const { plan } = prepareUtterance(text, { head, seed: 1 });
  const f0 = plan.channels.f0,
    voicing = plan.channels.voicing,
    st = [];
  for (let i = 0; i < plan.frameCount; i++) {
    if (voicing[i] > 0.5 && f0[i] > 0) {
      st.push(12 * Math.log2(f0[i]));
    }
  }
  st.sort((a, b) => a - b);
  return pct(st, 0.95) - pct(st, 0.05);
}
const rows = [];
for (const [t, text] of TEXTS.entries()) {
  for (const pitch of [100, 210]) {
    for (const pitchRange of [2, 3, 4.5]) {
      const head = { ...DEFAULT_HEAD, pitch, pitchRange };
      const { samples, sampleRate } = synthesize(text, {
        head,
        seed: 1,
        sampleRate: 16000,
        solver: 'waveguide',
        engine: 'js',
      });
      const measured = fitVoice(samples, sampleRate, { refine: false }).features
        .f0Range;
      const planned = plannedRange(text, head);
      rows.push({
        t,
        pitch,
        pitchRange,
        planned,
        measured,
        ratio: measured / planned,
      });
      console.log(JSON.stringify(rows.at(-1)));
    }
  }
}
