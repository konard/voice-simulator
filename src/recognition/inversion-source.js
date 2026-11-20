/** Pitch, level and noise controls for acoustic inversion. Unlicense. */
import { CHANNELS, interpolateGaps } from '../articulation/plan.js';
import { SOURCE_CHANNEL_MAPS } from './source-channel-maps.js';

export const NOISE_CHANNELS = ['aspiration', 'frication', 'sibilance'];
export const SOURCE_CHANNELS = [
  'f0',
  'voicing',
  'loudness',
  ...NOISE_CHANNELS,
  'trill',
  'glottalClosure',
  'lateral',
];

export function sourceFeatures(frames, t, reference) {
  return [
    1,
    frames.energy[t] - reference,
    frames.gravity[t] / 1000,
    frames.zcr[t],
    frames.whisper?.[t] ? 0 : frames.periodicity[t],
    frames.tilt[t],
  ];
}

/** Exact running nearest-rank percentile of voiced frame energy. */
export function energyReference(capacity) {
  const sorted = new Float32Array(capacity);
  let count = 0;
  return (energy, voiced) => {
    if (voiced) {
      let a = 0;
      let b = count;
      while (a < b) {
        const middle = (a + b) >>> 1;
        if (sorted[middle] > energy) {
          b = middle;
        } else {
          a = middle + 1;
        }
      }
      sorted.copyWithin(a + 1, a, count++);
      sorted[a] = energy;
    }
    return count ? sorted[Math.ceil(0.9 * count) - 1] : energy;
  };
}

function noiseMap(rate) {
  const rates = Object.keys(SOURCE_CHANNEL_MAPS).map(Number);
  const nearest = rates.reduce((a, b) =>
    Math.abs(a - rate) <= Math.abs(b - rate) ? a : b
  );
  return NOISE_CHANNELS.map((name) => SOURCE_CHANNEL_MAPS[nearest][name]);
}

function estimateNoise(frames, t, reference, channels, map) {
  const features = sourceFeatures(frames, t, reference);
  NOISE_CHANNELS.forEach((name, i) => {
    const value = features.reduce((total, x, k) => total + x * map[i][k], 0);
    channels[name][t] = Math.max(0, Math.min(1, value));
  });
}

/** Two complete peak or trough cycles, with 6 dB excursions between extrema. */
function createTrillDetector(frames) {
  const { energy, hop } = frames;
  const detected = new Uint8Array(frames.capacity);
  const extrema = [];
  let scanned = 1;
  let plateauStart = 0;
  let direction = 0;

  return {
    detected,
    advance(end) {
      while (scanned < end) {
        const t = scanned++;
        const change = Math.sign(energy[t] - energy[t - 1]);
        if (change === 0) {
          continue;
        }
        const reversed = change === -direction;
        const middle = Math.floor((plateauStart + t - 1) / 2);
        direction = change;
        plateauStart = t;
        if (!reversed) {
          continue;
        }
        extrema.push(middle);
        if (extrema.length < 5) {
          continue;
        }
        const [a, b, c, d, e] = extrema;
        const first = (c - a) * hop;
        const second = (e - c) * hop;
        if (
          first >= 1 / 40 &&
          first <= 1 / 18 &&
          second >= 1 / 40 &&
          second <= 1 / 18 &&
          Math.abs(energy[a] - energy[b]) >= 6 &&
          Math.abs(energy[b] - energy[c]) >= 6 &&
          Math.abs(energy[c] - energy[d]) >= 6 &&
          Math.abs(energy[d] - energy[e]) >= 6
        ) {
          detected.fill(1, a, e + 1);
        }
        extrema.shift();
      }
    },
  };
}

function createPitchFill(pitch, whisper, channel, fallback) {
  let before = -1;
  return (first, last, end) => {
    let after = first;
    for (let t = first; t < last; t++) {
      if (!whisper?.[t] && pitch.f0[t] > 0) {
        before = t;
        channel[t] = pitch.f0[t];
        continue;
      }
      after = Math.max(t + 1, after);
      while (after < end && (whisper?.[after] || !(pitch.f0[after] > 0))) {
        after++;
      }
      const a = before >= 0 ? pitch.f0[before] : 0;
      const b = after < end ? pitch.f0[after] : 0;
      channel[t] =
        a && b
          ? a + ((b - a) * (t - before)) / (after - before)
          : a || b || fallback;
    }
  };
}

export function createSourceEstimator(frames, pitch, track, batch) {
  const { channels, variance } = track;
  const reference = energyReference(frames.capacity);
  const whisperReference = frames.whisper && energyReference(frames.capacity);
  const map = noiseMap(frames.rate);
  const level = new Float64Array(frames.capacity + 1);
  const forward = new Float64Array(frames.capacity);
  const alpha = -Math.expm1(-frames.hop / CHANNELS.voicing);
  const window = Math.max(1, Math.round(0.05 / frames.hop));
  const left = Math.floor(window / 2);
  const trill = createTrillDetector(frames);
  const fillPitch = createPitchFill(
    pitch,
    frames.whisper,
    channels.f0,
    track.head.pitch
  );
  let read = 0;

  function observe(end) {
    while (read < end) {
      const t = read++;
      const whisper = frames.whisper?.[t];
      const voiced = Number(!whisper && pitch.f0[t] > 0);
      const ref = whisper
        ? whisperReference(frames.energy[t], frames.speech[t])
        : reference(frames.energy[t], voiced);
      if (batch) {
        channels.f0[t] = voiced ? pitch.f0[t] : NaN;
      }
      forward[t] = t
        ? forward[t - 1] + alpha * (voiced - forward[t - 1])
        : voiced;
      const gain = Math.min(1.5, 10 ** ((frames.energy[t] - ref) / 20));
      level[t + 1] = level[t] + (frames.speech[t] ? gain : 0);
      if (frames.speech[t]) {
        estimateNoise(frames, t, ref, channels, map);
      }
    }
    trill.advance(end);
  }

  return (first, last, end) => {
    observe(end);
    if (batch) {
      interpolateGaps(channels.f0.subarray(0, end), track.head.pitch);
    } else {
      // Values beyond the commitment boundary come from the immutable pitch track.
      fillPitch(first, last, end);
    }
    if (frames.whisper) {
      channels.whisper.set(frames.whisper.subarray(first, last), first);
    }
    let voiced = forward[end - 1];
    for (let t = end - 1; t >= first; t--) {
      voiced += alpha * (forward[t] - voiced);
      if (t < last) {
        channels.voicing[t] = frames.whisper?.[t] ? 1 : voiced;
      }
    }
    for (let t = first; t < last; t++) {
      const a = Math.max(0, t - left);
      const b = Math.min(end, t + window - left);
      channels.loudness[t] = frames.speech[t]
        ? (level[b] - level[a]) / (b - a)
        : 0;
      channels.trill[t] = trill.detected[t];
      variance.glottalClosure[t] = Infinity;
      variance.lateral[t] = Infinity;
    }
  };
}
