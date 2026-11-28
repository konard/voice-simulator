/**
 * The golden set of tests/fixtures/golden/ (issue 17): short public-domain
 * LibriVox sentences with their text and hand-written IPA, decoded from
 * FLAC. Tests that compare the simulator with a person speaking use it:
 *
 *   const items = loadGolden({ lang: 'ru' });
 *   const confirmed = loadGolden({ lang: 'ru', reviewedOnly: true });
 *
 * An item is "reviewed" when a person who knows the language listened and
 * set both `review.text` and `review.ipa` to `confirmed` in manifest.json;
 * reports should mark the other items with `*`.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { GOLDEN_DIR, loadManifest } from '../../scripts/golden.mjs';
import { decodeFlac } from '../../src/audio/flac.js';

/**
 * @param {{review?: {text?: string, ipa?: string}}} item
 * @returns {boolean} both the text and the IPA confirmed by a person
 */
export function isReviewed(item) {
  return (
    item?.review?.text === 'confirmed' && item?.review?.ipa === 'confirmed'
  );
}

/**
 * @param {{lang?: string, reviewedOnly?: boolean, dir?: string}} [options]
 *   lang: en, ru, hi or zh (all languages when omitted)
 * @returns {{id: string, lang: string, text: string, ipa: string,
 *   speaker: {id: string, sex: string}, samples: Float32Array,
 *   sampleRate: number, review: {text: string, ipa: string, by: string|null}}[]}
 */
export function loadGolden(options = {}) {
  const { dir = GOLDEN_DIR } = options;
  return selectedUtterances(dir, options).map((item) =>
    decodeUtterance(item, readFileSync(path.join(dir, item.file)))
  );
}

/** Decode in manifest order. With storage, consume each item before advancing. */
export async function* goldenRecordings(options = {}) {
  const { dir = GOLDEN_DIR, storage } = options;
  for (const item of selectedUtterances(dir, options)) {
    const bytes = await readFile(path.join(dir, item.file));
    yield decodeUtterance(item, bytes, storage);
  }
}

function selectedUtterances(dir, { lang, reviewedOnly, limit }) {
  return loadManifest(dir)
    .utterances.filter((item) => lang === undefined || item.lang === lang)
    .filter((item) => !reviewedOnly || isReviewed(item))
    .slice(0, limit ?? Infinity);
}

function decodeUtterance(item, bytes, storage) {
  const { samples, sampleRate } = decodeFlac(bytes, undefined, storage);
  return {
    id: item.id,
    lang: item.lang,
    text: item.text,
    ipa: item.ipa,
    speaker: { ...item.speaker },
    samples,
    sampleRate,
    review: { ...item.review },
  };
}
