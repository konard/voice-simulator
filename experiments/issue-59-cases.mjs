// The cases of tests/recognition-pitch.test.js beyond the clean set: a
// missing fundamental, white noise alone, a stream against a batch and
// jitter and shimmer of a sustained aː.
// Run: node experiments/issue-59-cases.mjs
import { synthesize } from '../src/synthesize.js';
import { presetHeadConfig } from '../src/head-config.js';
import { planUtterance } from '../src/articulation/plan.js';
import { renderPlan } from '../src/acoustics/voice.js';
import {
  analyzeFrames,
  createFrameAnalyzer,
} from '../src/recognition/frontend.js';
import {
  createPitchTracker,
  jitterToHead,
  trackPitch,
} from '../src/recognition/pitch.js';
import { f0Errors } from '../src/metrics/pitch.js';
import { createRandom, randomNormal } from '../src/random.js';
import {
  highPass,
  maskedPair,
  plannedPitch,
} from '../tests/helpers/recognition-truth.js';

const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const round = (value) => +value.toFixed(4);

// Missing fundamental: male at 8000 Hz high-passed at 300 Hz by a
// Butterworth filter of order 4 (the test) and 8.
{
  const out = synthesize(TEXT, {
    head: presetHeadConfig('male'),
    solver: 'waveguide',
    sampleRate: 8000,
    seed: 1,
  });
  for (const order of [4, 8]) {
    const filtered = highPass(out.samples, 8000, 300, order);
    const frames = analyzeFrames(filtered, 8000);
    const track = trackPitch(frames);
    const truth = plannedPitch(out.plan, frames.hop, track.count);
    const errors = f0Errors(...maskedPair(truth.f0, track.f0, truth.mask));
    console.log(
      `missing fundamental, order ${order}`,
      JSON.stringify({
        gpe: round(errors.gpe),
        vde: round(errors.vde),
        ffe: round(errors.ffe),
      })
    );
  }
}

// White noise alone, 2 s, at both rates.
for (const rate of [16000, 8000]) {
  const random = createRandom('pitch:noise');
  const noise = Float32Array.from(
    { length: 2 * rate },
    () => 0.1 * randomNormal(random)
  );
  const track = trackPitch(analyzeFrames(noise, rate));
  let voiced = 0;
  for (let t = 0; t < track.count; t++) {
    voiced += track.f0[t] > 0 ? 1 : 0;
  }
  console.log(
    `noise only @${rate}`,
    JSON.stringify({ frames: track.count, voiced })
  );
}

// Stream against batch: chunks of 1, 7, 160 and 1024 samples.
for (const preset of ['male', 'female', 'child']) {
  for (const rate of [16000, 8000]) {
    const out = synthesize(TEXT, {
      head: presetHeadConfig(preset),
      solver: 'waveguide',
      sampleRate: rate,
      seed: 1,
    });
    const batch = trackPitch(analyzeFrames(out.samples, rate));
    const analyzer = createFrameAnalyzer(rate);
    const tracker = createPitchTracker(analyzer.frames);
    const sizes = [1, 7, 160, 1024];
    let committedBefore = 0;
    let rewritten = 0;
    const seen = new Float32Array(analyzer.frames.capacity);
    for (let start = 0, k = 0; start < out.samples.length; k++) {
      const end = Math.min(out.samples.length, start + sizes[k % sizes.length]);
      analyzer.push(out.samples.subarray(start, end));
      tracker.advance();
      for (let t = 0; t < committedBefore; t++) {
        if (tracker.track.f0[t] !== seen[t]) {
          rewritten++;
        }
      }
      seen.set(tracker.track.f0.subarray(0, tracker.track.committed));
      committedBefore = tracker.track.committed;
      start = end;
    }
    analyzer.flush();
    tracker.advance(true);
    const stream = tracker.track;
    let differ = 0;
    for (let t = 0; t < batch.count; t++) {
      const a = batch.f0[t];
      const b = stream.f0[t];
      if (a > 0 !== b > 0 || (a > 0 && Math.abs(b / a - 1) > 0.01)) {
        differ++;
      }
    }
    console.log(
      `stream ${preset}@${rate}`,
      JSON.stringify({
        frames: batch.count,
        streamFrames: stream.count,
        differ,
        share: round(differ / batch.count),
        rewritten,
      })
    );
  }
}

// Jitter and shimmer of a 2 s aː (male, 16000 Hz).
for (const [jitter, shimmer] of [
  [0.2, 1],
  [1, 4],
  [2, 8],
]) {
  const head = { ...presetHeadConfig('male'), jitter, shimmer };
  const plan = planUtterance('aː', { head, durations: [2] });
  const samples = renderPlan(plan, {
    head,
    solver: 'waveguide',
    sampleRate: 16000,
    seed: 1,
    engine: 'js',
  });
  const track = trackPitch(analyzeFrames(samples, 16000));
  console.log(
    `aː jitter ${jitter} shimmer ${shimmer}`,
    JSON.stringify({
      seconds: round(samples.length / 16000),
      marks: track.marks.length,
      jitter: round(track.jitter),
      shimmer: round(track.shimmer),
      jitterHead: round(jitterToHead(track.jitter)),
      shimmerHead: round(jitterToHead(track.shimmer)),
    })
  );
}
