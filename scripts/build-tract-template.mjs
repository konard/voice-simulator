#!/usr/bin/env node
/**
 * Build src/geometry/tract-template.js, the MRI shape of the vocal tract
 * the head model is drawn with, from the CC0 tracts of the Dresden Vocal
 * Tract Dataset in tests/fixtures/dvtd:
 *
 * - the bend of the centreline: the midsagittal angle of the tangent
 *   (0 = up, 90° = forward) along the tract, averaged over the schwa
 *   tracts of both subjects after turning each so its pharynx (glottis to
 *   40% of the length) is vertical, and with the arc length remapped so
 *   the 45° point of the bend sits half way along;
 * - the cross-section aspect: lateral width over midsagittal depth of the
 *   cut perpendicular to the centreline, averaged over all tracts on the
 *   same remapped arc length.
 *
 * The 45° point of every tract is listed too: it is where the
 * `pharynxRatio` of a head puts the bend.
 *
 * Usage: node scripts/build-tract-template.mjs [--check]
 *   --check fails if the committed file differs from a fresh build.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import prettier from 'prettier';
import { SAMPLES, tractTemplateData } from './tract-template-data.mjs';

const TARGET = new globalThis.URL(
  '../src/geometry/tract-template.js',
  import.meta.url
);

function build() {
  const { bendAngles, aspects, bendFractions } = tractTemplateData();
  return `/**
 * MRI shape of the vocal tract, built by scripts/build-tract-template.mjs
 * from the CC0 tracts of the Dresden Vocal Tract Dataset (Birkholz et al.
 * 2020, Scientific Data 7, 255) hosted in tests/fixtures/dvtd. Do not edit
 * by hand.
 *
 * Both profiles are sampled at ${SAMPLES} equal steps of a remapped arc
 * length that puts the 45° point of the bend half way along: the glottis
 * to the bend is the first half, the bend to the lips the second.
 */

export const TRACT_TEMPLATE = Object.freeze({
  /**
   * Midsagittal angle of the centreline (degrees, 0 = up, 90 = forward),
   * mean of the schwa tracts with the pharynx turned vertical.
   */
  bendAngles: Object.freeze(${JSON.stringify(bendAngles)}),
  /**
   * Lateral width over midsagittal depth of the cross-section, mean of all
   * tracts.
   */
  aspects: Object.freeze(${JSON.stringify(aspects)}),
  /** Arc fraction of the 45° point of the bend in each tract. */
  bendFractions: Object.freeze(${JSON.stringify(bendFractions)}),
});
`;
}

// Formatted as the committed file is, so --check compares values only.
const text = await prettier.format(build(), {
  ...(await prettier.resolveConfig(TARGET)),
  filepath: TARGET.pathname,
});
if (process.argv.includes('--check')) {
  if (readFileSync(TARGET, 'utf8') !== text) {
    console.error(
      'src/geometry/tract-template.js is out of date: run node scripts/build-tract-template.mjs'
    );
    process.exit(1);
  }
} else {
  writeFileSync(TARGET, text);
}
