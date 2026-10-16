#!/usr/bin/env node

/**
 * Generate the compact pronunciation dictionaries shipped in src/g2p/.
 *
 * Inputs (downloaded manually and kept out of git):
 *   cmudict.dict     https://github.com/cmusphinx/cmudict (BSD-2-Clause)
 *   google-10000.txt https://github.com/first20hours/google-10000-english
 *   count_1w.txt     https://norvig.com/ngrams/count_1w.txt
 *   Unihan_Readings.txt  https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
 *
 * Usage:
 *   node scripts/build-g2p-data.mjs <data-dir> [--english-words 12000]
 *
 * Output:
 *   src/g2p/english-dict.js  word -> IPA (General American, with stress)
 *   src/g2p/chinese-dict.js  toned pinyin syllable -> Hanzi characters
 *
 * Run `npx prettier --write src/g2p` afterwards to apply the repo style.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  return ARPABET_TO_IPA[base];
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

function readCmudict(path) {
  const entries = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) {
      continue;
    }
    const [word, ...phones] = clean.split(/\s+/);
    if (/\(\d+\)$/.test(word) || entries.has(word)) {
      continue;
    }
    entries.set(word, phones);
  }
  return entries;
}

function selectEnglishWords(dataDir, cmudict, limit) {
  const selected = new Set();
  const add = (word) => {
    if (/^[a-z']+$/.test(word) && cmudict.has(word)) {
      selected.add(word);
    }
  };
  for (const word of readFileSync(join(dataDir, 'google-10000.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())) {
    add(word);
  }
  for (const line of readFileSync(join(dataDir, 'count_1w.txt'), 'utf8').split(
    '\n'
  )) {
    if (selected.size >= limit) {
      break;
    }
    add(line.split('\t')[0]);
  }
  return [...selected].sort();
}

function chunkLines(entries, maxLength) {
  const lines = [];
  let current = '';
  for (const entry of entries) {
    if (current && current.length + entry.length + 1 > maxLength) {
      lines.push(current);
      current = '';
    }
    current = current ? `${current} ${entry}` : entry;
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function writeModule(path, header, exportName, lines) {
  const body = lines.map((line) => `  ${JSON.stringify(line)},`).join('\n');
  writeFileSync(
    path,
    `${header}\n\nexport const ${exportName} = [\n${body}\n].join(' ');\n`
  );
}

function buildEnglish(dataDir, limit) {
  const cmudict = readCmudict(join(dataDir, 'cmudict.dict'));
  const words = selectEnglishWords(dataDir, cmudict, limit);
  const entries = words.map(
    (word) => `${word}=${arpabetToIpa(cmudict.get(word))}`
  );
  writeModule(
    'src/g2p/english-dict.js',
    [
      '/**',
      ` * ${entries.length} frequent English words in General American IPA.`,
      ' *',
      ' * Generated by scripts/build-g2p-data.mjs from the CMU Pronouncing',
      ' * Dictionary (Copyright (C) 1993-2015 Carnegie Mellon University,',
      ' * BSD-2-Clause) filtered by Google/Norvig web word frequencies.',
      ' * Format: space separated `word=ipa` entries. Do not edit by hand.',
      ' */',
    ].join('\n'),
    'ENGLISH_DICTIONARY',
    chunkLines(entries, 2000)
  );
  return entries.length;
}

function buildChinese(dataDir) {
  const standard = new Set();
  const readings = new Map();
  for (const line of readFileSync(
    join(dataDir, 'Unihan_Readings.txt'),
    'utf8'
  ).split('\n')) {
    const [code, field, value] = line.split('\t');
    if (!value) {
      continue;
    }
    const char = String.fromCodePoint(parseInt(code.slice(2), 16));
    if (field === 'kTGHZ2013') {
      standard.add(char);
      if (!readings.has(char)) {
        readings.set(char, value.split(' ')[0].split(':')[1]);
      }
    } else if (field === 'kMandarin') {
      readings.set(char, value.split(' ')[0]);
    }
  }
  const bySyllable = new Map();
  for (const char of [...standard].sort()) {
    const syllable = readings.get(char).normalize('NFC');
    bySyllable.set(syllable, `${bySyllable.get(syllable) ?? ''}${char}`);
  }
  const entries = [...bySyllable.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([syllable, chars]) => `${syllable}=${chars}`);
  writeModule(
    'src/g2p/chinese-dict.js',
    [
      '/**',
      ` * Default Mandarin readings for the ${standard.size} characters of the`,
      ' * Table of General Standard Chinese Characters (2013).',
      ' *',
      ' * Generated by scripts/build-g2p-data.mjs from Unihan kTGHZ2013 and',
      ' * kMandarin (Unicode, Inc., Unicode License v3).',
      ' * Format: space separated `pinyin=characters` groups. Do not edit by hand.',
      ' */',
    ].join('\n'),
    'CHINESE_READINGS',
    chunkLines(entries, 1000)
  );
  return standard.size;
}

function main(argv) {
  const dataDir = argv[0];
  if (!dataDir) {
    console.error(
      'Usage: node scripts/build-g2p-data.mjs <data-dir> [--english-words N]'
    );
    return 1;
  }
  const limitIndex = argv.indexOf('--english-words');
  const limit = limitIndex > 0 ? Number(argv[limitIndex + 1]) : 12000;
  console.log(`English entries: ${buildEnglish(dataDir, limit)}`);
  console.log(`Chinese characters: ${buildChinese(dataDir)}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
