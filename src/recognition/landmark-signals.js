/** Numerical helpers of the landmark stage (issue 62). No spectra are
 * recomputed: every measurement comes from the shared analysis frames. */

export const BROAD_CLASSES = Object.freeze([
  'silence',
  'vowel',
  'glide',
  'nasal',
  'voiced-fricative',
  'voiceless-fricative',
  'closure',
  'burst',
]);

/** Mel filter centres, in the same order as frontend.js. */
export function sonorityFilters(frames) {
  const bottom = 2595 * Math.log10(1 + 60 / 700);
  const top = 2595 * Math.log10(1 + Math.min(frames.rate / 2, 7600) / 700);
  const selected = [];
  for (let m = 0; m < frames.melBands; m++) {
    const centre =
      700 *
      (10 **
        ((bottom + ((top - bottom) * (m + 1)) / (frames.melBands + 1)) / 2595) -
        1);
    if (centre >= 300 && centre <= (frames.rate === 8000 ? 2800 : 3000)) {
      selected.push(m);
    }
  }
  if (!selected.length) {
    throw new RangeError('mel bank has no filters in the sonority range');
  }
  return selected;
}

/** Compute unsmoothed log energy once per newly added frame. */
export function fillSonority(frames, raw, first, filters) {
  for (let t = first; t < frames.count; t++) {
    let sum = 0;
    for (const m of filters) {
      sum += Math.exp(frames.mel[t * frames.melBands + m]);
    }
    raw[t] = 10 * Math.log10(Math.max(sum, 1e-10));
  }
}

/** Centred moving mean, 40 ms wide; truncate at recording boundaries. */
export function smoothSonority(raw, output, first, count, hop) {
  const width = Math.max(1, Math.round(0.04 / hop));
  const left = Math.floor(width / 2);
  const right = width - left - 1;
  for (let t = first; t < count; t++) {
    let sum = 0;
    const lo = Math.max(0, t - left);
    const hi = Math.min(count - 1, t + right);
    for (let j = lo; j <= hi; j++) {
      sum += raw[j];
    }
    output[t] = sum / (hi - lo + 1);
  }
}

function rise(frames, t, band, d) {
  return (
    frames.band[Math.min(frames.count - 1, t + d) * 6 + band] -
    frames.band[Math.max(0, t - d) * 6 + band]
  );
}

function nearestFinePeak(frames, t, b, sign, fine, radius) {
  let nearest = -1;
  for (
    let j = Math.max(1, t - radius);
    j <= Math.min(frames.count - 2, t + radius);
    j++
  ) {
    const v = sign * rise(frames, j, b, fine);
    if (
      v > 0 &&
      v > sign * rise(frames, j - 1, b, fine) &&
      v >= sign * rise(frames, j + 1, b, fine) &&
      (nearest < 0 || Math.abs(j - t) < Math.abs(nearest - t))
    ) {
      nearest = j;
    }
  }
  return nearest;
}

function bandPeaks(frames, threshold, first, last, { coarse, fine, radius }) {
  const peaks = [];
  for (let b = 0; b < 6; b++) {
    for (
      let t = Math.max(1, first - radius);
      t < Math.min(last + radius, frames.count - 1);
      t++
    ) {
      const value = rise(frames, t, b, coarse);
      const sign = value > 0 ? 1 : -1;
      const strength = Math.abs(value);
      if (
        strength < threshold ||
        strength <= Math.abs(rise(frames, t - 1, b, coarse)) ||
        strength < Math.abs(rise(frames, t + 1, b, coarse))
      ) {
        continue;
      }
      const nearest = nearestFinePeak(frames, t, b, sign, fine, radius);
      if (nearest >= first && nearest < last) {
        peaks.push({ t: nearest, b, sign, strength });
      }
    }
  }
  return peaks;
}

function participatingBands(frames, peaks, { t, sign }, maxBand) {
  const bands = new Map();
  for (const other of peaks) {
    if (
      other.b >= 1 &&
      other.b <= maxBand &&
      other.sign === sign &&
      Math.abs(other.t - t) <= Math.round(0.01 / frames.hop)
    ) {
      bands.set(other.b, Math.max(bands.get(other.b) ?? 0, other.strength));
    }
  }
  return bands;
}

function addGroupCandidate(frames, peaks, peak, candidates) {
  const { t, b, sign } = peak;
  if (b === 0) {
    return;
  }
  const voiced = frames.periodicity[t] >= 0.45;
  const maxBand = voiced ? 4 : 5;
  if (b > maxBand) {
    return;
  }
  const bands = participatingBands(frames, peaks, peak, maxBand);
  if (bands.size >= 3) {
    candidates.push({
      t,
      type: `${voiced ? 's' : 'b'}${sign > 0 ? '+' : '-'}`,
      strength: [...bands.values()].reduce((a, b) => a + b, 0) / bands.size,
    });
  }
}

