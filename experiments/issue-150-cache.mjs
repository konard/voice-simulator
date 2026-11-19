// Cached golden-set voices and codebooks for issue 150 experiments.
// Heads and 5,000-row codebooks are fitted exactly as in
// tests/heavy/recognition-inversion.test.js and stored under
// $ISSUE150_CACHE (default /tmp/issue150-cache).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildCodebook,
  fitVoice,
  parseCodebook,
  serializeCodebook,
} from '../src/index.js';
import { loadGolden } from '../tests/helpers/golden.js';

const dir = process.env.ISSUE150_CACHE || '/tmp/issue150-cache';
mkdirSync(dir, { recursive: true });

export const items = loadGolden();

export function joinedSpeech(list) {
  const silence = Math.round(0.25 * list[0].sampleRate);
  const length = list.reduce((sum, item) => sum + item.samples.length, 0);
  const samples = new Float32Array(length + silence * (list.length - 1));
  let at = 0;
  for (const item of list) {
    samples.set(item.samples, at);
    at += item.samples.length + silence;
  }
  return samples;
}

export function voiceFor(item) {
  const file = path.join(dir, `${item.speaker.id}.head.json`);
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  const same = items.filter((other) => other.speaker.id === item.speaker.id);
  const head = fitVoice(joinedSpeech(same), item.sampleRate, {
    language: item.lang,
    refine: false,
  }).head;
  writeFileSync(file, JSON.stringify(head));
  return head;
}

export function codebookFor(item, head = voiceFor(item)) {
  const file = path.join(dir, `${item.speaker.id}.codebook.bin`);
  if (existsSync(file)) {
    return parseCodebook(new Uint8Array(readFileSync(file)));
  }
  const book = buildCodebook(head, { size: 5000, cache: new Map() });
  writeFileSync(file, serializeCodebook(book));
  return book;
}
