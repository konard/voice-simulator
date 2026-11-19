/** Measure candidates rendered in the same acoustic feature space as the input. Unlicense. */
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
import { steadyPlan } from '../src/recognition/codebook-features.js';
import { LANDMARK_SENTENCES } from '../scripts/landmark-material.mjs';

const vowels = Object.keys(VOWELS);
const settings = { engine: 'js', solver: 'waveguide', seed: 1 };
const pitchScales = [0.8, 1, 1.2, 1.4];

function decode(book, row) {
  return Object.fromEntries(
    CODEBOOK_CHANNELS.map(({ name, min, max }, c) => [
      name,
      min +
        (book.articulation[row * CODEBOOK_CHANNELS.length + c] / 255) *
          (max - min),
    ])
  );
}

function bank(voice, sampleRate, book, limit) {
  return Array.from({ length: limit }, (_, row) => {
    const state = decode(book, row);
    const plan = steadyPlan(state, 0.085);
    plan.head = voice;
    // Let the renderer infer these controls from the twelve row values.
    delete plan.channels.jaw;
    delete plan.channels.lipProtrusion;
    return pitchScales.map((scale) => {
      const f0 = voice.pitch * scale;
      plan.channels.f0.fill(f0);
      const frames = analyzeFrames(
        renderPlan(plan, { ...settings, sampleRate }),
        sampleRate
      );
      return [9, 10, 11, 12, 13].map((t) => coefs(frames, t));
    });
  });
}

function coefs(frames, t) {
  const i = t * frames.cepstra;
  return frames.cepstrum.subarray(i + 1, i + frames.cepstra);
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return sum;
}

function matchRows(frames, pitch, voice, templates) {
  return Array.from({ length: frames.count }, (_, t) => {
    const f0 = pitch.f0[t] || voice.pitch;
    const observed = coefs(frames, t);
    return templates
      .map((row, index) => {
        let cost = Infinity;
        for (const [i, examples] of row.entries()) {
          const penalty =
            (Math.log(f0 / (voice.pitch * pitchScales[i])) * 6) ** 2;
          for (const example of examples) {
            cost = Math.min(cost, distance(observed, example) + penalty);
          }
        }
        return { index, cost };
      })
      .sort((a, b) => a.cost - b.cost || a.index - b.index)
      .slice(0, 16);
  });
}

function invert(sampleRate, voice, samples, book, templates) {
  const frames = analyzeFrames(samples, sampleRate);
  const pitch = trackPitch(frames);
  const rows = matchRows(frames, pitch, voice, templates);
  const speechFrames = rows.map((_, t) => t).filter((t) => frames.speech[t]);
  let next = 0;
  const rendered = {
    ...book,
    query(_envelope, k, { index, cost }) {
      rows[speechFrames[next++]].slice(0, k).forEach((row, i) => {
        index[i] = row.index;
        cost[i] = row.cost * 16;
      });
    },
  };
  const track = invertArticulation(frames, {
    codebook: rendered,
    voice,
    pitch,
    // Scoring uses cepstra in place of the analytic envelope and formants.
    formants: {
      committed: frames.count,
      valid: new Uint8Array(frames.count * 4),
    },
  });
  return { frames, track };
}

function score({ plan, samples }, sampleRate, voice, book, templates, steady) {
  const { frames, track } = invert(sampleRate, voice, samples, book, templates);
  const times = steady
    ? plan.segments
        .filter(({ kind }) => kind === 'vowel')
        .map(({ start, end }) => Math.round((start + end) / (2 * frames.hop)))
    : Array.from({ length: frames.count }, (_, i) => i).filter(
        (i) => frames.speech[i] && frames.periodicity[i] >= 0.45
      );
  let correct = 0;
  let height = 0;
  let backness = 0;
  for (const i of times) {
    const truth = sampleState(plan, i * frames.hop);
    const dh = Math.abs(track.channels.height[i] - truth.height);
    const db = Math.abs(track.channels.backness[i] - truth.backness);
    correct += Number(dh <= 0.15 && db <= 0.2);
    height += dh ** 2;
    backness += db ** 2;
  }
  console.log({
    sampleRate,
    voice: voice.pitch,
    steady,
    correct,
    frames: times.length,
    height: Math.sqrt(height / times.length),
    backness: Math.sqrt(backness / times.length),
  });
  if (!steady) {
    const estimated = articulationPlan(track);
    const oracleSource = { ...estimated, channels: { ...estimated.channels } };
    const tract = new Set(CODEBOOK_CHANNELS.map(({ name }) => name));
    for (const name of Object.keys(oracleSource.channels)) {
      if (!tract.has(name)) {
        oracleSource.channels[name] = Float32Array.from(
          { length: frames.count },
          (_, t) => sampleState(plan, t * frames.hop)[name]
        );
      }
    }
    const distortion = (candidate) =>
      melCepstralDistortion(
        samples,
        renderPlan(candidate, { ...settings, sampleRate }),
        sampleRate
      );
    console.log({
      sampleRate,
      voice: voice.pitch,
      mcd: distortion(estimated),
      oracleSourceMcd: distortion(oracleSource),
    });
  }
}

for (const [preset, sampleRate] of [
  ['male', 16000],
  ['female', 16000],
  ['male', 8000],
]) {
  const voice = presetHeadConfig(preset);
  const book = buildCodebook(voice, { size: 5000 });
  const templates = bank(voice, sampleRate, book, 192);
  const plan = planUtterance(vowels.map((vowel) => `${vowel}ː`).join(''), {
    head: voice,
    durations: vowels.map(() => 0.3),
  });
  const samples = renderPlan(plan, { ...settings, sampleRate });
  score({ plan, samples }, sampleRate, voice, book, templates, true);
  const spoken = synthesize(LANDMARK_SENTENCES[0][1], {
    ...settings,
    head: voice,
    sampleRate,
  });
  score(spoken, sampleRate, voice, book, templates, false);
  if (preset === 'male' && sampleRate === 16000) {
    for (const ipa of ['apa', 'ata', 'aka']) {
      const { plan, samples } = synthesize(ipa, {
        ...settings,
        head: voice,
        sampleRate,
        ipa: true,
      });
      const { frames, track } = invert(
        sampleRate,
        voice,
        samples,
        book,
        templates
      );
      const { start, end } = plan.segments.find(
        ({ kind }) => kind === 'consonant'
      );
      const t = Math.round((start + end) / (2 * frames.hop));
      console.log({ ipa, lipAmount: track.channels.lipAmount[t] });
    }
  }
}
