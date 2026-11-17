#!/usr/bin/env node
/**
 * Offline count builder. Usage:
 * node scripts/build-recognition-data.mjs --text /path/to/corpus
 * node scripts/build-recognition-data.mjs --text '/path/to/corpus/en/*.txt'
 * Inputs are UTF-8 text, one directory per language. No network access.
 * Lexicon words absent from the corpus get a count of one (a vocabulary
 * prior, never a fabricated corpus occurrence). Corpus totals are separate.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { lexiconWords } from '../src/g2p/lexicon.js';
import { characterReadings } from '../src/g2p/chinese-readings.js';
import { parseIpa } from '../src/ipa/parse.js';
import { normalizeText } from '../src/g2p/normalize.js';
import {
  checkLanguage,
  pronounce,
  RECOGNITION_LANGUAGES,
} from '../src/recognition/languages.js';

/** Tokenisation is explicit and independent of the host's ICU version. */
export function corpusWords(text, language, vocabulary = new Set()) {
  let normalized = text.normalize('NFC').toLowerCase().replaceAll('’', "'");
  // Modern spelling of pre-1918 Russian texts; do not split words at ять.
  if (language === 'ru') {
    normalized = normalized
      .replaceAll('ѣ', 'е')
      .replace(/[іѵ]/gu, 'и')
      .replaceAll('ѳ', 'ф')
      .replace(/ъ(?=$|[^а-яё])/gu, '');
  }
  if (language === 'hi') {
    normalized = normalized.replace(/[\p{Number}\p{Punctuation}]/gu, ' ');
  }
  const patterns = {
    en: /[a-z]+(?:'[a-z]+)*/g,
    ru: /[а-яё]+/g,
    hi: /[\p{Script=Devanagari}\p{Mark}]+/gu,
    zh: /\p{Script=Han}+/gu,
  };
  const runs = normalized.match(patterns[language]) ?? [];
  if (language !== 'zh') {
    return runs;
  }
  // Longest known word, then a character. No external segmenter or model.
  return runs.flatMap((run) => {
    const chars = [...run];
    const words = [];
    for (let i = 0; i < chars.length; ) {
      let length = Math.min(4, chars.length - i);
      while (
        length > 1 &&
        !vocabulary.has(chars.slice(i, i + length).join(''))
      ) {
        length--;
      }
      words.push(chars.slice(i, i + length).join(''));
      i += length;
    }
    return words;
  });
}

const order = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

function isSpokenWord(word, language) {
  const items = normalizeText(word, {
    lang: language,
    wordLanguage: () => language,
  });
  return (
    items.length > 0 &&
    items.every((item) => item.kind === 'word' && !item.sound)
  );
}

/** Learn recurring short expressions, then count non-overlapping words.
 * Association across every internal split keeps independent neighbours
 * from becoming words. Established lexicon phrases always remain eligible.
 */
function chineseSubstrings(files) {
  const counts = new Map();
  const texts = [];
  const sources = [];
  let characters = 0;
  const readings = characterReadings();
  for (const file of [...files].sort()) {
    const bytes = readFileSync(file);
    sources.push({
      file: basename(file),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const text = bytes.toString('utf8');
    texts.push(text);
    for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
      const chars = [...run];
      for (let i = 0; i < chars.length; i++) {
        if (readings.has(chars[i])) {
          characters++;
        }
        for (let n = 1; n <= 4 && i + n <= chars.length; n++) {
          const slice = chars.slice(i, i + n);
          if (!slice.every((char) => readings.has(char))) {
            break;
          }
          const word = slice.join('');
          counts.set(word, (counts.get(word) ?? 0) + 1);
        }
      }
    }
  }
  return { counts, texts, sources, characters, readings };
}

function chineseVocabulary(counts, characters, vocabulary) {
  const segmentation = new Set(vocabulary);
  for (const [word, count] of counts) {
    if (word.length !== 2 || count < 3) {
      continue;
    }
    let cohesion = Infinity;
    for (let i = 1; i < word.length; i++) {
      cohesion = Math.min(
        cohesion,
        (count * characters) /
          (counts.get(word.slice(0, i)) * counts.get(word.slice(i)))
      );
    }
    if (cohesion >= 1) {
      segmentation.add(word);
    }
  }
  return segmentation;
}

function segmentedChineseCounts(texts, segmentation, readings, vocabulary) {
  const wordCounts = new Map();
  const pairs = new Map();
  const accepted = new Map();
  let total = 0;
  for (const text of texts) {
    for (const sentence of text.split(/[。！？\n]+/u)) {
      let previous = null;
      for (const word of corpusWords(sentence, 'zh', segmentation)) {
        if (!accepted.has(word)) {
          accepted.set(
            word,
            [...word].every((char) => readings.has(char)) &&
              isSpokenWord(word, 'zh')
          );
        }
        if (!accepted.get(word)) {
          previous = null;
          continue;
        }
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
        total++;
        if (previous) {
          const pair = `${previous}\t${word}`;
          pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
        }
        previous = word;
      }
    }
  }
  for (const word of vocabulary) {
    if (!wordCounts.has(word) && isSpokenWord(word, 'zh')) {
      wordCounts.set(word, 1);
    }
  }
  return { wordCounts, pairs, total };
}

function chineseCounts(files, vocabulary) {
  const { counts, texts, sources, characters, readings } =
    chineseSubstrings(files);
  const segmentation = chineseVocabulary(counts, characters, vocabulary);
  const { wordCounts, pairs, total } = segmentedChineseCounts(
    texts,
    segmentation,
    readings,
    vocabulary
  );
  // A standalone character cannot distinguish exact homophones. Keep its
  // most frequent spelling; multi-character expressions retain the other
  // characters wherever context supplies the missing information. The
  // fallback inverse still covers the full character reading inventory.
  const standalone = new Set();
  const words = [...wordCounts]
    .sort(order)
    .filter(([word]) => {
      if (word.length !== 1) {
        return true;
      }
      const ipa = pronounce(word, 'zh').ipa;
      if (standalone.has(ipa)) {
        return false;
      }
      standalone.add(ipa);
      return true;
    })
    .slice(0, 20000);
  const indices = new Map(words.map(([word], i) => [word, i]));
  const bigrams = [...pairs]
    .filter(
      ([pair, count]) =>
        count >= 3 && pair.split('\t').every((word) => indices.has(word))
    )
    .sort(order)
    .slice(0, 40000)
    .map(([pair, count]) => [
      pair
        .split('\t')
        .map((word) => indices.get(word))
        .join(','),
      count,
    ]);
  return { words, bigrams, total, sources };
}

/** Build one language without ever needing the source texts at runtime. */
export function buildCounts(files, language) {
  checkLanguage(language);
  const vocabulary = new Set(lexiconWords(language));
  if (language === 'zh') {
    for (const char of characterReadings().keys()) {
      vocabulary.add(char);
    }
    return chineseCounts(files, vocabulary);
  }
  const counts = new Map();
  const pairs = new Map();
  const accepted = new Map();
  const sources = [];
  let total = 0;
  function accepts(word) {
    if (!accepted.has(word)) {
      const ipa = pronounce(word, language).ipa;
      const parsed = parseIpa(ipa);
      accepted.set(
        word,
        Boolean(ipa) &&
          parsed.unknown.length === 0 &&
          parsed.tokens.some(
            (t) => t.kind === 'vowel' || t.kind === 'consonant'
          )
      );
    }
    return accepted.get(word);
  }
  for (const file of [...files].sort()) {
    const bytes = readFileSync(file);
    sources.push({
      file: basename(file),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    // Never bridge sentences or files with a bigram.
    for (const sentence of bytes.toString('utf8').split(/[.!?。！？।\n]+/u)) {
      let previous = null;
      for (const word of corpusWords(sentence, language, vocabulary)) {
        if (!accepts(word)) {
          previous = null;
          continue;
        }
        counts.set(word, (counts.get(word) ?? 0) + 1);
        total++;
        if (previous) {
          const key = `${previous}\t${word}`;
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        }
        previous = word;
      }
    }
  }
  for (const word of vocabulary) {
    if (!counts.has(word) && accepts(word)) {
      counts.set(word, 1);
    }
  }
  // Reserve room for the established lexicons, then fill with corpus words.
  // Otherwise a literary corpus can displace everyday words such as hello.
  const usable = [...counts]
    .sort(order)
    .filter(([word]) => isSpokenWord(word, language));
  const reserved = usable
    .filter(([word]) => vocabulary.has(word))
    .slice(0, 18000);
  const selected = new Map(reserved);
  for (const [word, count] of usable) {
    if (selected.size === 20000) {
      break;
    }
    selected.set(word, count);
  }
  const words = [...selected].sort(order);
  const indices = new Map(words.map(([word], i) => [word, i]));
  const bigrams = [...pairs]
    .filter(
      ([pair, count]) =>
        count >= 3 && pair.split('\t').every((word) => indices.has(word))
    )
    .sort(order)
    .slice(0, 40000)
    .map(([pair, count]) => [
      pair
        .split('\t')
        .map((word) => indices.get(word))
        .join(','),
      count,
    ]);
  return { words, bigrams, total, sources };
}

function dataString(name, entries) {
  if (!entries.length) {
    return `export const ${name} = '';\n`;
  }
  const items = entries.map(([key, value]) => `${key}=${value}`);
  const lines = [];
  let line = '';
  for (const item of items) {
    if (line.length + item.length > 1600) {
      lines.push(line);
      line = '';
    }
    line += `${line ? ' ' : ''}${item}`;
  }
  if (line) {
    lines.push(line);
  }
  return `export const ${name} =\n  ${lines.map((s, i) => JSON.stringify(s + (i < lines.length - 1 ? ' ' : ''))).join(' +\n  ')};\n`;
}

export function writeCounts(data, language, out) {
  mkdirSync(out, { recursive: true });
  let source = `/** Generated by scripts/build-recognition-data.mjs; public-domain counts. */\n`;
  source +=
    '/* eslint local/no-changelog-comments: ["warn", {"checkStrings": false}] -- Corpus words are data. */\n';
  source += `export const CORPUS_WORDS = ${data.total};\n`;
  source +=
    dataString('WORDS', data.words) + dataString('BIGRAMS', data.bigrams);
  if (Buffer.byteLength(source) > 800000) {
    throw new Error(`${language}: counts exceed 800 kB`);
  }
  writeFileSync(join(out, `${language}.js`), source);
}

function main() {
  const args = process.argv.slice(2);
  const pattern = args[args.indexOf('--text') + 1];
  if (!args.includes('--text') || !pattern) {
    throw new Error(
      'usage: build-recognition-data.mjs --text <dir> or <dir>/<lang>/*.txt'
    );
  }
  const output = args.includes('--out')
    ? resolve(args[args.indexOf('--out') + 1])
    : fileURLToPath(
        new globalThis.URL('../src/recognition/data/', import.meta.url)
      );
  const wildcard = pattern.includes('*');
  const languages = wildcard
    ? [basename(dirname(pattern))]
    : RECOGNITION_LANGUAGES;
  for (const language of languages) {
    const match = wildcard ? basename(pattern) : '*.txt';
    const directory = wildcard ? dirname(pattern) : join(pattern, language);
    const expression = new RegExp(
      `^${match
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`
    );
    const files = readdirSync(directory, { withFileTypes: true })
      .filter((file) => file.isFile() && expression.test(file.name))
      .map((file) => join(directory, file.name));
    if (!files.length) {
      throw new Error(`no text files for ${language}`);
    }
    const data = buildCounts(files, language);
    if (data.total < 1000000) {
      throw new Error(
        `${language}: ${data.total} accepted words; need at least 1000000`
      );
    }
    writeCounts(data, language, output);
    console.log(
      JSON.stringify({
        language,
        corpusWords: data.total,
        words: data.words.length,
        bigrams: data.bigrams.length,
        sources: data.sources,
      })
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
