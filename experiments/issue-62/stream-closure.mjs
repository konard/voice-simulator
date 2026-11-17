/** Public-API counterexample to simultaneous 60 ms immutable commitment
 * and retrospective closure cleanup. Finite input: two one-second signals.
 * Run: node --max-old-space-size=64 experiments/issue-62/stream-closure.mjs
 * Passing assertions prove the incompatibility, not detector acceptance. */
import assert from 'node:assert/strict';
import {
  analyzeFrames,
  createFrameAnalyzer,
  createLandmarkDetector,
  findLandmarks,
} from '../../src/index.js';

const rate = 8000;
const hop = 0.005;
const frameTime = 0.36;
const commitmentDeadline = frameTime + 0.06;
// Supply the front end's 12.5 ms window lookahead, too. The two signals
// still agree through this later point, before either return to speech.
const suppliedThrough = commitmentDeadline + 0.0125;
const prefixSamples = Math.round(suppliedThrough * rate);
const target = Math.round(frameTime / hop);
const speechReturns = [0.44, 0.6];
const signals = speechReturns.map((resume) => {
  const samples = new Float32Array(rate);
  for (let n = 0; n < samples.length; n++) {
    const time = n / rate;
    if (
      (time >= 0.1 && time < 0.3) ||
      (time >= resume && time < resume + 0.2)
    ) {
      samples[n] = 0.1 * Math.sin((2 * Math.PI * 140 * n) / rate);
    }
  }
  return samples;
});
assert.deepEqual(
  signals[0].subarray(0, prefixSamples),
  signals[1].subarray(0, prefixSamples)
);
const required = signals.map((samples) =>
  findLandmarks(analyzeFrames(samples, rate)).classes.at(target)
);
assert.deepEqual(required, [6, 0]);
const streams = signals.map((samples) => {
  const analyzer = createFrameAnalyzer(rate, { maxSeconds: 1 });
  const detector = createLandmarkDetector(analyzer.frames);
  analyzer.push(samples.subarray(0, prefixSamples));
  detector.advance();
  assert(detector.output.committed > target);
  return { analyzer, detector, samples };
});
for (const [key, width] of [
  ['energy', 1],
  ['noise', 1],
  ['periodicity', 1],
  ['speech', 1],
  ['zcr', 1],
  ['gravity', 1],
  ['tilt', 1],
  ['band', 6],
  ['mel', streams[0].analyzer.frames.melBands],
]) {
  const a = streams[0].analyzer.frames;
  const b = streams[1].analyzer.frames;
  assert.equal(a.count, b.count);
  assert.deepEqual(
    a[key].subarray(0, a.count * width),
    b[key].subarray(0, b.count * width)
  );
}
const atDeadline = streams.map((s) => s.detector.output.classes.at(target));
assert.equal(atDeadline[0], atDeadline[1]);
for (const { analyzer, detector, samples } of streams) {
  analyzer.push(samples.subarray(prefixSamples));
  analyzer.flush();
  detector.advance(true);
}
const final = streams.map((s) => s.detector.output.classes.at(target));
assert.deepEqual(final, atDeadline);
assert.notDeepEqual(final, required);
console.log(
  JSON.stringify({
    frameTime,
    commitmentDeadline,
    suppliedThrough,
    speechReturns,
    requiredBatchClasses: required,
    committedStreamClasses: atDeadline,
    finalStreamClasses: final,
  })
);
