#!/usr/bin/env node

/**
 * Experiment for issue 17: guess which words of a text lie between the
 * pauses of a LibriVox recording, without listening.
 *
 *   node experiments/issue-17-align.mjs <file.wav> <text.txt> <lang> [--min 0.15]
 *
 * The recording is split at the pauses of `findPauses` (scripts/golden.mjs)
 * into speech segments. In each segment the syllable nuclei are counted as
 * peaks of the 50-2500 Hz intensity contour with a dip of at least 2 dB
 * between them (after de Jong and Wempe 2009). The words of the text, with
 * the units of step 7 of the issue as syllable counts, are then aligned to
 * the segments by dynamic programming: a segment holds a run of whole
 * words; the cost compares the nuclei with the units and the duration with
 * units times the mean unit duration of the reader (refitted three times
 * and kept inside a plausible band per language),
 * and a segment border inside a clause costs more than one at a comma or
 * a full stop. Segments before the first word (the LibriVox opening words)
 * and after the last (the closing words) are skipped at a small cost.
 *
 * The output lists every segment with its words, then every sentence of
 * the text with the cut that `scripts/golden.mjs cut` would take: from the
 * middle of the pause before it to the middle of the pause after it. It is
 * a guess; a person who listens confirms it (step 9 of the issue).
 */

import { readFileSync } from 'node:fs';

import { decodeWav } from '../src/audio/wav.js';
import { countUnits, findPauses } from '../scripts/golden.mjs';

const [wavFile, textFile, lang, ...rest] = process.argv.slice(2);
const minIndex = rest.indexOf('--min');
const MIN_PAUSE = minIndex >= 0 ? Number(rest[minIndex + 1]) : 0.15;
const belowIndex = rest.indexOf('--below');
// Segment at a lower threshold than the cut rule to see more borders.
const BELOW = belowIndex >= 0 ? Number(rest[belowIndex + 1]) : 35;
const introIndex = rest.indexOf('--intro');
// Skip every segment that ends before this time (the opening words).
const INTRO = introIndex >= 0 ? Number(rest[introIndex + 1]) : 0;

const { samples, sampleRate } = decodeWav(readFileSync(wavFile));
const text = readFileSync(textFile, 'utf8').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- nuclei

function bandIntensity(signal, rate) {
  // One-pole high-pass at 50 Hz and low-pass at 2500 Hz, then 20 ms RMS
  // every 10 ms, in dB.
  const hp = Math.exp((-2 * Math.PI * 50) / rate);
  const lp = Math.exp((-2 * Math.PI * 2500) / rate);
  const filtered = new Float32Array(signal.length);
  let x1 = 0;
  let y1 = 0;
  let z1 = 0;
  for (let i = 0; i < signal.length; i++) {
    const y = hp * (y1 + signal[i] - x1);
    x1 = signal[i];
    y1 = y;
    z1 = (1 - lp) * y + lp * z1;
    filtered[i] = z1;
  }
  const hop = Math.round(0.01 * rate);
  const win = 2 * hop;
  const frames = Math.floor((signal.length - win) / hop);
  const db = new Float64Array(Math.max(0, frames));
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < f * hop + win; i++) {
      sum += filtered[i] * filtered[i];
    }
    db[f] = 10 * Math.log10(sum / win + 1e-12);
  }
  // Smooth with a 3-frame moving average.
  const smooth = db.map((_, f) => {
    const a = db[Math.max(0, f - 1)];
    const b = db[Math.min(db.length - 1, f + 1)];
    return (a + db[f] + b) / 3;
  });
  return { db: smooth, hop: 0.01 };
}

const intensity = bandIntensity(samples, sampleRate);
const sortedDb = Float64Array.from(intensity.db).sort();
const ceiling = sortedDb[Math.floor(0.99 * (sortedDb.length - 1))];
const floor = ceiling - 25;

