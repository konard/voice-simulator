/**
 * Readers for the inputs of scripts/build-lexicon.mjs (issue 47): the CMU
 * Pronouncing Dictionary, Unihan (plain or inside Unihan.zip), AISHELL-3
 * transcripts, word count lists and the hand-written data files of
 * data/lexicon/. None of the downloaded inputs is committed; see
 * data/lexicon/sources.json for their licences and pinned URLs.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const ARPABET_TO_IPA = {
  AA: 'ɑ',
  AE: 'æ',
  AH: 'ʌ',
  AO: 'ɔ',
  AW: 'aʊ',
  AY: 'aɪ',
  EH: 'ɛ',
  ER: 'ɝ',
  EY: 'eɪ',
  IH: 'ɪ',
  IY: 'i',
  OW: 'oʊ',
  OY: 'ɔɪ',
  UH: 'ʊ',
  UW: 'u',
  B: 'b',
  CH: 't͡ʃ',
  D: 'd',
  DH: 'ð',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  JH: 'd͡ʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  P: 'p',
  R: 'ɹ',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

/** Legal English syllable onsets, used to place stress marks. */
const ONSETS = new Set(
  (
    'P B T D K G F V TH DH S Z SH ZH HH M N L R W Y CH JH ' +
    'P_L P_R P_Y B_L B_R B_Y T_R T_W D_R D_W K_L K_R K_W K_Y G_L G_R G_W ' +
    'F_L F_R F_Y TH_R SH_R S_P S_T S_K S_M S_N S_L S_W S_F S_P_L S_P_R ' +
    'S_T_R S_K_R S_K_W S_K_Y M_Y N_Y V_Y HH_Y'
  )
    .split(' ')
    .map((onset) => onset.replaceAll('_', ' '))
);

function phoneToIpa(phone) {
  const base = phone.replace(/\d$/, '');
  const stress = phone.match(/\d$/)?.[0];
  if (base === 'AH' && stress === '0') {
    return 'ə';
  }
  if (base === 'ER' && stress === '0') {
    return 'ɚ';
  }
  const ipa = ARPABET_TO_IPA[base];
  if (ipa === undefined) {
    throw new TypeError(`unknown ARPAbet phone ${phone}`);
  }
  return ipa;
}

function onsetLength(consonants) {
  for (let length = Math.min(3, consonants.length); length > 0; length--) {
    if (ONSETS.has(consonants.slice(-length).join(' '))) {
      return length;
    }
  }
  return 0;
}

/**
 * Convert one ARPAbet pronunciation to IPA with ˈ/ˌ before the syllable
 * onset (maximal onset principle).
 * @param {string[]} phones
 */
export function arpabetToIpa(phones) {
  const output = [];
  let cluster = [];
  let first = true;
  for (const phone of phones) {
    const stress = phone.match(/\d$/)?.[0];
    if (stress === undefined) {
      cluster.push(phone);
      continue;
    }
    const onset = first ? cluster.length : onsetLength(cluster);
    const coda = cluster.slice(0, cluster.length - onset);
    const start = cluster.slice(cluster.length - onset);
    const mark = { 1: 'ˈ', 2: 'ˌ' }[stress] ?? '';
    output.push(
      ...coda.map(phoneToIpa),
      mark,
      ...start.map(phoneToIpa),
      phoneToIpa(phone)
    );
    cluster = [];
    first = false;
  }
  output.push(...cluster.map(phoneToIpa));
  return output.join('');
}

/**
 * Read cmudict.dict: every variant (`either`, `either(2)`) in file order,
 * converted to IPA; equal variants are merged.
 * @param {string} path
 * @returns {Map<string, string[]>}
 */
export function readCmudict(path) {
  const entries = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) {
      continue;
    }
    const [key, ...phones] = clean.split(/\s+/);
    const word = key.replace(/\(\d+\)$/, '');
    const ipa = arpabetToIpa(phones);
    const variants = entries.get(word) ?? [];
    if (!variants.includes(ipa)) {
      variants.push(ipa);
    }
    entries.set(word, variants);
  }
  return entries;
}

/**
 * Read a `word pronunciation` file of data/lexicon/: one variant per line,
 * `#` starts a comment. Lines of the same word add variants in order.
 * @param {string} path
 * @returns {Map<string, string[]>}
 */
