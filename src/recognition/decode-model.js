/** Planner templates and text-only phonotactics for IPA decoding. Unlicense. */
import { planRecognitionTemplate } from '../articulation/plan.js';
import { sampleState } from '../articulation/tract-shape.js';
import { listSymbols } from '../ipa/inventory.js';
import { formatIpa, parseIpa } from '../ipa/parse.js';
import { CODEBOOK_CHANNELS } from './codebook.js';
import { BROAD_CLASSES } from './landmarks.js';
import { SOURCE_CHANNELS } from './inversion-source.js';
import { PHONOTACTICS } from './phonotactics.js';

export const TEMPLATE_POINTS = [0.1, 0.3, 0.5, 0.7, 0.9];
export const TEMPLATE_CHANNELS = [
  ...CODEBOOK_CHANNELS.map(({ name }) => name),
  ...SOURCE_CHANNELS,
];
const rangeByName = new Map(
  CODEBOOK_CHANNELS.map(({ name, min, max }) => [name, max - min])
);
export const TEMPLATE_FLOORS = TEMPLATE_CHANNELS.map(
  (name) => (0.15 * (rangeByName.get(name) ?? 1)) ** 2
);

const VOWEL_CHANNELS = [
  'height',
  'backness',
  'rounding',
  'rhotic',
  'velum',
  'voicing',
];
const CONSONANT_CHANNELS = [
  'lipAmount',
  'tongueAmount',
  'velum',
  'voicing',
  'aspiration',
  'frication',
  'sibilance',
  'trill',
];

/** Representative broad class for edit distance on phone strings. */
export function phoneClass(token) {
  const { manner } = token.phoneme;
  if (token.kind === 'vowel') {
    return 'vowel';
  }
  if (token.affricate || manner === 'plosive' || manner === 'click') {
    return 'closure';
  }
  if (manner === 'fricative' || manner === 'lateral-fricative') {
    return token.voiced ? 'voiced-fricative' : 'voiceless-fricative';
  }
  return manner === 'nasal' ? 'nasal' : 'glide';
}

function allowedClasses(token) {
  const broad = phoneClass(token);
  if (broad === 'closure') {
    const classes = [
      'closure',
      'silence',
      'burst',
      'voiced-fricative',
      'voiceless-fricative',
    ];
    if (token.voiced && token.phoneme.manner === 'plosive') {
      classes.push('nasal');
    }
    return classes;
  }
  if (broad === 'voiceless-fricative') {
    return [broad, 'burst'];
  }
  return [broad, broad === 'glide' ? 'vowel' : 'glide'];
}

function comparedChannels(kind, state) {
  if (kind === 'vowel') {
    return VOWEL_CHANNELS;
  }
  const names = [...CONSONANT_CHANNELS];
  if (state.lipAmount > 0.5) {
    names.push('lipArea');
  }
  if (state.tongueAmount > 0.5) {
    names.push('tongueArea', 'tongueLocation');
  }
  return names;
}

function template(ipa, voice, articulationOffsets) {
  const token = parseIpa(ipa).tokens[0];
  const { kind } = token;
  const plan = planRecognitionTemplate(kind === 'vowel' ? ipa : `ə${ipa}ə`, {
    head: voice,
    articulationOffsets,
  });
  const segments = plan.segments.filter(
    (segment) => segment.token === plan.tokens[kind === 'vowel' ? 0 : 1]
  );
  const start = segments[0].start;
  const duration = segments.at(-1).end - start;
  const compared = [];
  const values = new Float64Array(
    TEMPLATE_CHANNELS.length * TEMPLATE_POINTS.length
  );
  TEMPLATE_POINTS.forEach((relative, point) => {
    const state = sampleState(plan, start + duration * relative);
    TEMPLATE_CHANNELS.forEach((name, col) => {
      values[point * TEMPLATE_CHANNELS.length + col] = state[name];
    });
    for (const name of comparedChannels(kind, state)) {
      compared.push(
        point * TEMPLATE_CHANNELS.length + TEMPLATE_CHANNELS.indexOf(name)
      );
    }
  });
  return {
    ipa,
    token,
    kind,
    // The planner already applied the voice's speech rate.
    duration,
    classMask: allowedClasses(token).reduce(
      (mask, name) => mask | (1 << BROAD_CLASSES.indexOf(name)),
      0
    ),
    compared,
    values,
  };
}

