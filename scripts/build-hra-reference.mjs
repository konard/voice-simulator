#!/usr/bin/env node
// Measure the HuBMAP Human Reference Atlas mouth and larynx of the Visible
// Human male and female (fetched just in time with range requests) and
// write their midsagittal key points and the leans of their central
// incisors to tests/fixtures/anatomy/hra.json, which the tests hold the
// model to. Only the numbers are committed.
//
// Usage: node scripts/build-hra-reference.mjs [--out FILE]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import {
  KEY_POINTS,
  incisorLean,
  labialLean,
  referenceKeyPoints,
  referenceParts,
  sortedReferenceTeeth,
} from '../src/geometry/reference-anatomy.js';
import { HRA, fetchHra } from './fetch-anatomy.mjs';

export const HRA_FIXTURE = fileURLToPath(
  new globalThis.URL('../tests/fixtures/anatomy/hra.json', import.meta.url)
);

const round = (value) => Math.round(value * 100) / 100;

/**
 * Key points (mm, head frame, on the reference's midline) and the lean
 * of the central incisors (degrees): of their long axes (sagittalLean)
 * and of their crowns' labial faces (labialLean), for one HRA body.
 * @param {'male'|'female'} sex
 * @param {{fetchFn?: typeof fetch}} [options]
 */
export async function measureHraBody(sex, options = {}) {
  const parts = referenceParts(await fetchHra(sex, options));
  const points = referenceKeyPoints(parts);
  const teeth = sortedReferenceTeeth(parts);
  const lean = incisorLean(teeth);
  const labial = incisorLean(teeth, (tooth) =>
    labialLean(tooth.positions, tooth.jaw)
  );
  return {
    points: Object.fromEntries(
      KEY_POINTS.map((name) => [name, points[name].map(round)])
    ),
    incisorLean: { upper: round(lean.upper), lower: round(lean.lower) },
    labialLean: { upper: round(labial.upper), lower: round(labial.lower) },
  };
}

/**
 * Key points (mm, head frame, on the reference's midline) of one HRA body.
 * @param {'male'|'female'} sex
 * @param {{fetchFn?: typeof fetch}} [options]
 */
export async function measureHra(sex, options = {}) {
  return (await measureHraBody(sex, options)).points;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--out');
  const out = index === -1 ? HRA_FIXTURE : process.argv[index + 1];
  const male = await measureHraBody('male');
  const female = await measureHraBody('female');
  const fixture = {
    description:
      "Midsagittal key points (mm) of the HuBMAP HRA reference mouth and larynx, measured by scripts/build-hra-reference.mjs with src/geometry/reference-anatomy.js (numbers only). Head frame: +y up, +z forward, x on the reference midline; each body keeps its own origin, so compare after a rigid fit. incisorLean: sagittal lean (degrees, positive with the top forward) of the long axis of each jaw's central incisors; labialLean: lean of their crowns' labial faces.",
    source: HRA.name,
    citation: HRA.citation,
    license: HRA.license,
    urls: HRA.urls,
    male: male.points,
    female: female.points,
    incisorLean: { male: male.incisorLean, female: female.incisorLean },
    labialLean: { male: male.labialLean, female: female.labialLean },
  };
  const text = await prettier.format(JSON.stringify(fixture), {
    ...(await prettier.resolveConfig(out)),
    parser: 'json',
  });
  writeFileSync(out, text);
  console.log(out);
}
