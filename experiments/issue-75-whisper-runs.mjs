/**
 * Why is a whispered sentence heard as several W spans? Prints each speech
 * run of the whisper detector (src/recognition/whisper.js) with its voiced
 * share and voice-edge pieces, on the front end of the word recogniser.
 * node experiments/issue-75-whisper-runs.mjs [tier] [lang] [sentence]
 * Unlicense.
 */
import { synthesize } from '../src/index.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import {
  findWhisper,
  whisperSpeechRuns,
  whisperVoiceEdges,
} from '../src/recognition/whisper.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tier = 'wideband', lang = 'ru', index = '1'] = process.argv.slice(2);
const spoken = synthesize(`[whisper]${sentences[lang][index - 1]}[/whisper]`, {
  lang,
  tier,
  head: 'random',
  preset: 'male',
  seed: 1,
  markup: true,
});
// The front end of the word recogniser (src/recognition/hmm-stage.js).
const frames = analyzeFrames(spoken.samples, spoken.sampleRate, { hop: 0.01 });
const pitch = trackPitch(frames);
const f = (v) => v.toFixed(2);
console.log('rate', spoken.sampleRate, 'hop', frames.hop);
for (const run of whisperSpeechRuns(
  frames,
  Math.min(frames.count, pitch.count ?? frames.count)
)) {
  let voiced = 0;
  const voicedAt = [];
  for (let i = run.from; i < run.to; i++) {
    if (pitch.f0[i] > 0) {
      voiced++;
      voicedAt.push(f(frames.startTime + i * frames.hop));
    }
  }
  console.log(
    `run ${f(run.start)}-${f(run.end)} voiced ${(voiced / (run.to - run.from)).toFixed(3)} at ${voicedAt.join(',')}`
  );
  console.log(
    '  edges',
    whisperVoiceEdges(run, frames, pitch)
      .map((e) => `${e.edge}:${f(e.start)}-${f(e.end)}`)
      .join(' ')
  );
}
console.log(
  'spans',
  findWhisper(spoken.samples, spoken.sampleRate, frames, pitch)
    .map((s) => `${f(s.start)}-${f(s.end)}`)
    .join(' ')
);
