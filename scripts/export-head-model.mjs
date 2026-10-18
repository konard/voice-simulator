#!/usr/bin/env node
/**
 * Export the low-poly head model for Blender and other 3D tools: every
 * level of detail as binary glTF (materials per part, metres), Wavefront
 * OBJ (centimetres) and binary STL (millimetres, for printing).
 * scripts/blender/head_model.py turns the glTF files into a .blend scene
 * and renders it.
 *
 * Parts can come from other anatomy sources (src/geometry/anatomy-sources.js):
 * `--anatomy hra-male` takes every part of the HuBMAP HRA Visible Human
 * male (fetched just in time, CC BY 4.0), `--anatomy tongue=hra-female,palate=hra-male`
 * one source per part, `--source NAME=FILE.glb` adds a glTF binary of your
 * own (metres, the body's left at -x; `--mirror` when it is at +x),
 * `--scale` scales the sources to the head and `--fit-head` sets the
 * head's mouthWidth from the first source's dental arch.
 *
 * Usage:
 *   node scripts/export-head-model.mjs [--out DIR] [--preset male|female|child]
 *     [--vowel IPA] [--lods 0,1,2,3] [--anatomy SPEC] [--source NAME=FILE]
 *     [--mirror] [--scale] [--fit-head]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vowelTarget } from '../src/articulation/phones.js';
import {
  anatomySourceFromGlb,
  anatomySourceNames,
  registerAnatomySource,
  sourceHead,
} from '../src/geometry/anatomy-sources.js';
import { meshesToGlb } from '../src/geometry/gltf.js';
import { MESH_LODS, meshesToObj } from '../src/geometry/mesh.js';
import { headModel } from '../src/geometry/model.js';
import { meshesToStl } from '../src/geometry/stl.js';
import { presetHeadConfig } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';
import { hraSource } from './fetch-anatomy.mjs';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const flag = (name) => process.argv.includes(`--${name}`);

/** `name` or `part=name,part=name` as anatomySelection() takes it. */
function parseAnatomy(spec) {
  if (!spec || !spec.includes('=')) {
    return spec;
  }
  return Object.fromEntries(spec.split(',').map((pair) => pair.split('=')));
}

/** Register the sources a selection names: HRA just in time, or files. */
async function loadSources(selection) {
  const file = option('source');
  if (file) {
    const [name, path] = file.split('=');
    registerAnatomySource(
      anatomySourceFromGlb(name, readFileSync(path), { mirror: flag('mirror') })
    );
  }
  const names = new Set(
    typeof selection === 'string' ? [selection] : Object.values(selection)
  );
  for (const name of names) {
    const sex = /^hra-(male|female)$/u.exec(name)?.[1];
    if (sex && !anatomySourceNames().includes(name)) {
      registerAnatomySource(await hraSource(sex));
    }
  }
  return [...names][0];
}

const out = option('out', 'models');
const preset = option('preset', 'male');
const vowel = option('vowel', 'ə');
const lods = option('lods', MESH_LODS.map((_, lod) => lod).join(','))
  .split(',')
  .map(Number);

const anatomy = parseAnatomy(option('anatomy'));
const first = anatomy ? await loadSources(anatomy) : undefined;
const label = anatomy
  ? `-${String(option('anatomy')).replace(/[=,]/gu, '-')}`
  : '';

mkdirSync(out, { recursive: true });
const presetHead = presetHeadConfig(preset);
const head =
  first && flag('fit-head') ? sourceHead(presetHead, first) : presetHead;
const state = vowelTarget({ phoneme: getPhoneme(vowel) });
for (const lod of lods) {
  const meshes = headModel(head, { lod, state, anatomy, scale: flag('scale') });
  const base = join(out, `head-${preset}${label}-lod${lod}`);
  const triangles = meshes.reduce(
    (sum, mesh) => sum + mesh.indices.length / 3,
    0
  );
  writeFileSync(
    `${base}.glb`,
    meshesToGlb(meshes, { generator: 'voice-simulator export-head-model' })
  );
  writeFileSync(`${base}.obj`, meshesToObj(meshes));
  writeFileSync(
    `${base}.stl`,
    meshesToStl(meshes, {
      scale: 10,
      header: `voice-simulator ${preset} head, LOD ${lod}, mm`,
    })
  );
  console.log(`${base}.{glb,obj,stl}: ${triangles} triangles`);
}
