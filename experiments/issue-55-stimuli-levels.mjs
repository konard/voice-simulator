// Levels of the emotion stimuli of the listening test (issue 55): RMS in
// dBFS, peak and length of every WAV built by
//   node scripts/listening-test.mjs build \
//     --sentences examples/listening-test/emotions.sentences.json --out /tmp/lt55
//   node experiments/issue-55-stimuli-levels.mjs /tmp/lt55 en-1,ru-1,hi-1,zh-2
import fs from 'node:fs';
import path from 'node:path';
import { decodeWav, levelDb } from '../src/index.js';

const out = path.resolve(process.argv[2] ?? '/tmp/lt55');
const sentences = (process.argv[3] ?? 'en-1,ru-1,hi-1,zh-2').split(',');
const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'afraid', 'bored'];
for (const sentence of sentences) {
  const id = `emotion-${sentence}`;
  for (const emotion of EMOTIONS) {
    const file = path.join(out, 'stimuli', id, `${emotion}.wav`);
    const { samples, sampleRate } = decodeWav(fs.readFileSync(file));
    let peak = 0;
    for (const value of samples) {
      peak = Math.max(peak, Math.abs(value));
    }
    console.log(
      id,
      emotion,
      levelDb(samples, 0, samples.length).toFixed(1),
      'dBFS peak',
      peak.toFixed(2),
      `${(samples.length / sampleRate).toFixed(2)}s`
    );
  }
}