/** The same token identity as formatIpa, with prosody omitted. */
export function decoderUnit(token) {
  return formatIpa([
    {
      ...token,
      stress: 0,
      tone: null,
      symbol: token.symbol.replace(/[ːˑ]/gu, ''),
    },
  ]).normalize('NFC');
}

function languageTable(model) {
  const { units, counts } = model;
  const width = units.length + 1;
  const probabilities = new Float64Array(counts.length);
  for (let row = 0; row < counts.length; row += width) {
    let total = 0.5 * width;
    for (let col = 0; col < width; col++) {
      total += counts[row + col];
    }
    for (let col = 0; col < width; col++) {
      probabilities[row + col] = (counts[row + col] + 0.5) / total;
    }
  }
  const boundary = units.length;
  return {
    ids: new Map(units.map((unit, i) => [unit, i])),
    boundary,
    probability(a, b) {
      return probabilities[a * width + b];
    },
  };
}

const models = new Map(
  Object.entries(PHONOTACTICS).map(([language, model]) => [
    language,
    languageTable(model),
  ])
);

function probabilityFor(tables, a, b) {
  let best = 0;
  for (const { ids, boundary, probability } of tables) {
    const to = ids.get(b);
    if (to === undefined) {
      continue;
    }
    const from = a === undefined ? boundary : ids.get(a);
    // A different language can start a word after a phone outside its inventory.
    const across =
      (from === undefined ? 1 : probability(from, boundary)) *
      probability(boundary, to);
    const within = from === undefined ? 0 : probability(from, to);
    best = Math.max(best, within, across);
  }
  return best;
}

const languageTables = new Map();

export function decoderLanguage(options) {
  const languages = [
    ...new Set(
      options.languages ?? (options.language ? [options.language] : [])
    ),
  ].sort();
  for (const language of languages) {
    if (!models.has(language)) {
      throw new RangeError(`Unsupported decoder language: ${language}`);
    }
  }
  const key = languages.join(',');
  if (!languageTables.has(key)) {
    languageTables.set(key, decoderLanguageTable(languages));
  }
  return {
    ...languageTables.get(key),
    language:
      options.language ?? (languages.length === 1 ? languages[0] : undefined),
  };
}

function decoderLanguageTable(languages) {
  const source = languages.map((language) => PHONOTACTICS[language]);
  const symbols = source.length
    ? [...new Set(source.flatMap(({ units }) => units))].sort()
    : [
        ...new Set(
          listSymbols().map((ipa) => decoderUnit(parseIpa(ipa).tokens[0]))
        ),
      ];
  const width = symbols.length;
  const costs = new Float64Array((width + 1) * width);
  if (source.length) {
    const tables = languages.map((language) => models.get(language));
    for (let from = 0; from <= width; from++) {
      for (let to = 0; to < width; to++) {
        costs[from * width + to] = -Math.log(
          probabilityFor(tables, symbols[from], symbols[to])
        );
      }
    }
  }
  return {
    symbols,
    costs,
    long: new Set(source.flatMap((model) => model.long)),
  };
}

const cached = new Map();

export function decoderTemplates(voice, symbols, articulationOffsets) {
  const key = JSON.stringify([voice, articulationOffsets]);
  if (!cached.has(key)) {
    if (cached.size >= 8) {
      cached.delete(cached.keys().next().value);
    }
    cached.set(key, new Map());
  }
  const templates = cached.get(key);
  return symbols.map((ipa) => {
    if (!templates.has(ipa)) {
      templates.set(ipa, template(ipa, voice, articulationOffsets));
    }
    return templates.get(ipa);
  });
}
