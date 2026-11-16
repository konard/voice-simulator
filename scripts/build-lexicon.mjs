#!/usr/bin/env node

/**
 * Build the pronunciation lexicons shipped in src/g2p/lexicon/ (issue 47).
 *
 *   node scripts/build-lexicon.mjs build <lang> --from <dir> [--words <n>]
 *     [--full --out <file>]
 *   node scripts/build-lexicon.mjs counts <lang> --text <dir> [--limit <n>]
 *   node scripts/build-lexicon.mjs coverage <lang> --text <dir> [--lines <n>]
 *   node scripts/build-lexicon.mjs convert --lang <lang> --in <tsv> --out <json>
 *
 * build en  <dir>/cmudict.dict (CMUdict, BSD-2-Clause): every variant in
 *           file order, converted with `arpabetToIpa()`, equal variants
 *           merged; the first `--words` (default 20 000) words of
 *           data/lexicon/en-counts.txt found in CMUdict, plus all words of
 *           data/lexicon/en-extra.txt, which win over CMUdict. `--full`
 *           writes every word as JSON to `--out` (outside src/) instead.
 * build zh  <dir>/Unihan_Readings.txt or <dir>/Unihan.zip (Unicode-3.0) and
 *           the AISHELL-3 transcript `--aishell <file>` (default
 *           <dir>/content.txt, Apache-2.0); words from
 *           data/lexicon/zh-phrases.txt and mined AISHELL-3 pairs; every
 *           tenth line (0, 10, ...) is held out from mining.
 * build hi  data/lexicon/hi-words.txt (no --from).
 * build ru  data/lexicon/ru-stress.txt (no --from), `+` before the stressed
 *           vowel.
 * counts    `word count` lines of the words of the `.txt` files in --text,
 *           most frequent first, written to data/lexicon/<lang>-counts.txt.
 * coverage  the share of running words not read by the letter rules and
 *           the 50 most frequent words that are.
 * convert   a tab-separated `word<TAB>pronunciation` file to the JSON
 *           format of `--full`, for `--lexicon` and `addLexicon()`.
 *
 * The inputs are listed with their licences in data/lexicon/sources.json.
 */

import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { compareCodePoints, encodeVslex } from '../src/g2p/vslex.js';
import {
  readCmudict,
  readCounts,
  readWordList,
  textFiles,
  textWords,
  unihanReadings,
  unihanReadingsText,
} from './lexicon-sources.mjs';
import { handPhrases, minePairs, readingGroups } from './lexicon-zh.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'lexicon');
const OUTPUT = join(ROOT, 'src', 'g2p', 'lexicon');
const RUSSIAN_VOWELS = 'аеёиоуыэюя';
const PAYLOAD_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Parse `--name value` and `--flag` options after the positional ones. */
export function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options[name] = true;
    } else {
      options[name] = next;
      index++;
    }
  }
  return { positional, options };
}

async function formatModule(path, source) {
  const prettier = await import('prettier');
  const config = (await prettier.resolveConfig(path)) ?? {};
  return prettier.format(source, { ...config, filepath: path });
}

/**
 * Write a generated module with a header comment and named exports.
 * @param {string} path
 * @param {string[]} header comment lines
 * @param {[string, object][]} exports
 */
async function writeModule(path, header, exports) {
  const comment = [
    '/**',
    ...header.map((line) => ` * ${line}`.trimEnd()),
    ' */',
  ];
  const body = exports
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
    .join('\n\n');
  const source = `${comment.join('\n')}\n\n${body}\n`;
  writeFileSync(path, await formatModule(path, source));
  return readFileSync(path).length;
}

/** The JSON format of `--full` and `convert`. */
export function fullLexicon(lang, entries) {
  const sorted = [...entries].sort(([a], [b]) => compareCodePoints(a, b));
  return {
    format: 'lexicon',
    version: 1,
    lang,
    count: sorted.length,
    words: Object.fromEntries(sorted),
  };
}

function writeFull(lang, entries, out) {
  if (!out) {
    throw new RangeError('--full needs --out <file>');
  }
  const target = resolve(out);
  if (!relative(join(ROOT, 'src'), target).startsWith('..')) {
    throw new RangeError(
      '--out must be outside src/: the full lexicon is not shipped'
    );
  }
  const data = fullLexicon(lang, entries);
  writeFileSync(target, `${JSON.stringify(data)}\n`);
  console.log(`${lang}: ${data.count} words written to ${out}`);
}

