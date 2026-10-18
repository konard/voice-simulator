#!/usr/bin/env node
// Measure the dentitions fetched by scripts/fetch-anatomy.mjs and write
// the numbers the tests hold the procedural teeth to
// (tests/fixtures/anatomy/dentition.json). Only measurements leave the
// downloaded data; the meshes themselves are never committed.
//
// Usage: node scripts/build-dental-reference.mjs [--bodyparts3d DIR]
//          [--z-anatomy DIR] [--open-full-jaw DIR] [--out FILE]
//   DIR is what fetch-anatomy.mjs wrote for that source (for Z-Anatomy, the
//   stl directory of the Blender export; for Open-Full-Jaw, the directory
//   holding Patient_N).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { archMeasures, toothLandmarks } from '../src/geometry/dental.js';
import {
  BODYPARTS3D,
  OPEN_FULL_JAW,
  Z_ANATOMY,
  loadDentition,
} from './fetch-anatomy.mjs';

export const DENTITION_FIXTURE = fileURLToPath(
  new globalThis.URL(
    '../tests/fixtures/anatomy/dentition.json',
    import.meta.url
  )
);

const round = (value) =>
  value === null || Number.isNaN(value) ? null : Math.round(value * 100) / 100;

function rounded(measures) {
  const arch = (jaw) => ({
    widths: jaw.widths.map(round),
    thicknesses: jaw.thicknesses.map(round),
    intercanine: round(jaw.intercanine),
    intermolar: round(jaw.intermolar),
    depth: round(jaw.depth),
    length: round(jaw.length),
  });
  return {
    upper: arch(measures.upper),
    lower: arch(measures.lower),
    overjet: round(measures.overjet),
    overbite: round(measures.overbite),
  };
}

/**
 * Arch measures of one fetched source, rounded to 0.01 mm.
 * @param {'bodyparts3d'|'open-full-jaw'|'z-anatomy'} source
 * @param {string} directory
 */
export function measureSource(source, directory) {
  return rounded(
    archMeasures(toothLandmarks(loadDentition(source, directory)))
  );
}

/** Mean, standard deviation and count of every arch measure. */
export function populationStatistics(samples) {
  const statistic = (read) => {
    const values = samples.map(read).filter((value) => value !== null);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      Math.max(1, values.length - 1);
    return {
      mean: round(mean),
      sd: round(Math.sqrt(variance)),
      n: values.length,
    };
  };
  const arch = (jaw) => ({
    widths: [0, 1, 2, 3, 4, 5, 6].map((type) =>
      statistic((sample) => sample[jaw].widths[type])
    ),
    thicknesses: [0, 1, 2, 3, 4, 5, 6].map((type) =>
      statistic((sample) => sample[jaw].thicknesses[type])
    ),
    ...Object.fromEntries(
      ['intercanine', 'intermolar', 'depth', 'length'].map((name) => [
        name,
        statistic((sample) => sample[jaw][name]),
      ])
    ),
  });
  return { upper: arch('upper'), lower: arch('lower') };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const describe = ({ name, citation, license, url, units }) => ({
  name,
  citation,
  license,
  ...(typeof url === 'string' ? { source: url } : {}),
  units,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = option('out') ?? DENTITION_FIXTURE;
  const fixture = existsSync(out)
    ? JSON.parse(readFileSync(out, 'utf8'))
    : {
        description:
          'Orthodontic arch measures (mm) of segmented permanent teeth, computed by src/geometry/dental.js; scripts/build-dental-reference.mjs rebuilds them from the downloads of scripts/fetch-anatomy.mjs.',
        sources: {},
      };
  const bodyparts3d = option('bodyparts3d');
  if (bodyparts3d) {
    fixture.sources.bodyparts3d = {
      ...describe(BODYPARTS3D),
      measures: measureSource('bodyparts3d', bodyparts3d),
    };
  }
  const zAnatomy = option('z-anatomy');
  if (zAnatomy) {
    fixture.sources['z-anatomy'] = {
      ...describe(Z_ANATOMY),
      notes:
        'Z-Anatomy builds on BodyParts3D, so its teeth are not an independent sample.',
      measures: measureSource('z-anatomy', zAnatomy),
    };
  }
  const openFullJaw = option('open-full-jaw');
  if (openFullJaw) {
    const patients = {};
    for (let patient = 1; patient <= OPEN_FULL_JAW.patients; patient++) {
      const directory = join(openFullJaw, `Patient_${patient}`);
      if (existsSync(directory)) {
        patients[patient] = measureSource('open-full-jaw', directory);
      }
    }
    fixture.sources['open-full-jaw'] = {
      ...describe(OPEN_FULL_JAW),
      source:
        'https://github.com/diku-dk/Open-Full-Jaw (dataset/Patient_N.zip)',
      notes:
        'In most scans the incisal edges are about 4 mm apart vertically (the mouth slightly open), so overjet and overbite are not occlusal values and stay out of the statistics. Some patients have only the mandible segmented.',
      statistics: populationStatistics(Object.values(patients)),
      patients,
    };
  }
  // Formatted as the committed fixture is.
  const text = await prettier.format(JSON.stringify(fixture), {
    ...(await prettier.resolveConfig(out)),
    filepath: out,
  });
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
