/** Measured pitch and level on a synthesis plan's control grid. Unlicense. */
import { interpolateGaps, smoothChannel } from '../articulation/plan.js';
import { renderPlan } from '../acoustics/voice.js';
import { analyzeFrames } from '../recognition/frontend.js';
import { trackPitch } from '../recognition/pitch.js';
import { sampleTrack } from './warp.js';

export const DRAFT_RATE = 16000;

function voicedMedian(values, from, to) {
  const voiced = [];
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    if (values[i] > 0) {
      voiced.push(values[i]);
    }
  }
  voiced.sort((a, b) => a - b);
  const middle = Math.floor(voiced.length / 2);
  return (voiced[middle] + voiced[Math.floor((voiced.length - 1) / 2)]) / 2;
}

export function repairOctaves(values, frameRate) {
  const radius = Math.round(0.1 * frameRate);
  return Float32Array.from(values, (value, i) => {
    if (!(value > 0)) {
      return NaN;
    }
    const median = voicedMedian(values, i - radius, i + radius);
    const distance = 12 * Math.log2(value / median);
    if (Math.abs(distance) <= 9) {
      return value;
    }
    const octave = Math.sign(distance);
    return Math.abs(distance - 12 * octave) <= 3 ? value * 2 ** -octave : NaN;
  });
}

export function pitchContour(measured, frameRate, fallback) {
  const repaired = repairOctaves(measured, frameRate);
  const filtered = Float32Array.from(repaired, (value, i) =>
    Number.isNaN(value) ? value : voicedMedian(repaired, i - 2, i + 2)
  );
  interpolateGaps(filtered, fallback);
  return smoothChannel(filtered, 0.01, frameRate);
}

export function applyPitch(plan, samples, sampleRate, modes) {
  const { frameRate, frameCount, channels } = plan;
  const track = trackPitch(analyzeFrames(samples, sampleRate));
  const measured = Float32Array.from({ length: frameCount }, (_, i) => {
    const t = i / frameRate;
    if (
      modes.some(
        (span) => t >= span.start && t < span.end && span.phonation?.whisper
      )
    ) {
      return 0;
    }
    const row = (t - track.startTime) / track.hop;
    const left = track.f0[Math.floor(row)];
    const right = track.f0[Math.ceil(row)];
    return left > 0 && right > 0 ? sampleTrack(track.f0, row) : 0;
  });
  const filtered = pitchContour(measured, frameRate, plan.head.pitch);
  for (let i = 0; i < frameCount; i++) {
    const time = i / frameRate;
    if (
      !modes.some(
        (span) =>
          time >= span.start && time < span.end && span.phonation?.whisper
      )
    ) {
      channels.f0[i] = filtered[i];
    }
  }
}

export function rmsTrack(samples, rate, frameCount, frameRate) {
  const radius = rate * 0.0125;
  let loudest = -Infinity;
  const values = Float64Array.from({ length: frameCount }, (_, i) => {
    const center = (i * rate) / frameRate;
    const start = Math.max(0, Math.round(center - radius));
    const end = Math.min(samples.length, Math.round(center + radius));
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += samples[j] ** 2;
    }
    const level = sum > 0 ? 10 * Math.log10(sum / (end - start)) : -Infinity;
    loudest = Math.max(loudest, level);
    return level;
  });
  return { values, threshold: loudest - 40 };
}

export function loudnessGain(reference, draft) {
  return Math.max(0.25, Math.min(4, 10 ** ((0.8 * (reference - draft)) / 20)));
}

export function matchLevels(loudness, reference, draft) {
  for (let i = 0; i < loudness.length; i++) {
    const from = draft.values[i];
    const to = reference.values[i];
    if (from > draft.threshold && to > reference.threshold) {
      loudness[i] *= loudnessGain(to, from);
    }
  }
}

export function renderDraft(plan, seed) {
  return renderPlan(plan, {
    solver: 'waveguide',
    sections: 22,
    sampleRate: DRAFT_RATE,
    seed,
  });
}

export function matchLoudness(plan, samples, sampleRate, seed) {
  const { channels, frameCount, frameRate } = plan;
  const reference = rmsTrack(samples, sampleRate, frameCount, frameRate);
  for (let pass = 0; pass < 2; pass++) {
    const draft = rmsTrack(
      renderDraft(plan, seed),
      DRAFT_RATE,
      frameCount,
      frameRate
    );
    matchLevels(channels.loudness, reference, draft);
  }
}
