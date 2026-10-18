#!/usr/bin/env node
// Fetch segmented anatomy of the mouth, pharynx and larynx just in time,
// so it never has to be committed (the licences allow attribution-only or
// share-alike use, and Open-Full-Jaw is non-commercial): only the members
// that are needed are read from each remote zip with HTTP range requests.
//
//   bodyparts3d    BodyParts3D 4.0 (DBCLS, CC BY 4.0): one OBJ per tooth
//                  and per organ, millimetres.
//   open-full-jaw  Open-Full-Jaw (Gholamalizadeh et al. 2022, CC BY-NC-SA
//                  4.0): teeth segmented from the CBCT of 17 patients, one
//                  STL per tooth, millimetres.
//   z-anatomy      Z-Anatomy atlas (CC BY-SA 4.0): Startup.blend, from
//                  which scripts/blender/z_anatomy_export.py writes STLs.
//   hra-male       Human Reference Atlas 3D reference organs of the mouth
//   hra-female     (Visible Human male and female, CC BY 4.0): one glTF
//                  binary per sex, of which only the teeth, palate and
//                  tongue are read into a small mouth.glb, metres.
//
// Usage: node scripts/fetch-anatomy.mjs <source> <output directory>
//          [--patients 1,2,...] [--blender path/to/blender]
//   Each source goes into its own new directory. Downloaded files are data:
//   nothing in them is executed (the .blend file is opened by Blender with
//   --factory-startup --disable-autoexec).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { meshesToGlb } from '../src/geometry/gltf.js';
import {
  GLB_HEADER_BYTES,
  accessorSpan,
  glbBinaryOffset,
  glbJsonLength,
  gltfMeshes,
  meshAccessors,
  readGlb,
} from '../src/geometry/gltf-read.js';
import { mergeMeshes } from '../src/geometry/mouth-landmarks.js';
import { parseStl } from '../src/geometry/stl.js';
import { connectedPieces, numberTeeth } from '../src/geometry/tooth-row.js';
import { fetchMember, fetchRange, listMembers } from './fetch-dvtd.mjs';

export const BODYPARTS3D = Object.freeze({
  name: 'BodyParts3D 4.0, is-a tree (Database Center for Life Science)',
  citation:
    'Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K (2009) BodyParts3D: 3D structure database for anatomical concepts. Nucleic Acids Research 37, D782-D785. doi:10.1093/nar/gkn613',
  license: 'CC BY 4.0, BodyParts3D, (c) The Database Center for Life Science',
  url: 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip',
  size: 142903898,
  units: 'millimetres; +x left, +y posterior, +z superior',
});

export const OPEN_FULL_JAW = Object.freeze({
  name: 'Open-Full-Jaw',
  citation:
    'Gholamalizadeh T, Moshfeghifar F, Ferguson Z, Schneider T, Panozzo D, Darkner S, Makaremi M, Chan F, Søndergaard PL, Erleben K (2022) Open-Full-Jaw: an open-access dataset and pipeline for finite element models of human jaw. Computer Methods and Programs in Biomedicine 224, 107009. doi:10.1016/j.cmpb.2022.107009',
  license:
    'CC BY-NC-SA 4.0: downloaded at run time only, never committed or rendered',
  url: (patient) =>
    `https://media.githubusercontent.com/media/diku-dk/Open-Full-Jaw/main/dataset/Patient_${patient}.zip`,
  patients: 17,
  units: 'millimetres, CBCT scanner frame',
});

export const Z_ANATOMY = Object.freeze({
  name: 'Z-Anatomy',
  citation:
    'Gauthier M et al., Z-Anatomy, an open-source 3D atlas of human anatomy built on BodyParts3D, https://www.z-anatomy.com',
  license: 'CC BY-SA 4.0',
  url: 'https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/master/Z-Anatomy.zip',
  size: 86734957,
  member: 'Z-Anatomy/Startup.blend',
  units: 'millimetres; +x left, -y anterior, +z superior',
});

const HRA_CITATION = (sex, doi) =>
  `Schlehlein H (2023) 3D Reference Organ for Mouth, ${sex}, v1.0. Human Reference Atlas, HuBMAP. doi:${doi}. Built on the Visible Human Project: Ackerman MJ (1998) The Visible Human Project. Proceedings of the IEEE 86(3), 504-511. doi:10.1109/5.662875`;

