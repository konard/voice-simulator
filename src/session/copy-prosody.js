/** Measured pitch and level on a synthesis plan's control grid. Unlicense. */
import { pitchBeforePhonation } from '../acoustics/glottis.js';
import { interpolateGaps, smoothChannel } from '../articulation/plan.js';
import { renderPlan, visitRenderedPlan } from '../acoustics/voice.js';
import { analyzePitchFrames } from '../recognition/frontend.js';
import { trackPitchFrames } from '../recognition/pitch.js';
import { sampleTrack } from './warp.js';

export const DRAFT_RATE = 16000;

function voicedMedian(values, from, to, voiced) {
  let count = 0;
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    if (values[i] > 0) {
      voiced[count++] = values[i];
    }
  }
  if (!count) {
    return NaN;
  }
  voiced.subarray(0, count).sort();
  return (
    (voiced[Math.floor(count / 2)] + voiced[Math.floor((count - 1) / 2)]) / 2
  );
}

export function repairOctaves(values, frameRate) {
  const radius = Math.round(0.1 * frameRate);
  const voiced = new Float64Array(
    Math.min(values.length, Math.max(0, 2 * radius + 1))
  );
  return Float32Array.from(values, (value, i) => {
    if (!(value > 0)) {
      return NaN;
    }
    const median = voicedMedian(values, i - radius, i + radius, voiced);
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
  const voiced = new Float64Array(5);
  const filtered = Float32Array.from(repaired, (value, i) =>
    Number.isNaN(value) ? value : voicedMedian(repaired, i - 2, i + 2, voiced)
  );
  interpolateGaps(filtered, fallback);
  return smoothChannel(filtered, 0.01, frameRate);
}

export function applyPitch(plan, samples, sampleRate, modes, matchVoicing) {
  const { frameRate, frameCount, channels } = plan;
  const track = trackPitchFrames(analyzePitchFrames(samples, sampleRate));
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
      channels.f0[i] = pitchBeforePhonation(
        filtered[i],
        channels.creak[i],
        channels.falsetto[i]
      );
    }
  }
  if (matchVoicing) {
    const gain = smoothChannel(
      Float32Array.from(measured, (hz) => Number(hz > 0)),
      0.005,
      frameRate
    );
    for (let i = 0; i < frameCount; i++) {
      channels.voicing[i] *= gain[i];
    }
    return { rate: frameRate, values: Array.from(gain) };
  }
}

function createRmsTrack(rate, frameCount, frameRate) {
  const radius = rate * 0.0125;
  const values = new Float64Array(frameCount);
  let offset = 0;
  let pending = 0;
  function append(samples) {
    const through = offset + samples.length;
    for (let i = pending; i < frameCount; i++) {
      const center = (i * rate) / frameRate;
      const start = Math.max(offset, Math.round(center - radius));
      if (start >= through) {
        break;
      }
      const end = Math.round(center + radius);
      const available = Math.min(through, end);
      let sum = values[i];
      for (let j = start; j < available; j++) {
        sum += samples[j - offset] ** 2;
      }
      values[i] = sum;
      if (end <= through) {
        pending = i + 1;
      }
    }
    offset = through;
  }
  function finish() {
    let loudest = -Infinity;
    for (let i = 0; i < frameCount; i++) {
      const center = (i * rate) / frameRate;
      const start = Math.max(0, Math.round(center - radius));
      const end = Math.min(offset, Math.round(center + radius));
      const sum = values[i];
      const level = sum > 0 ? 10 * Math.log10(sum / (end - start)) : -Infinity;
      values[i] = level;
      loudest = Math.max(loudest, level);
    }
    return { values, threshold: loudest - 40 };
  }
  return { append, finish };
}

export function rmsTrack(samples, rate, frameCount, frameRate) {
  const track = createRmsTrack(rate, frameCount, frameRate);
  track.append(samples);
  return track.finish();
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

function draftSettings(seed) {
  return { solver: 'waveguide', sections: 22, sampleRate: DRAFT_RATE, seed };
}

export function renderDraft(plan, seed) {
  return renderPlan(plan, draftSettings(seed));
}

export function renderedRmsTrack(plan, settings) {
  const track = createRmsTrack(
    settings.sampleRate,
    plan.frameCount,
    plan.frameRate
  );
  visitRenderedPlan(plan, settings, track.append);
  return track.finish();
}

export function matchLoudness(plan, samples, sampleRate, seed, settings) {
  const { channels, frameCount, frameRate } = plan;
  const reference = rmsTrack(samples, sampleRate, frameCount, frameRate);
  // The telephone renderer limits the bandwidth and uses a shorter
  // waveguide. Calibrate against that renderer, including its filter.
  const render =
    settings?.name === 'telephone' ? settings : draftSettings(seed);
  for (let pass = 0; pass < 2; pass++) {
    const draft = renderedRmsTrack(plan, render);
    matchLevels(channels.loudness, reference, draft);
  }
}
