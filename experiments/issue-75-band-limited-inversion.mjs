/** Compare acoustic inversion with and without source tilt and band edges. Unlicense. */
import {
  AUDIO_TIERS,
  errorRate,
  frameEnvelope,
  invertArticulation,
  levelForTier,
  synthesize,
} from '../src/index.js';
import { GRID } from '../src/recognition/codebook-features.js';
import { envelopeCost } from '../src/recognition/codebook-search.js';
import {
  analyzeForDecode,
  decoderCodebook,
  decoderSettings,
  prepareIpaDecode,
  segmentsOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import { RECOGNITION_LEVELS } from '../src/recognition/recognizer.js';
import { sentences } from '../tests/helpers/roundtrip.js';

function passbandCost(bands, removeTilt) {
  const octaves = bands.map((i) => Math.log2(GRID[i]));
  const mean = octaves.reduce((sum, octave) => sum + octave, 0) / bands.length;
  const centered = octaves.map((octave) => octave - mean);
  const variance = centered.reduce((sum, octave) => sum + octave * octave, 0);
  return (envelope, stored, row) => {
    let power = 0;
    let level = 0;
    let slope = 0;
    for (const [j, i] of bands.entries()) {
      const delta = envelope[i] - (stored[row * GRID.length + i] * 0.5 - 64);
      power += delta * delta;
      level += delta;
      slope += centered[j] * delta;
    }
    const offsetPower = (level * level) / bands.length;
    const tiltPower = removeTilt ? (slope * slope) / variance : 0;
    return Math.max(0, power - offsetPower - tiltPower) / bands.length;
  };
}

function acousticQuery(frames, book, cutoff, removeTilt) {
  const envelope = new Float64Array(GRID.length);
  const scratch = { envelope, key: new Float64Array(6) };
  const bands = Array.from(GRID.keys()).filter(
    (i) => GRID[i] / book.lengthScale <= Math.min(cutoff, 0.475 * frames.rate)
  );
  const score = Number.isFinite(cutoff)
    ? passbandCost(bands, removeTilt)
    : envelopeCost;
  return (frame, out) => {
    frameEnvelope(frames, frame, book, scratch);
    const rows = Array.from({ length: book.size }, (_, row) => ({
      row,
      cost: score(envelope, book.envelope, row),
    })).sort((a, b) => a.cost - b.cost || a.row - b.row);
    for (const [j, { cost, row }] of rows
      .slice(0, out.index.length)
      .entries()) {
      out.index[j] = row;
      out.cost[j] = cost;
    }
  };
}

function measure(spoken, settings, analysis, articulation) {
  const { prepared, templates } = prepareIpaDecode(
    { ...analysis, tracks: { ...analysis.tracks, articulation } },
    settings
  );
  const { paths } = decodeSearch(prepared, settings.language, settings);
  const heard = segmentsOf(
    paths[0],
    prepared.times,
    templates,
    settings.language
  )
    .map(({ ipa }) => ipa)
    .join(' ');
  const { distance, referenceLength } = errorRate(spoken.ipa, heard, 'phone');
  return { distance, referenceLength };
}

const wideband = process.argv.includes('--wideband');
const tier = wideband ? 'wideband' : 'telephone';
const level = RECOGNITION_LEVELS[levelForTier(tier)];
const cutoff = AUDIO_TIERS.find(({ name }) => name === tier).bandLimit;
const candidates = [
  ['all measured bands', Infinity, false],
  ['passband', cutoff, false],
  ['passband with tilt removed', cutoff, true],
];
const examples = [
  ['en', 17, 6],
  ['ru', 1, 5],
  ['hi', 1, 15],
  ['zh', 1, 13],
];

for (const [lang, initial, heldOut] of examples) {
  for (const [index, preset] of [
    [initial, 'male'],
    [heldOut, 'female'],
  ]) {
    const spoken = synthesize(sentences[lang][index], {
      lang,
      head: 'random',
      preset,
      seed: 1,
      tier,
    });
    const { samples, sampleRate } = spoken;
    const settings = decoderSettings(sampleRate, {
      ...level,
      languages: Object.keys(sentences),
      whisper: false,
      lattice: false,
    });
    const analysis = analyzeForDecode(samples, sampleRate, {}, settings);
    const { frames, tracks, voice } = analysis;
    const info = { lang, sentence: index + 1, preset, tier };
    console.log(
      JSON.stringify({
        ...info,
        method: 'baseline',
        ...measure(spoken, settings, analysis, tracks.articulation),
      })
    );
    const codebook = decoderCodebook(voice);
    for (const [method, cutoffHz, removeTilt] of candidates) {
      const articulation = invertArticulation(frames, {
        voice,
        codebook,
        pitch: tracks.pitch,
        formants: tracks.formants,
        query: acousticQuery(frames, codebook, cutoffHz, removeTilt),
      });
      console.log(
        JSON.stringify({
          ...info,
          method,
          ...measure(spoken, settings, analysis, articulation),
        })
      );
    }
  }
}
