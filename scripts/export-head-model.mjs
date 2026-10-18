#!/usr/bin/env node
/**
 * Export the low-poly head model for Blender and other 3D tools: every
 * level of detail as binary glTF (materials per part, metres), Wavefront
 * OBJ (centimetres) and binary STL (millimetres, for printing).
 * scripts/blender/head_model.py turns the glTF files into a .blend scene
 * and renders it.
 *
 * Usage:
 *   node scripts/export-head-model.mjs [--out DIR] [--preset male|female|child]
 *     [--vowel IPA] [--lods 0,1,2,3]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vowelTarget } from '../src/articulation/phones.js';
import { meshesToGlb } from '../src/geometry/gltf.js';
import { MESH_LODS, meshesToObj } from '../src/geometry/mesh.js';
import { headModel } from '../src/geometry/model.js';
import { meshesToStl } from '../src/geometry/stl.js';
import { presetHeadConfig } from '../src/head-config.js';
import { getPhoneme } from '../src/ipa/inventory.js';

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const out = option('out', 'models');
const preset = option('preset', 'male');
const vowel = option('vowel', 'ə');
const lods = option('lods', MESH_LODS.map((_, lod) => lod).join(','))
  .split(',')
  .map(Number);

mkdirSync(out, { recursive: true });
const head = presetHeadConfig(preset);
const state = vowelTarget({ phoneme: getPhoneme(vowel) });
for (const lod of lods) {
  const meshes = headModel(head, { lod, state });
  const base = join(out, `head-${preset}-lod${lod}`);
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