/** English: ranked CMUdict words plus en-extra.txt. */
async function buildEnglish(options) {
  const from = requireOption(options, 'from');
  const cmudict = readCmudict(join(from, 'cmudict.dict'));
  const extra = readWordList(join(DATA, 'en-extra.txt'));
  if (options.full) {
    const all = new Map([...cmudict, ...extra]);
    writeFull('en', all, options.out);
    return;
  }
  const limit = Number(options.words ?? 20000);
  const selected = new Map();
  for (const word of readCounts(join(DATA, 'en-counts.txt'))) {
    if (selected.size >= limit) {
      break;
    }
    if (cmudict.has(word)) {
      selected.set(word, cmudict.get(word));
    }
  }
  for (const [word, variants] of extra) {
    selected.set(word, variants);
  }
  const lexicon = encodeVslex('en', selected);
  const bytes = await writeModule(
    join(OUTPUT, 'en.js'),
    [
      `${lexicon.count} English words in General American IPA, every CMUdict`,
      'variant in file order (the first is the default).',
      '',
      'Generated by `node scripts/build-lexicon.mjs build en --from <dir>`',
      'from the CMU Pronouncing Dictionary (Copyright (C) 1993-2015 Carnegie',
      'Mellon University, BSD-2-Clause, see NOTICE.md), ranked by',
      'data/lexicon/en-counts.txt, and data/lexicon/en-extra.txt. Format:',
      'vslex, see src/g2p/vslex.js. Do not edit by hand.',
    ],
    [['EN_LEXICON', lexicon]]
  );
  console.log(`en: ${lexicon.count} words, ${bytes} bytes`);
}

/** Chinese: readings of every character and words with their readings. */
async function buildChinese(options) {
  const from = requireOption(options, 'from');
  const readings = unihanReadings(unihanReadingsText(from));
  const hand = handPhrases(
    readWordList(join(DATA, 'zh-phrases.txt')),
    readings
  );
  const aishell = options.aishell ?? join(from, 'content.txt');
  const lines = readFileSync(aishell, 'utf8').split('\n').filter(Boolean);
  const mined = minePairs(
    lines.filter((_, index) => index % 10 !== 0),
    readings
  );
  const words = new Map(mined);
  for (const [word, payload] of hand) {
    words.set(word, payload);
  }
  const readingLexicon = readingGroups(readings);
  const phraseLexicon = encodeVslex(
    'zh',
    [...words].map(([word, payload]) => [word, [payload]])
  );
  const bytes = await writeModule(
    join(OUTPUT, 'zh.js'),
    [
      `ZH_READINGS: the readings of the ${readingLexicon.count} characters of the`,
      'Table of General Standard Chinese Characters (2013), Unihan kMandarin',
      'first, then the other kTGHZ2013 readings, as space separated',
      '`reading,reading=characters` groups.',
      `ZH_PHRASES: ${phraseLexicon.count} words of 2 to 4 characters, ${hand.size}`,
      `hand-written (data/lexicon/zh-phrases.txt) and ${phraseLexicon.count - hand.size} character pairs`,
      'of AISHELL-3 transcripts. One payload letter per character: `a` is the',
      'first reading of ZH_READINGS, `b` the second; upper case is the same',
      'reading in the neutral tone.',
      '',
      'Generated by `node scripts/build-lexicon.mjs build zh --from <dir>`',
      'from Unihan 17.0.0 (Unicode, Inc., Unicode-3.0) and AISHELL-3',
      '(Beijing Shell Shell Technology Co., Ltd., Apache-2.0), see NOTICE.md.',
      'ZH_PHRASES format: vslex, see src/g2p/vslex.js. Do not edit by hand.',
    ],
    [
      ['ZH_READINGS', readingLexicon],
      ['ZH_PHRASES', phraseLexicon],
    ]
  );
  console.log(
    `zh: ${readingLexicon.count} characters, ${phraseLexicon.count} words ` +
      `(${hand.size} hand-written, ${mined.size} mined), ${bytes} bytes`
  );
}

/** Hindi: hand-written words where the schwa deletion rules fail. */
async function buildHindi() {
  const words = readWordList(join(DATA, 'hi-words.txt'));
  const lexicon = encodeVslex('hi', words);
  const bytes = await writeModule(
    join(OUTPUT, 'hi.js'),
    [
      `${lexicon.count} Hindi words that the schwa deletion rules of hindi.js`,
      'read wrongly (compounds, plurals, loan words).',
      '',
      'Generated by `node scripts/build-lexicon.mjs build hi` from the',
      'hand-written data/lexicon/hi-words.txt (Unlicense). Format: vslex, see',
      'src/g2p/vslex.js. Do not edit by hand.',
    ],
    [['HI_LEXICON', lexicon]]
  );
  console.log(`hi: ${lexicon.count} words, ${bytes} bytes`);
}

/**
 * The stress payload of a Russian word with `+` before the stressed vowel:
 * the number of that vowel as a letter (`a` first), `z` when it is the
 * last of two or more vowels.
 * @param {string} marked
 * @returns {[string, string]} word and payload
 */
export function russianStressEntry(marked) {
  const plus = marked.indexOf('+');
  const word = marked.replace('+', '');
  const vowels = [...word].filter((char) =>
    RUSSIAN_VOWELS.includes(char)
  ).length;
  const index = [...marked.slice(0, plus)].filter((char) =>
    RUSSIAN_VOWELS.includes(char)
  ).length;
  if (plus < 0 || !RUSSIAN_VOWELS.includes(marked[plus + 1] ?? '')) {
    throw new TypeError(`ru-stress.txt: "${marked}" needs + before a vowel`);
  }
  return [
    word,
    index === vowels - 1 && vowels > 1 ? 'z' : PAYLOAD_LETTERS[index],
  ];
}

