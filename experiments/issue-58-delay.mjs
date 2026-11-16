// Added delay of the front end (issue 58): push one input sample at a time
// and note, for every frame, how much input past the frame centre had to
// arrive before the frame was added. Usage: node experiments/issue-58-delay.mjs
import { createFrameAnalyzer } from '../src/index.js';

for (const sampleRate of [8000, 11025, 16000, 44100, 48000]) {
  const analyzer = createFrameAnalyzer(sampleRate, { maxSeconds: 1 });
  const { frames } = analyzer;
  const one = new Float32Array(1);
  let worst = 0;
  for (let n = 1; n <= sampleRate * 0.9; n++) {
    const before = frames.count;
    analyzer.push(one);
    for (let t = before; t < frames.count; t++) {
      worst = Math.max(worst, n / sampleRate - t * frames.hop);
    }
  }
  console.log(
    `input ${sampleRate} Hz (working ${frames.rate} Hz): largest delay ${(worst * 1000).toFixed(2)} ms`
  );
}
