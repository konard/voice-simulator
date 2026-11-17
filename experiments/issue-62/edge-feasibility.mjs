/** Necessary condition for the requested apa g- edge, independent of the
 * detector and its thresholds: its time must be a falling fine-band peak.
 * Bound the input to one seeded render and inspect every such peak, even
 * without coarse peaks, voicing, strength or suppression requirements.
 * Run: node --max-old-space-size=128 experiments/issue-62/edge-feasibility.mjs
 */
import assert from 'node:assert/strict';
import {
  synthesize,
  presetHeadConfig,
  analyzeFrames,
} from '../../src/index.js';

const rate = 16000;
const out = synthesize('apa', {
  ipa: true,
  head: presetHeadConfig('male'),
  solver: 'waveguide',
  engine: 'js',
  sampleRate: rate,
  seed: 1,
});
const frames = analyzeFrames(out.samples, rate);
const target = out.plan.segments.find((s) => s.kind === 'consonant').start;
const tolerance = 0.02;

// Linear interpolation also checks the literal 13 ms difference rather
// than relying solely on the implementation's nearest-frame rounding.
function band(index) {
  const at = Math.max(0, Math.min(frames.count - 1, index));
  const left = Math.floor(at);
  const weight = at - left;
  return (
    frames.band[left * 6] * (1 - weight) +
    frames.band[Math.min(left + 1, frames.count - 1) * 6] * weight
  );
}

function inspect(label, distance, continuous = false) {
  const points = [0, frames.count - 1];
  if (continuous) {
    // Include the acceptance interval and its centre so a flat positive
    // plateau intersecting it is allowed even when its ends lie outside.
    points.push(
      (target - tolerance) / frames.hop,
      target / frames.hop,
      (target + tolerance) / frames.hop
    );
  }
  for (let t = 0; t < frames.count; t++) {
    if (continuous) {
      // All slope changes of band(t+d)-band(t-d). Between these points
      // the difference is linear, so no strict peak can be omitted.
      for (const at of [t - distance, t + distance]) {
        if (at >= 0 && at < frames.count - 1) {
          points.push(at);
        }
      }
    } else {
      points.push(t);
    }
  }
  const grid = [...new Set(points)].sort((a, b) => a - b);
  const falls = grid.map((t) => band(t - distance) - band(t + distance));
  const peaks = grid
    .filter(
      (_, i) =>
        i > 0 &&
        i + 1 < grid.length &&
        falls[i] > 0 &&
        falls[i] >= falls[i - 1] &&
        falls[i] >= falls[i + 1]
    )
    .map((t) => ({
      time: t * frames.hop,
      error: Math.abs(t * frames.hop - target),
    }));
  const reachable = peaks.filter((p) => p.error <= tolerance + 1e-9);
  const nearest = peaks.sort((a, b) => a.error - b.error)[0];
  assert(nearest, 'the render must have a falling band-0 peak');
  assert.deepEqual(reachable, [], `${label}: unexpectedly feasible edge`);
  console.log(
    JSON.stringify({
      label,
      target,
      tolerance,
      nearest,
      reachable: reachable.length,
    })
  );
}

inspect('fine rounded to 15 ms', Math.round(0.013 / frames.hop));
inspect('fine rounded down to 10 ms', Math.floor(0.013 / frames.hop));
inspect('fine interpolated at 13 ms, frame grid', 0.013 / frames.hop);
inspect(
  'fine interpolated at 13 ms, continuous time',
  0.013 / frames.hop,
  true
);
