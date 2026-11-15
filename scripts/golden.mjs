#!/usr/bin/env node

/**
 * Golden set of public-domain recordings (issue 17).
 *
 * `tests/fixtures/golden/` holds a few short LibriVox sentences per language
 * as 16 kHz mono 16-bit FLAC, with their text, IPA, source and licence in
 * `manifest.json`. This script finds the pauses of a converted recording,
 * cuts one sentence out of it and checks the folder. It reads only WAV and
 * FLAC (`src/audio/`); converting the LibriVox MP3 to WAV is done once with
 * ffmpeg on the machine of the person who adds a file, never in CI.
 *
 * Usage:
 *   node scripts/golden.mjs pauses <file.wav> [--min <s>]
 *   node scripts/golden.mjs cut --source <file.wav> --start <s> --end <s>
 *                              --id <id> [--dir <folder>]
 *   node scripts/golden.mjs verify [--dir <folder>]
 *
 * Exit codes: 0 ok, 1 `verify` found a problem, 2 wrong usage or unreadable
 * input.
 *
 * See tests/fixtures/golden/README.md.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeFlac, encodeFlac } from '../src/audio/flac.js';
import { resample } from '../src/audio/resample.js';
import { decodeWav } from '../src/audio/wav.js';
import { parseIpa } from '../src/ipa/parse.js';
import { REDISTRIBUTABLE, REGISTRY_FILE } from './datasets.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const GOLDEN_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'golden');
export const SAMPLE_RATE = 16000;
export const BIT_DEPTH = 16;
/** Largest absolute sample of a cut: -3 dBFS. */
export const PEAK = 0.708;
/** Length of the linear fade at both ends of a cut, in seconds. */
export const FADE = 0.01;
export const MAX_TOTAL_BYTES = 2000000;
export const LANGUAGES = ['en', 'ru', 'hi', 'zh'];
export const ID_PATTERN = /^(en|ru|hi|zh)-\d{2}$/;
export const LIMITS = {
  duration: [2, 6],
  peak: [0.6, 0.75],
  rate: [2, 8],
  perLanguage: [5, 10],
  words: [5, 16],
  hanCharacters: [6, 24],
  edgeRms: 0.05,
  edge: 0.005,
  durationTolerance: 0.01,
};
export const SEXES = ['female', 'male', 'unknown'];
export const REVIEW_STATES = ['unreviewed', 'confirmed'];

const EXIT = { ok: 0, problems: 1, usage: 2 };
const HAN = /\p{Script=Han}/gu;

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** @param {Uint8Array|string} data */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// Signal

/**
 * RMS level of consecutive frames in dB (full scale 1.0).
 * @param {ArrayLike<number>} samples
 * @param {number} frameLength samples per frame
 * @returns {Float64Array}
 */
export function frameLevels(samples, frameLength) {
  const count = Math.floor(samples.length / frameLength);
  const levels = new Float64Array(count);
  for (let frame = 0; frame < count; frame++) {
    let sum = 0;
    for (let i = frame * frameLength; i < (frame + 1) * frameLength; i++) {
      sum += samples[i] * samples[i];
    }
    // 1e-20 of mean square is -200 dB, the level of digital silence.
    levels[frame] = 10 * Math.log10(Math.max(sum / frameLength, 1e-20));
  }
  return levels;
}

/**
 * Runs of silent frames. A frame of `frame` seconds is silent when its RMS
 * level is more than `below` dB under the level that the fraction
 * `quantile` of all frames are below (L95 by default).
 * @param {ArrayLike<number>} samples mono
 * @param {number} sampleRate
 * @param {{min?: number, frame?: number, below?: number, quantile?: number}} [options]
 * @returns {{start: number, end: number}[]} seconds
 */
export function findPauses(samples, sampleRate, options = {}) {
  const { min = 0.25, frame = 0.01, below = 35, quantile = 0.95 } = options;
  const frameLength = Math.max(1, Math.round(frame * sampleRate));
  const levels = frameLevels(samples, frameLength);
  if (levels.length === 0) {
    return [];
  }
  const sorted = Float64Array.from(levels).sort();
  const reference = sorted[Math.floor(quantile * (sorted.length - 1))];
  const threshold = reference - below;
  const seconds = (index) => (index * frameLength) / sampleRate;
  const pauses = [];
  let first = -1;
  for (let index = 0; index <= levels.length; index++) {
    const silent = index < levels.length && levels[index] < threshold;
    if (silent && first < 0) {
      first = index;
    } else if (!silent && first >= 0) {
      if (seconds(index - first) >= min - 1e-9) {
        pauses.push({ start: seconds(first), end: seconds(index) });
      }
      first = -1;
    }
  }
  return pauses;
}

