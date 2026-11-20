/** Test power-weighted mel distances on synthesized whisper. Unlicense. */
import { errorRate, ipaToText } from '../src/index.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
  resultOf,
} from '../src/recognition/decode-pipeline.js';
import { decodeSearch } from '../src/recognition/decode-search.js';
import {
  whisperReferences,
  WHISPER_WEIGHTS,
} from '../src/recognition/whisper-decode.js';
import { whisperSpectrum } from '../src/recognition/whisper-spectrum.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const POINTS = [0.1, 0.3, 0.5, 0.7, 0.9];
const strip = (ipa) => ipa.replace(/[ˈˌ˥˦˧˨˩]/gu, '');
const asPhones = (segments) => segments.map(({ ipa }) => strip(ipa)).join(' ');
const variants = [0.08, 0.16, 0.32];

function weightedDistance(input, target, width, vowel, exponent) {
  let total = 0;
  for (let row = 0; row < input.length; row += width) {
    let sum = 0;
    let weightSum = 0;
    for (let i = row; i < row + width - 1; i++) {
      const delta = input[i] - target[i];
      const weight = Math.exp(exponent * Math.max(input[i], target[i]));
      sum += weight * delta * delta;
      weightSum += weight;
    }
    const energy =
      (input[row + width - 1] - target[row + width - 1]) / (vowel ? 20 : 13);
    total += sum / weightSum + energy ** 2;
  }
  return total / POINTS.length;
}

function scoreUnit(input, refs, width, vowel, exponent, duration) {
  let best = Infinity;
  for (const { values, duration: nominal } of refs) {
    const timing = 2 * Math.log(duration / nominal) ** 2;
    const spectral = weightedDistance(input, values, width, vowel, exponent);
    best = Math.min(
      best,
      8 * duration * spectral + 0.85 + WHISPER_WEIGHTS.duration * timing
    );
  }
  return best;
}

function rescore(prepared, frames, templates, table, end, exponent) {
  const width = frames.melBands + 1;
  const input = new Float32Array(POINTS.length * width);
  const spectrum = whisperSpectrum(frames, 0, end);
  const { times, spans } = prepared;
  return {
    times,
    spans: spans.map((edges, from) =>
      edges.map((edge) => {
        if (!edge.whisper) {
          return edge;
        }
        const duration = times[edge.to] - times[from];
        for (const [i, position] of POINTS.entries()) {
          spectrum.sample(times[from] + position * duration, input, i * width);
        }
        const terms = new Float64Array(edge.terms.length);
        templates.forEach(({ kind }, unit) => {
          terms[unit * 3] = scoreUnit(
            input,
            table[unit],
            width,
            kind === 'vowel',
            exponent,
            duration
          );
        });
        return { ...edge, terms };
      })
    ),
  };
}

const totals = [0, ...variants].map((exponent) => ({
  exponent,
  edits: 0,
  phones: 0,
}));
for (const [language, text] of [
  ['en', 'she sees five sheep'],
  ['ru', 'Саша шла домой.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '请喝茶'],
  ['en', 'hello world'],
  ['en', 'a big dog'],
]) {
  const { samples, sampleRate, plan, head } = renderWhisper(
    `[whisper] ${text}`,
    language
  );
  const end = samples.length / sampleRate;
  const options = { language, voice: head, whisper: [{ start: 0, end }] };
  const settings = decoderSettings(sampleRate, options);
  const analysis = analyzeForDecode(samples, sampleRate, options, settings);
  const { prepared, templates } = prepareIpaDecode(analysis, settings);
  const table = whisperReferences(templates, settings, analysis.voice);
  const reference = asPhones(plannedPhones(plan));
  for (const total of totals) {
    const scored = total.exponent
      ? rescore(
          prepared,
          analysis.frames,
          templates,
          table,
          end,
          total.exponent
        )
      : prepared;
    const search = decodeSearch(scored, settings.language, {
      ...settings,
      lattice: false,
    });
    const result = resultOf(analysis, settings, scored, templates, search);
    const { distance, referenceLength } = errorRate(
      reference,
      asPhones(result.segments),
      'phone'
    );
    total.edits += distance;
    total.phones += referenceLength;
    console.log(
      language,
      text,
      total.exponent,
      distance,
      referenceLength,
      result.ipa,
      ipaToText(result.segments, { language }).text
    );
  }
}
console.log(totals);