function nucleiIn(start, end) {
  const { db, hop } = intensity;
  const from = Math.max(1, Math.floor(start / hop));
  const to = Math.min(db.length - 1, Math.ceil(end / hop));
  const peaks = [];
  for (let f = from; f < to; f++) {
    if (db[f] > floor && db[f] >= db[f - 1] && db[f] > db[f + 1]) {
      peaks.push(f);
    }
  }
  // Keep a peak only when the dip to the previous kept peak is >= 2 dB.
  const kept = [];
  for (const peak of peaks) {
    const last = kept.at(-1);
    if (last === undefined) {
      kept.push(peak);
      continue;
    }
    let dip = Infinity;
    for (let f = last; f <= peak; f++) {
      dip = Math.min(dip, db[f]);
    }
    if (Math.min(db[last], db[peak]) - dip >= 2) {
      kept.push(peak);
    } else if (db[peak] > db[last]) {
      kept[kept.length - 1] = peak;
    }
  }
  return kept.length;
}

// ---------------------------------------------------------------- segments

const pauses = findPauses(samples, sampleRate, {
  min: MIN_PAUSE,
  below: BELOW,
});
// The pauses of `node scripts/golden.mjs pauses` (35 dB, 0.25 s): a cut
// begins and ends in the middle of one of them.
const cutPauses = findPauses(samples, sampleRate);
const total = samples.length / sampleRate;
const segments = [];
let cursor = 0;
for (const pause of [...pauses, { start: total, end: total }]) {
  if (pause.start - cursor >= 0.08) {
    segments.push({ start: cursor, end: pause.start });
  }
  cursor = pause.end;
}
for (const segment of segments) {
  segment.duration = segment.end - segment.start;
  segment.nuclei = nucleiIn(segment.start, segment.end);
}
// The pause before and after every segment, for the cut points.
const overlaps = (a, b) => a && b && a.start < b.end && b.start < a.end;
for (const segment of segments) {
  const before = pauses.findLast((p) => p.end <= segment.start + 1e-9);
  const after = pauses.find((p) => p.start >= segment.end - 1e-9);
  segment.pauseBefore = cutPauses.find((p) => overlaps(p, before));
  segment.pauseAfter = cutPauses.find((p) => overlaps(p, after));
}

// ---------------------------------------------------------------- words