/** Russian: the stress container (the data of issue 48 goes here). */
async function buildRussian() {
  const entries = readFileSync(join(DATA, 'ru-stress.txt'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((marked) => {
      const [word, payload] = russianStressEntry(marked.normalize('NFC'));
      return [word, [payload]];
    });
  const lexicon = encodeVslex('ru', entries);
  const bytes = await writeModule(
    join(OUTPUT, 'ru.js'),
    [
      `RU_STRESS: the stressed vowel of ${lexicon.count} Russian words: \`a\` the`,
      'first vowel, `b` the second, `z` the last of two or more.',
      '',
      'Generated by `node scripts/build-lexicon.mjs build ru` from the',
      'hand-written data/lexicon/ru-stress.txt (Unlicense). Format: vslex,',
      'see src/g2p/vslex.js. Do not edit by hand.',
    ],
    [['RU_STRESS', lexicon]]
  );
  console.log(`ru: ${lexicon.count} words, ${bytes} bytes`);
}

const BUILDERS = {
  en: buildEnglish,
  zh: buildChinese,
  hi: buildHindi,
  ru: buildRussian,
};

function requireOption(options, name) {
  if (typeof options[name] !== 'string') {
    throw new RangeError(`--${name} <value> is required`);
  }
  return options[name];
}

/** Lines of the `.txt` files under `dir`, read as a stream. */
async function* textLines(dir) {
  for (const file of textFiles(dir)) {
    const lines = createInterface({
      input: createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      yield line;
    }
  }
}

/**
 * Count the words of running text.
 * @returns {Promise<[string, number][]>} most frequent first, then by code
 *   point
 */
export async function countWords(lang, lines, limit = 50000) {
  const counts = new Map();
  for await (const line of lines) {
    for (const word of textWords(lang, line)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || compareCodePoints(a, b))
    .slice(0, limit);
}

async function runCounts(lang, options) {
  const text = requireOption(options, 'text');
  const limit = Math.min(Number(options.limit ?? 50000), 50000);
  const counted = await countWords(lang, textLines(text), limit);
  const out = options.out ?? join(DATA, `${lang}-counts.txt`);
  writeFileSync(
    out,
    counted.map(([word, count]) => `${word} ${count}\n`).join('')
  );
  console.log(
    `${lang}: ${counted.length} words written to ${relative(ROOT, out)}`
  );
}

async function runCoverage(lang, options) {
  const { coverage } = await import('./lexicon-metrics.mjs');
  const text = requireOption(options, 'text');
  const limit = Number(options.lines ?? Infinity);
  const lines = [];
  for await (const line of textLines(text)) {
    if (lines.length >= limit) {
      break;
    }
    lines.push(line);
  }
  const result = coverage(lang, lines);
  console.log(
    `${lang}: ${lines.length} lines, ${result.words} words, ` +
      `${(100 * result.share).toFixed(2)} % not from rules`
  );
  console.log(
    result.missing.map(([word, count]) => `${word} ${count}`).join('\n')
  );
}

function runConvert(options) {
  const lang = requireOption(options, 'lang');
  const input = requireOption(options, 'in');
  const entries = new Map();
  readFileSync(input, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (!line.trim() || line.startsWith('#')) {
        return;
      }
      const [word, pronunciation] = line.split('\t');
      if (!word || !pronunciation) {
        throw new TypeError(
          `${input}:${index + 1}: expected word<TAB>pronunciation`
        );
      }
      const key = word.trim().normalize('NFC').toLowerCase();
      const variants = entries.get(key) ?? [];
      const value = pronunciation.trim().normalize('NFC');
      if (!variants.includes(value)) {
        variants.push(value);
      }
      entries.set(key, variants);
    });
  writeFull(lang, entries, requireOption(options, 'out'));
}

const USAGE = `Usage:
  node scripts/build-lexicon.mjs build <en|zh|hi|ru> [--from <dir>] [--words <n>] [--full --out <file>]
  node scripts/build-lexicon.mjs counts <lang> --text <dir> [--limit <n>] [--out <file>]
  node scripts/build-lexicon.mjs coverage <lang> --text <dir> [--lines <n>]
  node scripts/build-lexicon.mjs convert --lang <lang> --in <tsv> --out <json>`;

export async function main(argv) {
  const { positional, options } = parseArguments(argv);
  const [command, lang] = positional;
  if (command === 'build' && BUILDERS[lang]) {
    await BUILDERS[lang](options);
  } else if (command === 'counts' && lang) {
    await runCounts(lang, options);
  } else if (command === 'coverage' && lang) {
    await runCoverage(lang, options);
  } else if (command === 'convert') {
    runConvert(options);
  } else {
    console.error(USAGE);
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
