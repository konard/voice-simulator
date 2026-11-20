/** Measure whisper phone errors with known timing and neighboring phones. Unlicense. */
import { analyzeFrames, errorRate, synthesize } from '../src/index.js';
import {
  decoderLanguage,
  decoderTemplates,
} from '../src/recognition/decode-model.js';
import {
  whisperDistance,
  whisperReferences,
  WHISPER_WEIGHTS,
} from '../src/recognition/whisper-decode.js';
import { whisperSpectrum } from '../src/recognition/whisper-spectrum.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';
import { renderWhisper } from './issue-72-whisper-robustness.mjs';

const progress = [0.1, 0.3, 0.5, 0.7, 0.9];
const base = (ipa) => ipa.replace(/[ˈˌː˥˦˧˨˩]/gu, '');
const entries = [
  ['en', 'she sees five sheep'],
  ['ru', 'Саша шла домой.'],
  ['hi', 'नमस्ते दुनिया'],
  ['zh', '请喝茶'],
  ['en', 'hello world'],
  ['en', 'a big dog'],
];

function phoneSpectrum(frames) {
  const width = frames.melBands + 1;
  const spectrum = whisperSpectrum(frames, 0, frames.sampleCount / frames.rate);
  return (phoneStart, phoneEnd) => {
    const output = new Float32Array(width * progress.length);
    const duration = phoneEnd - phoneStart;
    progress.forEach((point, i) =>
      spectrum.sample(phoneStart + duration * point, output, i * width)
    );
    return { duration, values: output };
  };
}

function contextualReference(ipa, before, after, head, settings) {
  // Use a different noise realization from the seed-1 evaluation utterances.
  const audio = synthesize(`{W ${before}${ipa}${after} W}`, {
    head,
    ipa: true,
    tier: 'minimal',
    engine: 'js',
    seed: 2,
  });
  const token = audio.plan.tokens[Number(Boolean(before))];
  const segments = audio.plan.segments.filter(
    (segment) => segment.token === token
  );
  const frames = analyzeFrames(audio.samples, audio.sampleRate, settings);
  return phoneSpectrum(frames)(segments[0].start, segments.at(-1).end);
}

function score(input, { values, duration }, kind, width) {
  return (
    8 *
      input.duration *
      whisperDistance(input.values, values, width, kind === 'vowel') +
    2 * WHISPER_WEIGHTS.duration * Math.log(input.duration / duration) ** 2
  );
}

const settings = { rate: 16000, hop: 0.005 };
let total = 0;
let defaultErrors = 0;
let contextErrors = 0;
for (const [language, phrase] of entries) {
  const audio = renderWhisper(`[whisper] ${phrase}`, language);
  const frames = analyzeFrames(audio.samples, audio.sampleRate, settings);
  const spectrum = phoneSpectrum(frames);
  const width = frames.melBands + 1;
  const templates = decoderTemplates(
    audio.head,
    decoderLanguage({ language }).symbols
  );
  const table = whisperReferences(templates, settings, audio.head);
  const reference = plannedPhones(audio.plan);
  const contextual = new Map();
  const defaultPhones = [];
  const contextPhones = [];
  for (const [i, { start, end }] of reference.entries()) {
    const input = spectrum(start, end);
    // Read adjacent labels from the reference plan only for this oracle.
    const before =
      i > 0 && start - reference[i - 1].end < 1e-6
        ? base(reference[i - 1].ipa)
        : '';
    const after =
      i + 1 < reference.length && reference[i + 1].start - end < 1e-6
        ? base(reference[i + 1].ipa)
        : '';
    let defaultCost = Infinity;
    let contextCost = Infinity;
    for (const [j, { ipa, kind }] of templates.entries()) {
      const usual = Math.min(
        ...table[j].map((ref) => score(input, ref, kind, width))
      );
      if (usual < defaultCost) {
        defaultCost = usual;
        defaultPhones[i] = ipa;
      }
      const key = `${before}\t${ipa}\t${after}`;
      if (!contextual.has(key)) {
        contextual.set(
          key,
          contextualReference(ipa, before, after, audio.head, settings)
        );
      }
      const matched = score(input, contextual.get(key), kind, width);
      if (matched < contextCost) {
        contextCost = matched;
        contextPhones[i] = ipa;
      }
    }
  }
  const phones = (symbols) => symbols.map(base).join(' ');
  const expected = phones(reference.map(({ ipa }) => ipa));
  const error = (hypothesis) =>
    errorRate(expected, phones(hypothesis), 'phone').distance;
  total += reference.length;
  defaultErrors += error(defaultPhones);
  contextErrors += error(contextPhones);
  console.log(
    language,
    phrase,
    expected,
    phones(defaultPhones),
    phones(contextPhones),
    error(defaultPhones),
    error(contextPhones)
  );
}
console.log({ total, defaultErrors, contextErrors });