/**
 * Cut `start` to `end` seconds, fade 10 ms in and out linearly (the first
 * and the last sample become 0) and scale the peak to 0.708 (-3 dBFS).
 * @param {ArrayLike<number>} samples mono
 * @param {number} sampleRate
 * @param {number} start seconds
 * @param {number} end seconds
 * @returns {Float32Array}
 */
export function cutUtterance(samples, sampleRate, start, end) {
  const from = Math.max(0, Math.round(start * sampleRate));
  const to = Math.min(samples.length, Math.round(end * sampleRate));
  if (!(to > from + 1)) {
    throw new Error(`empty cut from ${start} s to ${end} s`);
  }
  const cut = Float32Array.from(Array.prototype.slice.call(samples, from, to));
  const fade = Math.min(
    Math.round(FADE * sampleRate),
    Math.floor(cut.length / 2)
  );
  for (let i = 0; i < fade; i++) {
    // `+ 0` turns -0 into 0, so the end samples are exactly zero.
    cut[i] = cut[i] * (i / fade) + 0;
    cut[cut.length - 1 - i] = cut[cut.length - 1 - i] * (i / fade) + 0;
  }
  let peak = 0;
  for (const value of cut) {
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak === 0) {
    throw new Error(`the cut from ${start} s to ${end} s is silent`);
  }
  for (let i = 0; i < cut.length; i++) {
    cut[i] *= PEAK / peak;
  }
  return cut;
}

/** @param {ArrayLike<number>} samples */
export function peakOf(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  return peak;
}