const SENTENCE_END = /[.!?।。！？]["'”’»)]*$/u;
const CLAUSE_END = /[,;:，；：、—–-]["'”’»)]*$/u;
const tokens =
  lang === 'zh'
    ? text.match(/\p{Script=Han}[^\p{Script=Han}]*/gu)
    : text.split(' ');
const words = tokens.map((word) => ({
  word,
  units: Math.max(1, countUnits(word, lang)),
  strength: SENTENCE_END.test(word.trim())
    ? 3
    : CLAUSE_END.test(word.trim())
      ? 2
      : 0,
}));
const prefix = [0];
for (const word of words) {
  prefix.push(prefix.at(-1) + word.units);
}

// ---------------------------------------------------------------- DP

const BORDER = { 3: 0, 2: 1, 0: 6 };

// The cost of skipping a segment: opening words, closing words or a noise.
function skipCost(seg, i, W) {
  if (i === 0 && seg.end <= INTRO + 0.5) {
    return 0;
  }
  if (i === 0 || i === W) {
    return 0.4 * seg.duration + 0.5;
  }
  return seg.duration < 0.25 && seg.nuclei <= 1 ? 2 : Infinity;
}

function align(unitDuration) {
  const S = segments.length;
  const W = words.length;
  const cost = Array.from({ length: S + 1 }, () =>
    new Float64Array(W + 1).fill(Infinity)
  );
  const back = Array.from({ length: S + 1 }, () => new Int32Array(W + 1));
  cost[0][0] = 0;
  for (let j = 0; j < S; j++) {
    const seg = segments[j];
    for (let i = 0; i <= W; i++) {
      const here = cost[j][i];
      if (!Number.isFinite(here)) {
        continue;
      }
      const skip = skipCost(seg, i, W);
      if (here + skip < cost[j + 1][i]) {
        cost[j + 1][i] = here + skip;
        back[j + 1][i] = -1;
      }
      if (i === 0 && seg.end <= INTRO + 0.5) {
        continue;
      }
      for (let k = i + 1; k <= W; k++) {
        const units = prefix[k] - prefix[i];
        if (units > seg.nuclei * 2 + 12) {
          break;
        }
        const expected = units * unitDuration;
        const durationCost =
          ((seg.duration - expected) / (0.2 * expected + 0.15)) ** 2;
        const nucleiCost = (units - seg.nuclei) ** 2 / (units + 2);
        const border = k === W ? 0 : BORDER[words[k - 1].strength];
        const total = here + durationCost + nucleiCost + border;
        if (total < cost[j + 1][k]) {
          cost[j + 1][k] = total;
          back[j + 1][k] = i;
        }
      }
    }
  }
  const assignment = new Array(S).fill(null);
  let i = W;
  for (let j = S; j > 0; j--) {
    const from = back[j][i];
    if (from >= 0) {
      assignment[j - 1] = [from, i];
      i = from;
    }
  }
  return { assignment, cost: cost[S][W] };
}

// Plausible seconds per unit of a careful reader; the fitted value is kept
// inside, so that the text is not squeezed into the opening words.
const BAND = {
  en: [0.15, 0.27],
  ru: [0.15, 0.27],
  hi: [0.12, 0.26],
  zh: [0.2, 0.45],
};
const [lowest, highest] = BAND[lang];
const clamp = (value) => Math.min(highest, Math.max(lowest, value));
let unitDuration = (lowest + highest) / 2;
let result = align(unitDuration);
for (let pass = 0; pass < 3; pass++) {
  let time = 0;
  let units = 0;
  result.assignment.forEach((range, j) => {
    if (range) {
      time += segments[j].duration;
      units += prefix[range[1]] - prefix[range[0]];
    }
  });
  unitDuration = clamp(time / units);
  result = align(unitDuration);
}

console.log(
  `# ${segments.length} segments, ${words.length} words, ${prefix.at(-1)} units, ${unitDuration.toFixed(3)} s per unit, cost ${result.cost.toFixed(1)}`
);
result.assignment.forEach((range, j) => {
  const seg = segments[j];
  const said = range
    ? words
        .slice(range[0], range[1])
        .map((w) => w.word)
        .join(lang === 'zh' ? '' : ' ')
    : '-';
  const units = range ? prefix[range[1]] - prefix[range[0]] : 0;
  console.log(
    `${seg.start.toFixed(2)}-${seg.end.toFixed(2)} ${seg.duration.toFixed(2)}s n=${seg.nuclei} u=${units} | ${said}`
  );
});

// Sentences that begin and end at a segment border.
console.log('# sentences');
const middle = (pause) => (pause ? (pause.start + pause.end) / 2 : null);
let first = 0;
for (let w = 0; w < words.length; w++) {
  if (words[w].strength !== 3 && w !== words.length - 1) {
    continue;
  }
  const startSeg = result.assignment.findIndex((r) => r && r[0] === first);
  const endSeg = result.assignment.findIndex((r) => r && r[1] === w + 1);
  const sentence = words
    .slice(first, w + 1)
    .map((x) => x.word)
    .join(lang === 'zh' ? '' : ' ');
  const a0 = segments[startSeg]?.pauseBefore;
  const b0 = segments[endSeg]?.pauseAfter;
  if (startSeg >= 0 && endSeg >= 0 && a0 && b0) {
    const a = segments[startSeg].pauseBefore;
    const b = segments[endSeg].pauseAfter;
    const from = middle(a);
    const to = middle(b);
    const units = prefix[w + 1] - prefix[first];
    const span = to - from;
    console.log(
      `${from?.toFixed(3)} ${to?.toFixed(3)} (${span.toFixed(2)} s, ${(units / span).toFixed(2)} u/s, pauses ${(a.end - a.start).toFixed(2)}/${(b.end - b.start).toFixed(2)}) ${sentence}`
    );
  } else {
    const why = startSeg < 0 || endSeg < 0 ? 'no border' : 'no cut pause';
    console.log(`- (${why}) ${sentence}`);
  }
  first = w + 1;
}
