// Click check for the moving source plane (issue 40): a 0.3 s glide from
// [æ] to [u] rendered by the waveguide and the 3D solver; the largest step
// between two output samples over the RMS, during the glide.
// Usage: node experiments/issue-40-glide-click.mjs [dx]
import { buildVoxelModel } from '../src/acoustics/voxel-model.js';
import { renderPlan } from '../src/acoustics/voice.js';
import { rms } from '../src/acoustics/analysis.js';
import { planUtterance } from '../src/articulation/plan.js';
import { DEFAULT_HEAD } from '../src/head-config.js';

const dx = Number(process.argv[2] ?? 1);
const RATE = 16000;

/** Channels in the middle of the vowel of `ipa`. */
function vowelFrame(ipa) {
  const plan = planUtterance(ipa);
  const segment = plan.segments.find((entry) => entry.kind === 'vowel');
  const frame = Math.round(
    ((segment.start + segment.end) / 2) * plan.frameRate
  );
  return { plan, frame };
}

/** A plan holding [æ] 0.15 s, gliding to [u] in 0.3 s, holding 0.15 s. */
export function glidePlan(from = 'ˈæ', to = 'ˈu', glide = 0.3, hold = 0.15) {
  const a = vowelFrame(from);
  const b = vowelFrame(to);
  const { frameRate } = a.plan;
  const frameCount = Math.round((glide + 2 * hold) * frameRate);
  const channels = {};
  for (const [name, values] of Object.entries(a.plan.channels)) {
    const start = values[a.frame];
    const end = b.plan.channels[name][b.frame];
    channels[name] = Float64Array.from({ length: frameCount }, (_, frame) => {
      const t = Math.min(1, Math.max(0, (frame / frameRate - hold) / glide));
      return start + (end - start) * t;
    });
  }
  const duration = frameCount / frameRate;
  return {
    ...a.plan,
    segments: [
      {
        ...a.plan.segments.find((s) => s.kind === 'vowel'),
        start: 0,
        end: duration,
      },
    ],
    frameCount,
    duration,
    channels,
  };
}

function click(samples, from, to) {
  let largest = 0;
  for (let n = from + 1; n < to; n++) {
    largest = Math.max(largest, Math.abs(samples[n] - samples[n - 1]));
  }
  return largest / rms(samples, from, to);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const plan = glidePlan();
  const [from, to] = [0.15, 0.45].map((t) => Math.round(t * RATE));
  const wave = renderPlan(plan, { sampleRate: RATE });
  const model = buildVoxelModel(DEFAULT_HEAD, { dx });
  const t0 = Date.now();
  const voxel = renderPlan(plan, { sampleRate: RATE, solver: 'fdtd3d', model });
  console.log('3D ms', Date.now() - t0);
  const w = click(wave, from, to);
  const v = click(voxel, from, to);
  console.log({
    waveguide: w.toFixed(3),
    fdtd3d: v.toFixed(3),
    ratio: (v / w).toFixed(3),
  });
}