/** Human Reference Atlas reference organs of the mouth, by source name. */
export const HRA_MOUTH = Object.freeze({
  'hra-male': Object.freeze({
    name: 'Human Reference Atlas, 3D reference organ: mouth, male, v1.0',
    citation: HRA_CITATION('Male', '10.48539/HBM568.RFGM.978'),
    license: 'CC BY 4.0, HuBMAP Human Reference Atlas',
    url: 'https://cdn.humanatlas.io/digital-objects/ref-organ/mouth-male/v1.0/assets/3d-vh-m-mouth.glb',
    size: 53487620,
    prefix: 'VH_M_',
    units:
      'metres; +x left, +y superior, +z anterior (Visible Human male body frame)',
  }),
  'hra-female': Object.freeze({
    name: 'Human Reference Atlas, 3D reference organ: mouth, female, v1.0',
    citation: HRA_CITATION('Female', '10.48539/HBM856.VZWZ.422'),
    license: 'CC BY 4.0, HuBMAP Human Reference Atlas',
    url: 'https://cdn.humanatlas.io/digital-objects/ref-organ/mouth-female/v1.0/assets/3d-vh-f-mouth.glb',
    size: 103690760,
    prefix: 'VH_F_',
    units:
      'metres; +x left, +y superior, +z anterior (Visible Human female body frame)',
  }),
});

/** Parts of the HRA mouth that are read, by their node names after the prefix. */
export const HRA_PARTS = Object.freeze({
  upperTeeth: 'set_of_upper_jaw_teeth',
  lowerTeeth: 'set_of_lower_jaw_teeth',
  palate: 'hard_palate',
  velum: 'mucosa_of_soft_palate',
  tongueDorsum: 'dorsal_tongue',
  tongueVentral: 'ventral_tongue',
  tongueRoot: 'posterior_part_of_tongue',
});

/** File fetchAnatomy() writes for an HRA source. */
export const HRA_FILE = 'mouth.glb';

/**
 * BodyParts3D files of the permanent teeth (left and right of the body),
 * central incisor to second molar.
 */
export const BODYPARTS3D_TEETH = Object.freeze({
  upper: {
    l: ['FJ1265', 'FJ1266', 'FJ1267', 'FJ1262', 'FJ1264', 'FJ1261', 'FJ1263'],
    r: ['FJ1279', 'FJ1280', 'FJ1281', 'FJ1277', 'FJ1278', 'FJ1276', 'FJ1275'],
  },
  lower: {
    l: ['FJ1258', 'FJ1259', 'FJ1260', 'FJ1255', 'FJ1257', 'FJ1254', 'FJ1256'],
    r: ['FJ1272', 'FJ1273', 'FJ1274', 'FJ1269', 'FJ1271', 'FJ1268', 'FJ1270'],
  },
});

/** Z-Anatomy tooth names as the Blender export writes them. */
export const Z_ANATOMY_TEETH = Object.freeze([
  'medial_incisor',
  'lateral_incisor',
  'canine',
  'first_premolar',
  'second_premolar',
  'first_molar_tooth',
  'second_molar_tooth',
]);

/**
 * Jaw, side and type (0 = central incisor .. 6 = second molar) of a tooth
 * in the universal numbering Open-Full-Jaw uses: 1-16 upper from the
 * right third molar, 17-32 lower from the left third molar. Third molars
 * give null.
 * @param {number} number
 */
export function universalTooth(number) {
  const quadrants = [
    { jaw: 'upper', side: 'r', type: 8 - number },
    { jaw: 'upper', side: 'l', type: number - 9 },
    { jaw: 'lower', side: 'l', type: 24 - number },
    { jaw: 'lower', side: 'r', type: number - 25 },
  ];
  const tooth = quadrants[Math.floor((number - 1) / 8)];
  return tooth && tooth.type >= 0 && tooth.type < 7 ? tooth : null;
}

/** Vertices of a Wavefront OBJ file as a flat array. */
export function objPositions(text) {
  const positions = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.trim().split(/\s+/);
      positions.push(Number(x), Number(y), Number(z));
    }
  }
  return Float64Array.from(positions);
}

