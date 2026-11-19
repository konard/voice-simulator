/** Isolate the candidate lattice from acoustic observation errors. Unlicense. */
import {
  analyzeFrames,
  articulationPlan,
  buildCodebook,
  CODEBOOK_CHANNELS,
  invertArticulation,
  melCepstralDistortion,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  synthesize,
  trackPitch,
} from '../src/index.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import { VOWELS } from '../src/ipa/inventory.js';
import { LANDMARK_SENTENCES } from '../scripts/landmark-material.mjs';

const settings = { solver: 'waveguide', engine: 'js', seed: 1 };
const channels = CODEBOOK_CHANNELS.map(({ name }) => name);
const observationWeight = Number(process.argv[2] ?? 1);
if (!Number.isFinite(observationWeight) || observationWeight <= 0) {
  throw new RangeError('The oracle observation weight must be positive');
}

function encode({ name, min, max }, state) {
  return (255 * (state[name] - min)) / (max - min);
}

function distance(table, row, target) {
  let sum = 0;
  for (let c = 0; c < channels.length; c++) {
    sum += (table[row * channels.length + c] - target[c]) ** 2;
  }
  return sum;
}

// This is a diagnostic only. Give the search precise tract observations
// while retaining the stored row geometry, transitions, smoothing and source.
function oracleBook(book, frames, truth) {
  let t = 0;
  const target = new Float64Array(channels.length);
  return {
    ...book,
    query(_envelope, k, { index, cost }) {
      while (t < frames.count && !frames.speech[t]) {
        t++;
      }
      CODEBOOK_CHANNELS.forEach((channel, c) => {
        target[c] = encode(channel, truth[t]);
      });
      t++;
      index.fill(-1);
      cost.fill(Infinity);
      for (let row = 0; row < book.size; row++) {
        const sum = distance(book.articulation, row, target);
        const score = (16 * observationWeight * sum) / 255 ** 2;
        if (score >= cost[k - 1]) {
          continue;
        }
        let at = k - 1;
        while (at > 0 && score < cost[at - 1]) {
          cost[at] = cost[at - 1];
          index[at] = index[at - 1];
          at--;
        }
        cost[at] = score;
        index[at] = row;
      }
    },
  };
}

function projectRows(book, states, exactTuple) {
  const projected = Object.fromEntries(
    CODEBOOK_CHANNELS.map(({ name }) => [name, new Float32Array(states.length)])
  );
  for (const [t, state] of states.entries()) {
    const target = CODEBOOK_CHANNELS.map((channel) => encode(channel, state));
    let best = 0;
    let minimum = Infinity;
    if (!exactTuple) {
      for (let row = 0; row < book.size; row++) {
        const score = distance(book.articulation, row, target);
        if (score < minimum) {
          best = row;
          minimum = score;
        }
      }
    }
    CODEBOOK_CHANNELS.forEach(({ name, min, max }, c) => {
      const value = exactTuple
        ? Math.round(target[c])
        : book.articulation[best * channels.length + c];
      projected[name][t] = min + (value * (max - min)) / 255;
    });
  }
  return projected;
}

function compare(track, truth, book, times) {
  let matches = 0;
  let height = 0;
  let backness = 0;
  const { channels: values, candidates } = track;
  let rowMatches = 0;
  for (const t of times) {
    const h = values.height[t] - truth[t].height;
    const b = values.backness[t] - truth[t].backness;
    matches += Number(Math.abs(h) <= 0.15 && Math.abs(b) <= 0.2);
    height += h * h;
    backness += b * b;
    const first = t * candidates.width;
    const rows = candidates.index.subarray(first, first + candidates.count[t]);
    rowMatches += Number(
      rows.some((row) => {
        const i = row * channels.length;
        return (
          Math.abs(book.articulation[i] / 255 - truth[t].height) <= 0.15 &&
          Math.abs(book.articulation[i + 1] / 255 - truth[t].backness) <= 0.2
        );
      })
    );
  }
  return {
    matches,
    rowMatches,
    count: times.length,
    height: Math.sqrt(height / times.length),
    backness: Math.sqrt(backness / times.length),
  };
}

function probe({ plan, samples }, rate, voice, book, timesFor) {
  const frames = analyzeFrames(samples, rate);
  const pitch = trackPitch(frames);
  const truth = Array.from({ length: frames.count }, (_, t) =>
    sampleState(plan, t * frames.hop)
  );
  const times = timesFor(frames);
  const baseline = invertArticulation(frames, { voice, pitch, codebook: book });
  const oracle = invertArticulation(frames, {
    voice,
    pitch,
    codebook: oracleBook(book, frames, truth),
    formants: {
      committed: frames.count,
      valid: new Uint8Array(4 * frames.count),
    },
  });
  console.log({
    rate,
    pitch: voice.pitch,
    observationWeight,
    acoustic: compare(baseline, truth, book, times),
    oracle: compare(oracle, truth, book, times),
  });
  return { baseline, oracle, truth };
}

const bookFor = (voice) => buildCodebook(voice, { size: 5000 });
const male = presetHeadConfig('male');
const maleBook = bookFor(male);
for (const voice of [male, presetHeadConfig('female')]) {
  const book = voice === male ? maleBook : bookFor(voice);
  const vowels = Object.keys(VOWELS);
  const sampleRate = 16000;
  const plan = planUtterance(vowels.map((vowel) => `${vowel}ː`).join(''), {
    head: voice,
    durations: vowels.map(() => 0.3),
  });
  const samples = renderPlan(plan, { ...settings, sampleRate });
  probe({ plan, samples }, sampleRate, voice, book, (frames) =>
    plan.segments
      .filter(({ kind }) => kind === 'vowel')
      .map(({ start, end }) => Math.round((start + end) / (2 * frames.hop)))
  );
}

for (const sampleRate of [16000, 8000]) {
  const audio = synthesize(LANDMARK_SENTENCES[0][1], {
    ...settings,
    head: male,
    sampleRate,
  });
  const { baseline, oracle, truth } = probe(
    audio,
    sampleRate,
    male,
    maleBook,
    (frames) =>
      Array.from(frames.speech.subarray(0, frames.count).keys()).filter(
        (t) => frames.speech[t] && frames.periodicity[t] >= 0.45
      )
  );
  const plan = articulationPlan(oracle);
  const exact = Object.fromEntries(
    Object.keys(audio.plan.channels).map((name) => [
      name,
      Float32Array.from(truth, (state) => state[name]),
    ])
  );
  const sourceTruth = { ...plan.channels };
  for (const name of Object.keys(sourceTruth)) {
    if (!channels.includes(name)) {
      sourceTruth[name] = Float32Array.from(truth, (state) => state[name]);
    }
  }
  const mcd = (candidate) =>
    melCepstralDistortion(
      audio.samples,
      renderPlan(candidate, { ...settings, sampleRate }),
      sampleRate
    );
  console.log({
    sampleRate,
    baselineMcd: mcd(articulationPlan(baseline)),
    oracleLatticeMcd: mcd(plan),
    oracleLatticeAndSourceMcd: mcd({ ...plan, channels: sourceTruth }),
    projectedNearestRowMcd: mcd({
      ...plan,
      channels: { ...exact, ...projectRows(maleBook, truth, false) },
    }),
    projectedComponentwiseMcd: mcd({
      ...plan,
      channels: { ...exact, ...projectRows(maleBook, truth, true) },
    }),
    sampledPlanMcd: mcd({ ...plan, channels: exact }),
  });
}
