/** Isolate synthetic copy controls using the source plan's phone times. Unlicense. */
import {
  compareRecordings,
  presetHeadConfig,
  renderScore,
  saveVoice,
  synthesize,
  toScore,
} from '../src/index.js';
import { applyPitch, matchLoudness } from '../src/session/copy-prosody.js';
import { planRecording } from '../src/session/score.js';
import { groupPhones, warpPlan } from '../src/session/warp.js';

const options = { tier: 'minimal', sampleRate: 16000, seed: 1, engine: 'js' };
const original = synthesize('Hello world.', {
  ...options,
  head: presetHeadConfig('female'),
});
const voice = saveVoice(original.head);
const phones = groupPhones(original.plan.segments).map(
  ({ token, start, end }) => ({ ipa: token.symbol, start, end })
);
const plan = warpPlan(
  planRecording(original.ipa, original.lang, voice, []),
  phones,
  {
    duration: original.duration,
  }
);
applyPitch(plan, original.samples, original.sampleRate, []);
matchLoudness(plan, original.samples, original.sampleRate, options.seed);
const score = toScore(
  plan,
  { words: [], languages: [{ language: original.lang }], modes: [] },
  voice
);
const copy = renderScore(score, options);
const { f0, lsd, mcd } = compareRecordings(original, copy);
console.log(JSON.stringify({ f0, lsd, mcd }, null, 2));