/** Coarse peaks are relocated onto the nearest fine peak within 20 ms.
 * Endpoints of a plateau choose its first frame, deterministically. */
export function landmarkCandidates(
  frames,
  threshold,
  first = 0,
  last = frames.count
) {
  const coarse = Math.max(1, Math.round(0.025 / frames.hop));
  const fine = Math.max(1, Math.round(0.013 / frames.hop));
  const radius = Math.round(0.02 / frames.hop);
  const peaks = bandPeaks(frames, threshold, first, last, {
    coarse,
    fine,
    radius,
  });
  const candidates = [];
  for (const peak of peaks) {
    const { t, b, sign } = peak;
    const before = frames.periodicity[Math.max(0, t - coarse)] >= 0.45;
    const after =
      frames.periodicity[Math.min(frames.count - 1, t + coarse)] >= 0.45;
    if (b === 0 && before !== after && sign > 0 === after) {
      candidates.push({
        t,
        type: sign > 0 ? 'g+' : 'g-',
        strength: peak.strength,
      });
    }
    addGroupCandidate(frames, peaks, peak, candidates);
  }
  candidates.sort(
    (a, b) =>
      a.t - b.t || a.type.localeCompare(b.type) || b.strength - a.strength
  );
  const kept = [];
  for (const item of candidates) {
    const prior = kept.findLastIndex((p) => p.type === item.type);
    if (prior >= 0 && (item.t - kept[prior].t) * frames.hop < 0.02 - 1e-9) {
      if (item.strength > kept[prior].strength) {
        kept[prior] = item;
      }
    } else {
      kept.push(item);
    }
  }
  return kept.sort((a, b) => a.t - b.t || a.type.localeCompare(b.type));
}

/** The exact ordered decision tree of issue 62, before temporal clean-up. */
export function classifyFrame(frames, sonority, t, peak, burst, T) {
  const e = frames.energy[t] - frames.noise[t];
  if (!frames.speech[t] && e < T.silence) {
    return 0;
  }
  if (frames.periodicity[t] < T.voiced) {
    return burst ? 7 : 5;
  }
  if (
    frames.zcr[t] > T.fricativeZcr ||
    frames.gravity[t] > T.fricativeGravity
  ) {
    return 4;
  }
  if (
    frames.band[t * 6] - frames.band[t * 6 + 2] > T.nasalDrop &&
    sonority[t] < peak - T.nasalBelowPeak
  ) {
    return 3;
  }
  if (sonority[t] < peak - T.glideBelowPeak) {
    return 2;
  }
  return 1;
}

/** Median of five class numbers, then bounded silence/run clean-up.
 * Returns a separate array so all run decisions see the same neighbours. */
function medianAndClosures(raw, count, hop) {
  const median = new Uint8Array(count);
  const window = new Uint8Array(5);
  for (let t = 0; t < count; t++) {
    for (let k = -2; k <= 2; k++) {
      window[k + 2] = raw[Math.max(0, Math.min(count - 1, t + k))];
    }
    window.sort();
    median[t] = window[2];
  }
  const closed = median.slice();
  for (let start = 0; start < count; ) {
    let end = start + 1;
    while (end < count && median[end] === median[start]) {
      end++;
    }
    if (
      median[start] === 0 &&
      start > 0 &&
      end < count &&
      (end - start) * hop < 0.15 - 1e-9
    ) {
      closed.fill(6, start, end);
    }
    start = end;
  }
  return closed;
}

export function cleanClasses(raw, count, hop) {
  const closed = medianAndClosures(raw, count, hop);
  const output = closed.slice();
  for (let start = 0; start < count; ) {
    let end = start + 1;
    while (end < count && closed[end] === closed[start]) {
      end++;
    }
    const minimum = closed[start] === 7 ? 0.005 : 0.015;
    if ((end - start) * hop < minimum - 1e-9) {
      let left = start;
      while (left > 0 && closed[left - 1] === closed[start - 1]) {
        left--;
      }
      let right = end;
      while (right < count && closed[right] === closed[end]) {
        right++;
      }
      if (start > 0 || end < count) {
        output.fill(
          start > 0 && (end === count || start - left >= right - end)
            ? closed[start - 1]
            : closed[end],
          start,
          end
        );
      }
    }
    start = end;
  }
  return output;
}