/**
 * Parts of a fetched HRA mouth (HRA_PARTS keys), in millimetres in the
 * atlas frame.
 * @param {string} directory What fetchAnatomy() wrote.
 * @returns {Record<string, {positions: Float32Array, indices: Uint32Array}>}
 */
export function loadHraMouth(directory) {
  const { meshes } = readGlb(
    new Uint8Array(readFileSync(join(directory, HRA_FILE)))
  );
  return Object.fromEntries(
    meshes.map(({ name, positions, indices }) => [
      name,
      { positions: positions.map((value) => value * 1000), indices },
    ])
  );
}

/**
 * A fetched HRA mouth as mouthLandmarks() parts: the tongue's dorsum,
 * underside and root joined into one tongue.
 * @param {string} directory
 */
export function hraMouthParts(directory) {
  const { tongueDorsum, tongueVentral, tongueRoot, ...parts } =
    loadHraMouth(directory);
  return {
    ...parts,
    tongue: mergeMeshes([tongueDorsum, tongueVentral, tongueRoot]),
  };
}

/**
 * Teeth of a fetched source, ready for toothLandmarks().
 * @param {'bodyparts3d'|'open-full-jaw'|'z-anatomy'|'hra-male'|'hra-female'} source
 * @param {string} directory What fetchAnatomy() wrote.
 */
export function loadDentition(source, directory) {
  const stl = (file) => parseStl(new Uint8Array(readFileSync(file))).positions;
  const teeth = [];
  if (HRA_MOUTH[source]) {
    const parts = loadHraMouth(directory);
    return [
      ...numberTeeth(connectedPieces(parts.upperTeeth), 'upper'),
      ...numberTeeth(connectedPieces(parts.lowerTeeth), 'lower'),
    ];
  }
  if (source === 'open-full-jaw') {
    for (let number = 1; number <= 32; number++) {
      const file = join(directory, `tooth_${number}.stl`);
      const tooth = universalTooth(number);
      if (tooth && existsSync(file)) {
        teeth.push({ ...tooth, positions: stl(file) });
      }
    }
    return teeth;
  }
  for (const jaw of ['upper', 'lower']) {
    for (const side of ['l', 'r']) {
      for (let type = 0; type < 7; type++) {
        const file =
          source === 'bodyparts3d'
            ? join(directory, `${BODYPARTS3D_TEETH[jaw][side][type]}.obj`)
            : join(
                directory,
                `${jaw === 'upper' ? 'Upper' : 'Lower'}_${Z_ANATOMY_TEETH[type]}.${side}.stl`
              );
        const positions =
          source === 'bodyparts3d'
            ? objPositions(readFileSync(file, 'utf8'))
            : stl(file);
        teeth.push({ jaw, side, type, positions });
      }
    }
  }
  return teeth;
}

async function remoteSize(url) {
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(`${url}: HEAD answered ${response.status}`);
  }
  return Number(response.headers.get('content-length'));
}

async function fetchMembers(url, size, wanted, output) {
  const members = (await listMembers(url, size)).filter((member) =>
    wanted(member.name)
  );
  mkdirSync(output, { recursive: true });
  for (const member of members) {
    writeFileSync(
      join(output, basename(member.name)),
      await fetchMember(member, url)
    );
  }
  return members.map((member) => basename(member.name));
}

/**
 * Read the HRA_PARTS of a remote HRA mouth with range requests (the JSON
 * and only the accessors those parts use, about a third of the file) and
 * write them, named by their HRA_PARTS keys, as one glTF binary.
 * @param {{url: string, prefix: string}} atlas An HRA_MOUTH entry.
 * @param {string} output
 * @param {(url: string, start: number, end: number) => Promise<Buffer>}
 *   [fetcher] bytes [start, end) of a URL, as fetchRange() reads them.
 */
