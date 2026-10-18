#!/usr/bin/env node
// Read the mouths of the Human Reference Atlas as an MRI is read: the key
// points of src/geometry/mouth-landmarks.js on a 5 mm midsagittal slab,
// the clinical distances between them and the lean of the incisors, and
// write them to tests/fixtures/anatomy/mouth-landmarks.json for the tests
// that hold the procedural mouth to them. Only these numbers leave the
// downloaded meshes (CC BY 4.0), which are never committed.
//
// Usage: node scripts/build-mouth-reference.mjs [--hra-male DIR]
//          [--hra-female DIR] [--out FILE]
//   DIR is what `node scripts/fetch-anatomy.mjs hra-male DIR` wrote; a
//   source left out is fetched into a new temporary directory.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import {
  SLICE_THICKNESS,
  mouthLandmarks,
  mouthMeasures,
} from '../src/geometry/mouth-landmarks.js';
import {
  connectedPieces,
  numberTeeth,
  sagittalLean,
} from '../src/geometry/tooth-row.js';
import { HRA_MOUTH, fetchAnatomy, hraMouthParts } from './fetch-anatomy.mjs';

export const MOUTH_FIXTURE = fileURLToPath(
  new globalThis.URL(
    '../tests/fixtures/anatomy/mouth-landmarks.json',
    import.meta.url
  )
);

const round = (value) => Math.round(value * 10) / 10;
const roundAll = (record) =>
  Object.fromEntries(
    Object.entries(record).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.map(round) : round(value),
    ])
  );

/** Mean sagittal lean of the central incisors of each arch (degrees). */
function incisorLean(parts) {
  return Object.fromEntries(
    ['upper', 'lower'].map((jaw) => {
      const incisors = numberTeeth(
        connectedPieces(parts[`${jaw}Teeth`]),
        jaw
      ).filter((tooth) => tooth.type === 0);
      const lean =
        incisors.reduce(
          (sum, tooth) => sum + sagittalLean(tooth.positions),
          0
        ) / incisors.length;
      return [jaw, round(lean)];
    })
  );
}

/**
 * Landmarks (atlas frame), measures (mm) and incisor lean (degrees) of a
 * fetched HRA mouth, rounded to 0.1.
 * @param {string} directory What fetchAnatomy() wrote for an HRA source.
 */
export function measureMouth(directory) {
  const parts = hraMouthParts(directory);
  const landmarks = mouthLandmarks(parts);
  return {
    landmarks: roundAll(landmarks),
    measures: roundAll(mouthMeasures(landmarks)),
    incisorLean: incisorLean(parts),
  };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = option('out') ?? MOUTH_FIXTURE;
  const fixture = {
    description: `Key points of the mouth (mm, atlas frame: +x left, +y up, +z forward) read off a ${SLICE_THICKNESS} mm midsagittal slab by src/geometry/mouth-landmarks.js, the distances between them and the sagittal lean of the central incisors (degrees from vertical, positive when the upper end leans forward); scripts/build-mouth-reference.mjs rebuilds them from the downloads of scripts/fetch-anatomy.mjs.`,
    sources: {},
  };
  for (const [source, atlas] of Object.entries(HRA_MOUTH)) {
    let directory = option(source);
    const temporary = !directory;
    if (temporary) {
      directory = mkdtempSync(join(tmpdir(), `${source}-`));
      await fetchAnatomy(source, directory);
    }
    fixture.sources[source] = {
      name: atlas.name,
      citation: atlas.citation,
      license: atlas.license,
      source: atlas.url,
      units: 'millimetres; +x left, +y superior, +z anterior',
      notes:
        'A cadaver: the jaw rests with the incisal edges about 2 mm apart vertically and the tongue, with its root, fills the mouth. The hard palate is its oral mucosa (no anterior nasal spine); the soft palate mucosa spans the palatal arches, about 5 cm across, and hangs slack with its tip about 3 cm below the posterior nasal spine. The female mouth is the male one scaled up by about 1.1.',
      ...measureMouth(directory),
    };
    if (temporary) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  // Formatted as the committed fixtures are.
  const text = await prettier.format(JSON.stringify(fixture), {
    ...(await prettier.resolveConfig(out)),
    filepath: out,
  });
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
