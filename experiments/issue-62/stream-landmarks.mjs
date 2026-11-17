/** Compare batch and streaming landmark lists on bounded synthetic speech. */
import {
  analyzeFrames,
  createFrameAnalyzer,
  createLandmarkDetector,
  findLandmarks,
  synthesize,
} from '../../src/index.js';

const rate = 16000;
const { samples } = synthesize('apa asa ama aba', {
  ipa: true,
  solver: 'waveguide',
  engine: 'js',
  sampleRate: rate,
  seed: 1,
});
const batch = findLandmarks(analyzeFrames(samples, rate));
for (const seconds of [0.005, 0.01, 0.02, 0.04]) {
  const analyzer = createFrameAnalyzer(rate, {
    maxSeconds: samples.length / rate,
  });
  const detector = createLandmarkDetector(analyzer.frames);
  const step = Math.round(rate * seconds);
  for (let i = 0; i < samples.length; i += step) {
    analyzer.push(samples.subarray(i, i + step));
    detector.advance();
  }
  analyzer.flush();
  detector.advance(true);
  console.log(
    JSON.stringify({
      chunkSeconds: seconds,
      batchCount: batch.landmarks.length,
      streamCount: detector.output.landmarks.length,
      missing: batch.landmarks.filter(
        (l) =>
          !detector.output.landmarks.some(
            (other) =>
              l.time === other.time &&
              l.type === other.type &&
              l.strength === other.strength
          )
      ),
      extra: detector.output.landmarks.filter(
        (l) =>
          !batch.landmarks.some(
            (other) =>
              l.time === other.time &&
              l.type === other.type &&
              l.strength === other.strength
          )
      ),
    })
  );
}
