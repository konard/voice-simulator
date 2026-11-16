// Frame-by-frame trace of trackPitch against the plan.
// Run: node experiments/issue-59-trace.mjs female 16000 95 120
import { synthesize } from '../src/synthesize.js';
import { presetHeadConfig } from '../src/head-config.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import { sampleState } from '../src/articulation/tract-shape.js';

const TEXT = 'The north wind and the sun were disputing which was the stronger.';
const [preset, rateText, from, to] = process.argv.slice(2);
const out = synthesize(TEXT, {
  head: presetHeadConfig(preset),
  solver: 'waveguide',
  sampleRate: Number(rateText),
  seed: 1,
});
const frames = analyzeFrames(out.samples, out.sampleRate);
const track = trackPitch(frames);
const s = {};
for (let t = Number(from); t <= Number(to); t++) {
  sampleState(out.plan, t * frames.hop, s);
  console.log(
    t,
    `v=${s.voicing.toFixed(2)} l=${s.loudness.toFixed(2)} cl=${(s.closure ?? 0).toFixed(2)} asp=${(s.aspiration ?? 0).toFixed(2)} f0=${s.f0.toFixed(0)}`,
    `| est=${track.f0[t].toFixed(0)} vo=${track.voicing[t].toFixed(2)} h=${track.strength[t].toFixed(2)}`,
    `| E=${frames.energy[t].toFixed(1)} N=${frames.noise[t].toFixed(1)} P=${frames.periodicity[t].toFixed(2)} sp=${frames.speech[t]}`
  );
}
