/** Dataset loading and scoring shared by the real-speech benchmark and tests. */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  DatasetError,
  EXIT,
  fetchDataset,
  readDataset,
} from '../../../scripts/datasets.mjs';
import { decodeAudio } from '../../../src/audio/formats.js';
import { textToIpa } from '../../../src/g2p/index.js';
import { parseIpa } from '../../../src/ipa/parse.js';
import { syllabifyIpa } from '../../../src/ipa/syllables.js';
import { alignEdits, errorRate } from '../../../src/metrics/text.js';
import { datasetSkipReason } from '../../helpers/datasets.js';

export { checkBaseline } from './benchmark-baseline.js';

export const BENCHMARK = JSON.parse(
  readFileSync(
    new URL('../../../datasets/benchmark.json', import.meta.url),
    'utf8'
  )
);

export async function fetchBenchmarkSource(id, options = {}) {
  let source;
  try {
    const reason = await datasetSkipReason(id, {
      ...options,
      // Use the checksum-verified download with retries as the availability
      // probe. A single HEAD timeout can skip a corpus whose rows are usable.
      probe: async () => {
        source = await fetchDataset(id, options);
        return null;
      },
    });
    return reason
      ? { reason }
      : { source: source ?? (await fetchDataset(id, options)) };
  } catch (error) {
    if (!(error instanceof DatasetError) || error.code !== EXIT.network) {
      throw error;
    }
    return { reason: 'download failed after retries' };
  }
}

export async function loadBenchmark({ set, limit }) {
  const config =
    typeof set === 'string' ? BENCHMARK.sets.find(({ id }) => id === set) : set;
  if (!config) {
    throw new RangeError(`Unknown benchmark set "${set}"`);
  }
  const { id, language, rows } = config;
  const count = Math.min(rows, limit ?? rows);
  await fetchDataset(id, { limit: count });
  const recordings = readDataset(id).slice(0, count);
  if (recordings.length !== count) {
    throw new Error(`${id}: loaded ${recordings.length} of ${count} rows`);
  }
  return recordings.map(({ id: rowId, text, audioPath }) => {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`${rowId}: missing reference transcript`);
    }
    const { samples, sampleRate } = decodeAudio(readFileSync(audioPath));
    return { id: rowId, language, text, samples, sampleRate };
  });
}

export function normalizeForScoring(text, language) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/ё/gu, 'е')
    .trim()
    .replace(/\s+/gu, language === 'zh' ? '' : ' ');
}

const MANNER_CLASS = new Map([
  ['plosive', 'P'],
  ['click', 'P'], // Closure and release are grouped with the stops.
  ['fricative', 'F'],
  ['lateral-fricative', 'F'],
  ['nasal', 'N'],
  ['trill', 'L'],
  ['tap', 'L'],
  ['approximant', 'L'],
  ['lateral-approximant', 'L'],
]);

function broadClass(token) {
  if (token.kind === 'vowel') {
    return 'V';
  }
  return token.affricate ? 'A' : MANNER_CLASS.get(token.phoneme.manner);
}

function phones(ipa) {
  // The parser keeps stress and tones as properties of the segment. Its
  // symbol carries segmental length/diacritics and omits both properties.
  return parseIpa(ipa).tokens.filter(
    ({ kind }) => kind === 'vowel' || kind === 'consonant'
  );
}

export function phoneClass(symbol) {
  const [token] = phones(symbol);
  return token && broadClass(token);
}

const TONES = /[˥˦˧˨˩]/gu;

export function toneSyllables(ipa) {
  return syllabifyIpa(ipa, { language: 'zh' })
    .flat()
    .map((syllable) => ({
      base: syllable.replace(/[ˈˌ˥˦˧˨˩]/gu, ''),
      tone: syllable.match(TONES)?.join('') ?? '',
    }));
}

export function compareSyllableTones(reference, hypothesis) {
  const { pairs } = alignEdits(
    reference.map(({ base }) => base),
    hypothesis.map(({ base }) => base)
  );
  const errors = pairs.reduce(
    (sum, [i, j]) => sum + Number(reference[i].tone !== hypothesis[j].tone),
    0
  );
  return { errors, length: pairs.length };
}

export function toneErrors(reference, hypothesis) {
  return compareSyllableTones(
    toneSyllables(reference),
    toneSyllables(hypothesis)
  );
}

export function prepareReference(row, language) {
  if (/\p{Nd}/u.test(row.text)) {
    return null;
  }
  const ipa = textToIpa(row.text, { lang: language }).ipa;
  const tokens = phones(ipa);
  return {
    text: normalizeForScoring(row.text, language),
    symbols: tokens.map(({ symbol }) => symbol),
    classes: tokens.map(broadClass),
    tones: language === 'zh' ? toneSyllables(ipa) : null,
  };
}

function editCounts(reference, hypothesis, unit) {
  const { distance, referenceLength } = errorRate(reference, hypothesis, unit);
  return { errors: distance, length: referenceLength };
}

export function scoreUtterance(
  row,
  result,
  language,
  { reference = prepareReference(row, language), onConfusion } = {}
) {
  if (reference === null) {
    return null;
  }
  const hypothesis = normalizeForScoring(result.text, language);
  const tokens = phones(result.ipa);
  const symbols = tokens.map(({ symbol }) => symbol);
  const { distance, pairs } = alignEdits(reference.symbols, symbols);
  if (onConfusion) {
    for (const [i, j] of pairs) {
      if (reference.symbols[i] !== symbols[j]) {
        onConfusion(reference.symbols[i], symbols[j]);
      }
    }
  }
  return {
    wer:
      language === 'zh' ? null : editCounts(reference.text, hypothesis, 'word'),
    cer: editCounts(reference.text, hypothesis, 'char'),
    per: { errors: distance, length: reference.symbols.length },
    classErr: editCounts(reference.classes, tokens.map(broadClass)),
    toneErr: reference.tones
      ? compareSyllableTones(reference.tones, toneSyllables(result.ipa))
      : null,
    languageRight: result.languages?.[0]?.language === language,
  };
}
