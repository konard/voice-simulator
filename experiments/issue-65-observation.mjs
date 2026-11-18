/** Diagnose the observed candidates and the render-back distortion. Unlicense. */
import {
  analyzeFrames,
  articulationPlan,
  buildCodebook,
  invertArticulation,
  melCepstralDistortion,
  presetHeadConfig,
  renderPlan,
  synthesize,
  trackFormants,
  trackPitch,
  tractShape,
  tractResponse,
  GRID,
} from '../src/index.js';
import { sampleState } from '../src/articulation/tract-shape.js';
import {
  normalizeEnvelope,
  steadyPlan,
} from '../src/recognition/codebook-features.js';
import { frameEnvelope } from '../src/recognition/codebook.js';
import { envelopeCost } from '../src/recognition/codebook-search.js';
import { CHANNEL_DEFAULTS } from '../src/articulation/plan.js';
import { LANDMARK_SENTENCES } from '../scripts/landmark-material.mjs';

/** Use the same 24-band distance with no six-dimensional shortlist. */
function exhaustiveQuery(book, report) {
  let queries = 0;
  let shared = 0;
  const approximate = { index: new Int32Array(64), cost: new Float64Array(64) };
  return {
    ...book,
    query(envelope, k, { index, cost }) {
      index.fill(-1, 0, k);
      cost.fill(Infinity, 0, k);
      for (let row = 0; row < book.size; row++) {
        const distance = envelopeCost(envelope, book.envelope, row);
        if (distance >= cost[k - 1]) {
          continue;
        }
        let slot = k - 1;
        while (slot > 0 && distance < cost[slot - 1]) {
          cost[slot] = cost[slot - 1];
          index[slot] = index[slot - 1];
          slot--;
        }
        cost[slot] = distance;
        index[slot] = row;
      }
      book.query(envelope, k, approximate);
      const exact = index.subarray(0, k);
      for (let i = 0; i < k; i++) {
        shared += Number(exact.includes(approximate.index[i]));
      }
      queries++;
      report.recall = shared / (queries * k);
    },
  };
}