/** @param {ArrayLike<number>} samples @param {number} from @param {number} to */
export function rmsOf(samples, from = 0, to = samples.length) {
  let sum = 0;
  for (let i = from; i < to; i++) {
    sum += samples[i] * samples[i];
  }
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

// ---------------------------------------------------------------------------
// Text

/** Hindi: independent vowels, consonants (with nukta forms) and the virama. */
const HINDI_VOWEL = /[ऄ-औॠॡॲ-ॷ]/u;
const HINDI_CONSONANT = /[क-हक़-य़ॸ-ॿ]/u;
const VIRAMA = '्';
const NUKTA = '़';

function hindiUnits(text) {
  const chars = [...text];
  let units = 0;
  for (let i = 0; i < chars.length; i++) {
    if (HINDI_VOWEL.test(chars[i])) {
      units += 1;
    } else if (HINDI_CONSONANT.test(chars[i])) {
      const next = chars[i + 1] === NUKTA ? chars[i + 2] : chars[i + 1];
      units += next === VIRAMA ? 0 : 1;
    }
  }
  return units;
}

/**
 * Units of step 7 of issue 17: groups of vowel letters (English, Russian),
 * independent vowels plus consonants not followed by a virama (Hindi), Han
 * characters (Mandarin). About one unit per syllable.
 * @param {string} text
 * @param {string} lang
 * @returns {number}
 */
export function countUnits(text, lang) {
  const value = String(text ?? '');
  if (lang === 'en') {
    return (value.match(/[aeiouy]+/giu) ?? []).length;
  }
  if (lang === 'ru') {
    return (value.match(/[аеёиоуыэюя]+/giu) ?? []).length;
  }
  if (lang === 'hi') {
    return hindiUnits(value);
  }
  if (lang === 'zh') {
    return (value.match(HAN) ?? []).length;
  }
  throw new Error(`unknown language ${lang}`);
}

/** Words separated by white space; a token without a letter is punctuation. */
export function countWords(text) {
  return String(text ?? '')
    .split(/\s+/u)
    .filter((token) => /\p{L}/u.test(token)).length;
}

/**
 * Words of `text` as `ipa` must have them: whitespace words, or Han
 * characters for Mandarin.
 */
export function textWords(text, lang) {
  return lang === 'zh' ? countUnits(text, 'zh') : countWords(text);
}

// ---------------------------------------------------------------------------
// Checks shared by `verify` and tests/golden-set.test.js

/** @param {string} [dir] */
export function loadManifest(dir = GOLDEN_DIR) {
  return JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
}

const utterancesOf = (manifest) =>
  Array.isArray(manifest?.utterances) ? manifest.utterances : [];
const labelOf = (item, index) =>
  isText(item?.id) ? item.id : `utterance ${index}`;

function speakerProblems(label, speaker) {
  if (!isObject(speaker)) {
    return [`${label}: speaker must be an object`];
  }
  const problems = [];
  if (!/^librivox-\d+$/.test(speaker.id ?? '')) {
    problems.push(`${label}: speaker.id must be librivox-<reader id>`);
  }
  if (!SEXES.includes(speaker.sex)) {
    problems.push(`${label}: speaker.sex must be one of ${SEXES.join(', ')}`);
  }
  return problems;
}

function sourceProblems(label, source, duration) {
  if (!isObject(source)) {
    return [`${label}: source must be an object`];
  }
  const problems = [];
  for (const key of ['dataset', 'page', 'licence']) {
    if (!isText(source[key])) {
      problems.push(`${label}: source.${key} is missing`);
    }
  }
  if (isText(source.page) && !source.page.startsWith('https://')) {
    problems.push(`${label}: source.page must be an https:// address`);
  }
  if (!isNumber(source.start) || !isNumber(source.end)) {
    problems.push(`${label}: source.start and source.end must be numbers`);
  } else if (
    !(source.start >= 0 && source.end > source.start) ||
    (isNumber(duration) &&
      Math.abs(source.end - source.start - duration) > LIMITS.durationTolerance)
  ) {
    problems.push(
      `${label}: source.start ${source.start} and source.end ${source.end} do not span the duration ${duration}`
    );
  }
  return problems;
}

function reviewProblems(label, review) {
  if (!isObject(review)) {
    return [`${label}: review must be an object`];
  }
  const problems = [];
  for (const key of ['text', 'ipa']) {
    if (!REVIEW_STATES.includes(review[key])) {
      problems.push(
        `${label}: review.${key} must be one of ${REVIEW_STATES.join(', ')}`
      );
    }
  }
  const confirmed = review.text === 'confirmed' || review.ipa === 'confirmed';
  if (confirmed ? !isText(review.by) : review.by !== null) {
    problems.push(
      `${label}: review.by must be the GitHub name of the person who confirmed, else null`
    );
  }
  return problems;
}

function utteranceProblems(item, index) {
  const label = labelOf(item, index);
  if (!isObject(item)) {
    return [`${label}: must be an object`];
  }
  const problems = [];
  if (!ID_PATTERN.test(item.id ?? '')) {
    problems.push(`${label}: id must match ${ID_PATTERN.source}`);
  } else if (item.lang !== item.id.slice(0, 2)) {
    problems.push(`${label}: lang must be ${item.id.slice(0, 2)}`);
  }
  if (item.file !== `${item.id}.flac`) {
    problems.push(`${label}: file must be ${item.id}.flac`);
  }
  for (const key of ['text', 'ipa', 'textSource']) {
    if (!isText(item[key])) {
      problems.push(`${label}: ${key} is missing`);
    }
  }
  if (!isNumber(item.duration)) {
    problems.push(`${label}: duration must be a number`);
  }
  if (!/^[0-9a-f]{64}$/.test(item.sha256 ?? '')) {
    problems.push(`${label}: sha256 must be 64 lower-case hex digits`);
  }
  return [
    ...problems,
    ...speakerProblems(label, item.speaker),
    ...sourceProblems(label, item.source, item.duration),
    ...reviewProblems(label, item.review),
  ];
}

/**
 * `manifest is complete`: every field, unique ids, 5 to 10 per language.
 * @param {object} manifest
 * @returns {string[]}
 */
export function manifestProblems(manifest) {
  if (!isObject(manifest)) {
    return ['manifest.json must hold an object'];
  }
  const problems = [];
  if (manifest.schema !== 1) {
    problems.push('manifest.json: schema must be 1');
  }
  if (!/^ffmpeg \d/.test(manifest.tool ?? '')) {
    problems.push('manifest.json: tool must name the ffmpeg version');
  }
  if (!Array.isArray(manifest.utterances)) {
    return [...problems, 'manifest.json: utterances must be a list'];
  }
  const seen = new Set();
  manifest.utterances.forEach((item, index) => {
    problems.push(...utteranceProblems(item, index));
    if (seen.has(item?.id)) {
      problems.push(`${labelOf(item, index)}: id is not unique`);
    }
    seen.add(item?.id);
  });
  const [low, high] = LIMITS.perLanguage;
  for (const lang of LANGUAGES) {
    const count = manifest.utterances.filter((u) => u?.lang === lang).length;
    if (count < low || count > high) {
      problems.push(
        `manifest.json: ${lang} has ${count} utterances, not ${low} to ${high}`
      );
    }
  }
  return problems;
}

/**
 * `files match the manifest`: every file exists, no other .flac, SHA-256.
 * @param {object} manifest
 * @param {string} [dir]
 * @returns {string[]}
 */
export function fileProblems(manifest, dir = GOLDEN_DIR) {
  const problems = [];
  const listed = new Set();
  for (const [index, item] of utterancesOf(manifest).entries()) {
    const label = labelOf(item, index);
    if (!isText(item?.file)) {
      continue;
    }
    listed.add(item.file);
    const file = path.join(dir, item.file);
    if (!existsSync(file)) {
      problems.push(`${label}: ${item.file} does not exist`);
    } else if (sha256(readFileSync(file)) !== item.sha256) {
      problems.push(`${label}: the SHA-256 of ${item.file} is not sha256`);
    }
  }
  const present = existsSync(dir) ? readdirSync(dir) : [];
  for (const name of present.filter((n) => n.endsWith('.flac')).sort()) {
    if (!listed.has(name)) {
      problems.push(`${name}: not listed in manifest.json`);
    }
  }
  return problems;
}

function decodedProblems(label, item, decoded) {
  const problems = [];
  const { sampleRate, channels, bitDepth, samples } = decoded;
  if (sampleRate !== SAMPLE_RATE || channels !== 1 || bitDepth !== BIT_DEPTH) {
    problems.push(
      `${label}: ${sampleRate} Hz, ${channels} channels, ${bitDepth} bits; expected ${SAMPLE_RATE} Hz, 1 channel, ${BIT_DEPTH} bits`
    );
  }
  const duration = samples.length / sampleRate;
  const [shortest, longest] = LIMITS.duration;
  if (Math.abs(duration - item.duration) > LIMITS.durationTolerance) {
    problems.push(
      `${label}: lasts ${duration.toFixed(3)} s, manifest says ${item.duration}`
    );
  }
  if (duration < shortest || duration > longest) {
    problems.push(
      `${label}: lasts ${duration.toFixed(3)} s, not ${shortest} to ${longest} s`
    );
  }
  const peak = peakOf(samples);
  if (peak < LIMITS.peak[0] || peak > LIMITS.peak[1]) {
    problems.push(
      `${label}: peak ${peak.toFixed(3)}, not ${LIMITS.peak[0]} to ${LIMITS.peak[1]}`
    );
  }
  const edge = Math.round(LIMITS.edge * sampleRate);
  const head = rmsOf(samples, 0, Math.min(edge, samples.length));
  const tail = rmsOf(samples, Math.max(0, samples.length - edge));
  if (Math.max(head, tail) >= LIMITS.edgeRms) {
    problems.push(
      `${label}: the RMS of the first or last 5 ms is ${Math.max(head, tail).toFixed(3)}, not below ${LIMITS.edgeRms}`
    );
  }
  return problems;
}

/**
 * `audio format`: 16 kHz mono 16-bit, duration, peak and quiet ends.
 * @param {object} manifest
 * @param {string} [dir]
 * @returns {string[]}
 */
export function audioProblems(manifest, dir = GOLDEN_DIR) {
  const problems = [];
  for (const [index, item] of utterancesOf(manifest).entries()) {
    const label = labelOf(item, index);
    const file = path.join(dir, String(item?.file));
    if (!isText(item?.file) || !existsSync(file)) {
      continue;
    }
    try {
      problems.push(
        ...decodedProblems(label, item, decodeFlac(readFileSync(file)))
      );
    } catch (error) {
      problems.push(`${label}: ${item.file} does not decode: ${error.message}`);
    }
  }
  return problems;
}

/**
 * `size limit`: the files together are at most 2 000 000 bytes.
 * @param {object} manifest
 * @param {string} [dir]
 * @returns {string[]}
 */
export function sizeProblems(manifest, dir = GOLDEN_DIR) {
  const present = existsSync(dir) ? readdirSync(dir) : [];
  let total = 0;
  for (const name of present.filter((n) => n.endsWith('.flac'))) {
    total += readFileSync(path.join(dir, name)).length;
  }
  return total > MAX_TOTAL_BYTES
    ? [`the .flac files have ${total} bytes, more than ${MAX_TOTAL_BYTES}`]
    : [];
}

/**
 * `licences`: public domain or CC0, from a registry entry that may be
 * redistributed.
 * @param {object} manifest
 * @param {{datasets?: object[]}} registry
 * @returns {string[]}
 */
export function licenceProblems(manifest, registry) {
  const problems = [];
  const entries = Array.isArray(registry?.datasets) ? registry.datasets : [];
  for (const [index, item] of utterancesOf(manifest).entries()) {
    const label = labelOf(item, index);
    const source = item?.source ?? {};
    if (!REDISTRIBUTABLE.includes(source.licence)) {
      problems.push(
        `${label}: source.licence "${source.licence}" is not ${REDISTRIBUTABLE.join(' or ')}`
      );
    }
    const entry = entries.find((candidate) => candidate.id === source.dataset);
    if (!entry) {
      problems.push(
        `${label}: source.dataset "${source.dataset}" is not in datasets/registry.json`
      );
    } else if (entry.redistribution !== true) {
      problems.push(
        `${label}: ${entry.id} does not have redistribution: true in datasets/registry.json`
      );
    } else if (entry.licence !== source.licence) {
      problems.push(
        `${label}: source.licence "${source.licence}" differs from the registry ("${entry.licence}")`
      );
    }
  }
  return problems;
}

/**
 * `text is plausible`: 2 to 8 units per second (step 7 of issue 17), a
 * sentence of 5 to 16 words (Mandarin: 6 to 24 characters), no digits.
 * @param {object} manifest
 * @returns {string[]}
 */
export function textProblems(manifest) {
  const problems = [];
  for (const [index, item] of utterancesOf(manifest).entries()) {
    const label = labelOf(item, index);
    if (!LANGUAGES.includes(item?.lang) || !isText(item.text)) {
      continue;
    }
    const units = countUnits(item.text, item.lang);
    const rate = units / item.duration;
    if (!(rate >= LIMITS.rate[0] && rate <= LIMITS.rate[1])) {
      problems.push(
        `${label}: ${units} units in ${item.duration} s is ${rate.toFixed(2)} per second, not ${LIMITS.rate[0]} to ${LIMITS.rate[1]}`
      );
    }
    const [low, high] =
      item.lang === 'zh' ? LIMITS.hanCharacters : LIMITS.words;
    const words = textWords(item.text, item.lang);
    if (words < low || words > high) {
      problems.push(
        `${label}: ${words} ${item.lang === 'zh' ? 'characters' : 'words'}, not ${low} to ${high}`
      );
    }
    if (/\p{Nd}/u.test(item.text)) {
      problems.push(`${label}: text has a digit`);
    }
  }
  return problems;
}

/**
 * `ipa is readable`: every symbol known to parseIpa, one IPA word per word
 * of the text (Mandarin: per Han character).
 * @param {object} manifest
 * @returns {string[]}
 */
export function ipaProblems(manifest) {
  const problems = [];
  for (const [index, item] of utterancesOf(manifest).entries()) {
    const label = labelOf(item, index);
    if (!isText(item?.ipa) || !isText(item.text)) {
      continue;
    }
    const { unknown } = parseIpa(item.ipa);
    if (unknown.length > 0) {
      problems.push(`${label}: unknown IPA symbols ${unknown.join(' ')}`);
    }
    const expected = textWords(item.text, item.lang);
    const words = countWords(item.ipa);
    if (words !== expected) {
      problems.push(
        `${label}: the IPA has ${words} words, the text ${expected}`
      );
    }
  }
  return problems;
}

/**
 * Every check of tests/golden-set.test.js.
 * @param {{dir?: string, registry?: object}} [options]
 * @returns {string[]}
 */
export function goldenProblems(options = {}) {
  const dir = options.dir ?? GOLDEN_DIR;
  let manifest;
  try {
    manifest = loadManifest(dir);
  } catch (error) {
    return [`manifest.json: ${error.message}`];
  }
  const registry =
    options.registry ?? JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
  return [
    ...manifestProblems(manifest),
    ...fileProblems(manifest, dir),
    ...audioProblems(manifest, dir),
    ...sizeProblems(manifest, dir),
    ...licenceProblems(manifest, registry),
    ...textProblems(manifest),
    ...ipaProblems(manifest),
  ];
}

// ---------------------------------------------------------------------------
// Command line

const USAGE = `Usage:
  node scripts/golden.mjs pauses <file.wav> [--min <s>]
  node scripts/golden.mjs cut --source <file.wav> --start <s> --end <s> --id <id> [--dir <folder>]
  node scripts/golden.mjs verify [--dir <folder>]

pauses  prints every run of 10 ms frames more than 35 dB below the level
        that 95 % of the frames are below, of at least --min seconds
        (default 0.25), as "start end" in seconds.
cut     writes <folder>/<id>.flac (16 kHz mono 16-bit) from start to end,
        with 10 ms fades and the peak at 0.708 (-3 dBFS), and prints
        "<id> <duration> s <bytes> bytes <sha256>".
verify  prints one line per problem of tests/fixtures/golden.

  --dir <folder>  default tests/fixtures/golden

Exit codes: 0 ok, 1 verify found a problem, 2 wrong usage or unreadable input.
See tests/fixtures/golden/README.md.`;

const COMMANDS = new Set(['pauses', 'cut', 'verify']);
const VALUES = {
  '--min': 'min',
  '--source': 'source',
  '--start': 'start',
  '--end': 'end',
  '--id': 'id',
  '--dir': 'dir',
};

class UsageError extends Error {}

function readNumber(options, key) {
  const value = Number(options[key]);
  if (options[key] === undefined || !Number.isFinite(value) || value < 0) {
    throw new UsageError(`--${key} must be a number of seconds`);
  }
  return value;
}

/**
 * @param {string[]} argv
 * @returns {{command?: string, files: string[], help: boolean} & Record<string, string>}
 */
export function parseArguments(argv) {
  const options = { command: undefined, files: [], help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (Object.hasOwn(VALUES, argument)) {
      if (argv[i + 1] === undefined) {
        throw new UsageError(`${argument} needs a value`);
      }
      options[VALUES[argument]] = argv[i + 1];
      i += 1;
    } else if (argument.startsWith('-')) {
      throw new UsageError(`unknown option ${argument}`);
    } else if (options.command === undefined) {
      options.command = argument;
    } else {
      options.files.push(argument);
    }
  }
  if (!options.help && !COMMANDS.has(options.command)) {
    throw new UsageError(
      options.command === undefined
        ? 'missing command'
        : `unknown command ${options.command}`
    );
  }
  return options;
}

/** @param {string} file @returns {{samples: Float32Array, sampleRate: number}} */
function readWav(file) {
  const { samples, sampleRate } = decodeWav(readFileSync(file));
  return sampleRate === SAMPLE_RATE
    ? { samples, sampleRate }
    : {
        samples: resample(samples, sampleRate, SAMPLE_RATE),
        sampleRate: SAMPLE_RATE,
      };
}

function pausesCommand(options, out) {
  if (options.files.length !== 1) {
    throw new UsageError('pauses needs one WAV file');
  }
  const min = options.min === undefined ? 0.25 : readNumber(options, 'min');
  const { samples, sampleRate } = readWav(options.files[0]);
  for (const pause of findPauses(samples, sampleRate, { min })) {
    out.log(`${pause.start.toFixed(3)} ${pause.end.toFixed(3)}`);
  }
  return EXIT.ok;
}

function cutCommand(options, out) {
  if (!isText(options.source)) {
    throw new UsageError('cut needs --source <file.wav>');
  }
  if (!ID_PATTERN.test(options.id ?? '')) {
    throw new UsageError(`--id must match ${ID_PATTERN.source}`);
  }
  const start = readNumber(options, 'start');
  const end = readNumber(options, 'end');
  const { samples, sampleRate } = readWav(options.source);
  const cut = cutUtterance(samples, sampleRate, start, end);
  const bytes = encodeFlac(cut, SAMPLE_RATE, { bitDepth: BIT_DEPTH });
  const file = path.join(options.dir ?? GOLDEN_DIR, `${options.id}.flac`);
  writeFileSync(file, bytes);
  const duration = (cut.length / SAMPLE_RATE).toFixed(3);
  out.log(`${options.id} ${duration} s ${bytes.length} bytes ${sha256(bytes)}`);
  return EXIT.ok;
}

function verifyCommand(options, out) {
  const problems = goldenProblems({ dir: options.dir });
  for (const problem of problems) {
    out.log(problem);
  }
  return problems.length > 0 ? EXIT.problems : EXIT.ok;
}

/**
 * @param {string[]} [argv]
 * @param {{log: Function, error: Function}} [out]
 * @returns {number} exit code
 */
export function main(argv = process.argv.slice(2), out = console) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      out.log(USAGE);
      return EXIT.ok;
    }
    if (options.command === 'pauses') {
      return pausesCommand(options, out);
    }
    return options.command === 'cut'
      ? cutCommand(options, out)
      : verifyCommand(options, out);
  } catch (error) {
    out.error(
      `golden: ${error instanceof UsageError ? error.message : (error?.message ?? error)}`
    );
    return EXIT.usage;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