export async function fetchHraMouth(atlas, output, fetcher = fetchRange) {
  const header = await fetcher(atlas.url, 0, GLB_HEADER_BYTES);
  const jsonLength = glbJsonLength(new Uint8Array(header));
  const json = JSON.parse(
    (await fetcher(atlas.url, GLB_HEADER_BYTES, GLB_HEADER_BYTES + jsonLength))
      .toString('utf8')
      .trimEnd()
  );
  const names = Object.values(HRA_PARTS).map((part) => atlas.prefix + part);
  const binary = glbBinaryOffset(jsonLength);
  const spans = new Map();
  for (const accessor of meshAccessors(json, { names })) {
    const { start, end } = accessorSpan(json, accessor);
    spans.set(
      accessor,
      new Uint8Array(await fetcher(atlas.url, binary + start, binary + end))
    );
  }
  const keys = Object.fromEntries(
    Object.entries(HRA_PARTS).map(([key, part]) => [atlas.prefix + part, key])
  );
  const meshes = gltfMeshes(json, (accessor) => spans.get(accessor), {
    names,
  }).map((mesh) => ({ ...mesh, name: keys[mesh.name] }));
  mkdirSync(output, { recursive: true });
  writeFileSync(
    join(output, HRA_FILE),
    meshesToGlb(meshes, { scale: 1, generator: atlas.name })
  );
  return [HRA_FILE];
}

/**
 * Download the teeth (and, for Z-Anatomy, the atlas file) of a source.
 * @param {'bodyparts3d'|'open-full-jaw'|'z-anatomy'|'hra-male'|'hra-female'} source
 * @param {string} output
 * @param {{patients?: number[]}} [options]
 * @returns {Promise<string[]>} Files written.
 */
export async function fetchAnatomy(source, output, options = {}) {
  if (source === 'bodyparts3d') {
    const files = new Set(
      Object.values(BODYPARTS3D_TEETH).flatMap((sides) =>
        Object.values(sides).flat()
      )
    );
    return fetchMembers(
      BODYPARTS3D.url,
      BODYPARTS3D.size,
      (name) => files.has(basename(name, '.obj')),
      output
    );
  }
  if (source === 'open-full-jaw') {
    const patients =
      options.patients ??
      Array.from({ length: OPEN_FULL_JAW.patients }, (_, index) => index + 1);
    const written = [];
    for (const patient of patients) {
      const url = OPEN_FULL_JAW.url(patient);
      const files = await fetchMembers(
        url,
        await remoteSize(url),
        (name) =>
          /\/input\/(maxilla|mandible)\/teeth\/tooth_\d+\.stl$/.test(name),
        join(output, `Patient_${patient}`)
      );
      written.push(...files.map((file) => join(`Patient_${patient}`, file)));
    }
    return written;
  }
  if (HRA_MOUTH[source]) {
    return fetchHraMouth(HRA_MOUTH[source], output);
  }
  if (source === 'z-anatomy') {
    return fetchMembers(
      Z_ANATOMY.url,
      Z_ANATOMY.size,
      (name) => name === Z_ANATOMY.member,
      output
    );
  }
  throw new Error(`unknown anatomy source ${source}`);
}

/**
 * Export the Z-Anatomy organs and teeth as STLs with Blender, running
 * none of the scripts in the atlas.
 * @param {string} blender Blender executable.
 * @param {string} blend Startup.blend from fetchAnatomy('z-anatomy').
 * @param {string} output
 */
export function exportZAnatomy(blender, blend, output) {
  const script = join(
    dirname(fileURLToPath(import.meta.url)),
    'blender',
    'z_anatomy_export.py'
  );
  const result = spawnSync(
    blender,
    [
      '--background',
      '--factory-startup',
      '--disable-autoexec',
      '--python',
      script,
      '--',
      '--blend',
      blend,
      '--out',
      output,
    ],
    { encoding: 'utf8', cwd: dirname(script), maxBuffer: 64 << 20 }
  );
  if (result.status !== 0) {
    throw new Error(`Blender failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split('\n')
    .filter((line) => line.startsWith('z_anatomy:'));
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [source, output] = process.argv.slice(2);
  const patients = option('patients')?.split(',').map(Number);
  const files = await fetchAnatomy(source, output, { patients });
  files.forEach((file) => console.log(join(output, file)));
  const blender = option('blender') ?? process.env.BLENDER;
  if (source === 'z-anatomy' && blender) {
    const lines = exportZAnatomy(
      blender,
      join(output, basename(Z_ANATOMY.member)),
      join(output, 'stl')
    );
    lines.forEach((line) => console.log(line));
  }
}