const voice = presetHeadConfig('male');
const settings = { solver: 'waveguide', engine: 'js', seed: 1 };
const book = buildCodebook(voice, { size: 5000 });
for (const rate of [16000, 8000]) {
  const render = (plan) =>
    renderPlan(plan, { ...settings, sampleRate: rate, head: voice });
  const { plan, samples } = synthesize(LANDMARK_SENTENCES[0][1], {
    ...settings,
    sampleRate: rate,
    head: voice,
  });
  const frames = analyzeFrames(samples, rate);
  const pitch = trackPitch(frames);
  const formants = trackFormants(frames, {
    pitch,
    vocalTractLength: voice.vocalTractLength,
  });
  const options = { voice, pitch, formants, codebook: book };
  const raw = invertArticulation(frames, options);
  const exhaustive = {};
  const exact = invertArticulation(frames, {
    ...options,
    codebook: exhaustiveQuery(book, exhaustive),
  });
  const neutral = analyzeFrames(
    render(steadyPlan({ ...CHANNEL_DEFAULTS, f0: voice.pitch }, 0.3)),
    rate
  );
  const scratch = { envelope: new Float64Array(24), key: new Float64Array(6) };
  const shape = tractShape(CHANNEL_DEFAULTS, voice);
  const analytic = new Float64Array(24);
  tractResponse(
    shape.areas,
    shape.length,
    Float64Array.from(GRID, (f) => f / book.lengthScale),
    analytic
  );
  normalizeEnvelope(analytic);
  frameEnvelope(neutral, neutral.count >> 1, book, scratch);
  const correction = analytic.map((value, j) => value - scratch.envelope[j]);
  const codebook = {
    ...book,
    query(envelope, k, out) {
      return book.query(
        envelope.map((x, j) => x + correction[j]),
        k,
        out
      );
    },
  };
  const adjusted = invertArticulation(frames, { ...options, codebook });
  const withoutFormants = invertArticulation(frames, {
    ...options,
    formants: { ...formants, valid: new Uint8Array(formants.valid.length) },
  });
  const truth = articulationPlan(raw);
  const state = {};
  truth.channels = Object.fromEntries(
    Object.keys(raw.channels).map((key) => [
      key,
      new Float32Array(frames.count),
    ])
  );
  const tract = new Set(book.channels.map(({ name }) => name));
  for (let t = 0; t < frames.count; t++) {
    sampleState(plan, t * frames.hop, state);
    for (const [name, values] of Object.entries(truth.channels)) {
      values[t] = state[name];
    }
  }
  const mcd = (candidate) =>
    melCepstralDistortion(samples, render(candidate), rate);
  const oracleTract = articulationPlan(raw);
  oracleTract.channels = {
    ...raw.channels,
    ...Object.fromEntries(
      Object.entries(truth.channels).filter(([key]) => tract.has(key))
    ),
  };
  const oracleSource = articulationPlan(raw);
  oracleSource.channels = {
    ...raw.channels,
    ...Object.fromEntries(
      Object.entries(truth.channels).filter(([key]) => !tract.has(key))
    ),
  };
  console.log({
    rate,
    input: mcd(plan),
    truth21: mcd(truth),
    truthTract: mcd(oracleTract),
    truthSource: mcd(oracleSource),
    raw: mcd(articulationPlan(raw)),
    compensated: mcd(articulationPlan(adjusted)),
    withoutFormants: mcd(articulationPlan(withoutFormants)),
    exhaustive: mcd(articulationPlan(exact)),
    shortlistRecall: exhaustive.recall,
  });
  for (const names of [
    ['f0'],
    ['voicing'],
    ['loudness'],
    ['aspiration'],
    ['frication'],
    ['sibilance'],
    ['aspiration', 'frication', 'sibilance'],
    ['trill', 'glottalClosure', 'lateral'],
  ]) {
    const channels = { ...truth.channels };
    for (const name of names) {
      channels[name] = raw.channels[name];
    }
    console.log({ rate, estimated: names, mcd: mcd({ ...truth, channels }) });
  }
  for (const voiced of [true, false]) {
    const f0 = truth.channels.f0.map((value, t) =>
      pitch.f0[t] > 0 === voiced ? raw.channels.f0[t] : value
    );
    console.log({
      rate,
      estimated: voiced ? 'f0 in voiced frames' : 'f0 in unvoiced frames',
      mcd: mcd({ ...truth, channels: { ...truth.channels, f0 } }),
    });
  }
  for (const key of ['height', 'backness']) {
    let oracle = 0;
    let correct = 0;
    let compensated = 0;
    let exactError = 0;
    let n = 0;
    for (let t = 0; t < frames.count; t++) {
      if (!frames.speech[t] || frames.periodicity[t] < 0.45) {
        continue;
      }
      const expected = truth.channels[key][t];
      let best = 1;
      const { width, index, count } = raw.candidates;
      for (let j = 0; j < count[t]; j++) {
        const row = index[t * width + j];
        const value =
          book.articulation[row * 12 + (key === 'height' ? 0 : 1)] / 255;
        best = Math.min(best, Math.abs(value - expected));
      }
      oracle += best ** 2;
      correct += (raw.channels[key][t] - expected) ** 2;
      compensated += (adjusted.channels[key][t] - expected) ** 2;
      exactError += (exact.channels[key][t] - expected) ** 2;
      n++;
    }
    console.log({
      rate,
      key,
      oracle: Math.sqrt(oracle / n),
      selected: Math.sqrt(correct / n),
      compensated: Math.sqrt(compensated / n),
      exhaustive: Math.sqrt(exactError / n),
    });
  }
}

for (const ipa of ['apa', 'ata', 'aka']) {
  const { plan, samples } = synthesize(ipa, {
    ...settings,
    ipa: true,
    sampleRate: 16000,
    head: voice,
  });
  const frames = analyzeFrames(samples, 16000);
  const track = invertArticulation(frames, { voice, codebook: book });
  const { start, end } = plan.segments.find(({ kind }) => kind === 'consonant');
  const center = Math.round((start + end) / (2 * frames.hop));
  const { count, width, index, cost } = track.candidates;
  // Use the known interval only to measure whether relabeling is sufficient.
  const speech = frames.speech.slice();
  speech.fill(0, Math.ceil(start / frames.hop), Math.floor(end / frames.hop));
  const knownGap = invertArticulation(
    { ...frames, speech },
    {
      voice,
      codebook: book,
    }
  );
  console.log({
    ipa,
    measuredLip: track.channels.lipAmount[center],
    knownGapLip: knownGap.channels.lipAmount[center],
    knownGapCandidates: knownGap.candidates.count[center],
  });
  for (let t = center - 2; t <= center + 2; t++) {
    const rows = index.subarray(t * width, t * width + count[t]);
    let labial = 0;
    let minimum = Infinity;
    rows.forEach((row, j) => {
      const i = row * 12;
      if (book.articulation[i + 5] > 127 && book.articulation[i + 6] < 7) {
        labial++;
        minimum = Math.min(minimum, cost[t * width + j]);
      }
    });
    console.log({
      ipa,
      t,
      gap: !frames.speech[t],
      energy: frames.energy[t],
      labial,
      minimum,
    });
  }
}