export function readWordList(path) {
  const entries = new Map();
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const clean = line.replace(/#.*$/, '').trim();
      if (!clean) {
        return;
      }
      const match = /^(\S+)\s+(.+)$/u.exec(clean);
      if (!match) {
        throw new TypeError(
          `${path}:${index + 1}: expected "word pronunciation"`
        );
      }
      const word = match[1].normalize('NFC');
      const variants = entries.get(word) ?? [];
      const value = match[2].normalize('NFC');
      if (!variants.includes(value)) {
        variants.push(value);
      }
      entries.set(word, variants);
    });
  return entries;
}

/**
 * Read a word count list written by `build-lexicon.mjs counts`: one
 * `word count` per line, most frequent first.
 * @returns {string[]} the words in rank order
 */
export function readCounts(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.split(' ')[0])
    .filter(Boolean);
}

/** The `.txt` files of a directory (recursively), sorted by path. */
export function textFiles(dir) {
  if (statSync(dir).isFile()) {
    return [dir];
  }
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...textFiles(path));
    } else if (name.endsWith('.txt')) {
      files.push(path);
    }
  }
  return files;
}

/** Word patterns per language, applied to lower-cased NFC text. */
export const WORD_PATTERNS = {
  en: /[a-z]+(?:'[a-z]+)*/g,
  ru: /[а-яё]+(?:-[а-яё]+)*/g,
  hi: /[ऀ-ॣ॰-ॿ]+/g,
  zh: /\p{Script=Han}+/gu,
};

/**
 * The words of a line of running text.
 * @param {string} lang
 * @param {string} line
 */
export function textWords(lang, line) {
  const pattern = WORD_PATTERNS[lang];
  if (!pattern) {
    throw new RangeError(`no word pattern for language ${lang}`);
  }
  return (
    line.normalize('NFC').toLowerCase().replaceAll('’', "'").match(pattern) ??
    []
  );
}

/**
 * Read one member of a zip archive (stored or deflated) without an
 * external tool.
 * @param {Buffer} zip
 * @param {string} name
 * @returns {Buffer}
 */
export function readZipEntry(zip, name) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) {
    end--;
  }
  if (end < 0) {
    throw new TypeError('not a zip archive');
  }
  const total = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let index = 0; index < total; index++) {
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const entry = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (entry === name) {
      const start =
        local +
        30 +
        zip.readUInt16LE(local + 26) +
        zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      if (method === 0) {
        return data;
      }
      if (method === 8) {
        return inflateRawSync(data);
      }
      throw new TypeError(`zip method ${method} is not supported`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new RangeError(`${name} is not in the archive`);
}

/** The text of Unihan_Readings.txt from a directory or its Unihan.zip. */
export function unihanReadingsText(dir) {
  const plain = join(dir, 'Unihan_Readings.txt');
  if (existsSync(plain)) {
    return readFileSync(plain, 'utf8');
  }
  const zip = join(dir, 'Unihan.zip');
  if (existsSync(zip)) {
    return readZipEntry(readFileSync(zip), 'Unihan_Readings.txt').toString(
      'utf8'
    );
  }
  throw new RangeError(`${dir} has neither Unihan_Readings.txt nor Unihan.zip`);
}

/**
 * Readings of the characters of the Table of General Standard Chinese
 * Characters (Unihan kTGHZ2013): the kMandarin reading first, then the
 * other kTGHZ2013 readings in their order, all NFC.
 * @param {string} text Unihan_Readings.txt
 * @returns {Map<string, string[]>}
 */
export function unihanReadings(text) {
  const mandarin = new Map();
  const standard = new Map();
  for (const line of text.split('\n')) {
    const [code, field, value] = line.split('\t');
    if (!value || !code.startsWith('U+')) {
      continue;
    }
    const char = String.fromCodePoint(parseInt(code.slice(2), 16));
    if (field === 'kMandarin') {
      mandarin.set(char, value.split(' ')[0].normalize('NFC'));
    } else if (field === 'kTGHZ2013') {
      standard.set(
        char,
        value.split(' ').map((item) => item.split(':')[1].normalize('NFC'))
      );
    }
  }
  const readings = new Map();
  for (const [char, listed] of standard) {
    const first = mandarin.get(char) ?? listed[0];
    readings.set(char, [...new Set([first, ...listed])]);
  }
  return readings;
}
