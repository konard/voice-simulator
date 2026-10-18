// Hard palate and velum of the Z-Anatomy head (CC BY-SA 4.0), measured
// like the model in issue-9-palate-measures.mjs. The STL files come from
// scripts/blender/z_anatomy_export.py (mm; +x left, -y anterior, +z up).
// Usage: node experiments/issue-9-palate-za.mjs <directory with the STLs>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStl } from '../src/geometry/stl.js';
import { axisPlane, meshBounds, sliceMesh } from '../src/geometry/slice.js';

const dir = process.argv[2];
const load = (name) => parseStl(readFileSync(join(dir, `${name}.stl`)));
const points = (mesh) =>
  Array.from({ length: mesh.positions.length / 3 }, (_, i) => [
    mesh.positions[i * 3],
    mesh.positions[i * 3 + 1],
    mesh.positions[i * 3 + 2],
  ]);
const centroid = (list) =>
  [0, 1, 2].map((a) => list.reduce((s, p) => s + p[a], 0) / list.length);
// The palatine bones stop short of the midline: cut 1.2 mm to each side.
const midSegments = (meshes) =>
  meshes.flatMap((m) =>
    [-1.2, 1.2].flatMap((x) => sliceMesh(m, axisPlane(0, x)).flat())
  );

const bones = [
  'Maxilla.l',
  'Maxilla.r',
  'Palatine_bone.l',
  'Palatine_bone.r',
].map(load);
const mid = midSegments(bones);
const molars = ['l', 'r'].map((s) => load(`Upper_second_molar_tooth.${s}`));
const m1 = ['l', 'r'].map((s) => load(`Upper_first_molar_tooth.${s}`));
const incisors = ['l', 'r'].map((s) => load(`Upper_medial_incisor.${s}`));
const cusps = (mesh) => meshBounds(mesh).min[2];
const m2 = molars.map((m) => centroid(points(m)));
const m2y = (m2[0][1] + m2[1][1]) / 2;
const m2occlusal = (cusps(molars[0]) + cusps(molars[1])) / 2;
const m1y = m1.map((m) => centroid(points(m))[1]).reduce((a, b) => a + b) / 2;
const m1occlusal = (cusps(m1[0]) + cusps(m1[1])) / 2;
const edge = Math.min(...incisors.map(cusps));
const incisorY = Math.min(...incisors.map((m) => meshBounds(m).min[1]));
// The oral surface of the bony palate at the midline: lowest crossing
// within 1.5 mm of a given y, above the teeth.
const oralAt = (y) =>
  Math.min(
    ...mid
      .filter((p) => Math.abs(p[1] - y) < 1.5 && p[2] > edge + 5)
      .map((p) => p[2])
  );
const nasalAt = (y) =>
  Math.max(
    ...mid
      .filter((p) => Math.abs(p[1] - y) < 1.5 && p[2] < oralAt(y) + 15)
      .map((p) => p[2])
  );
// Staphylion / PNS: the hindmost midline point of the palatine bones.
const palatineMid = midSegments(bones.slice(2));
const pns = palatineMid.reduce((a, b) => (b[1] > a[1] ? b : a));
// Orale: the midline oral surface just behind the central incisors.
const lingual = Math.max(...incisors.map((m) => meshBounds(m).max[1]));
const orale = [0, lingual, oralAt(lingual)];
// Gingiva-free bony breadth at M2: palate width between the lowest
// lateral oral surfaces at the M2 level (coronal slice).
const coronal = bones.flatMap((m) => sliceMesh(m, axisPlane(1, m2y)).flat());
const apex = oralAt(m2y);
const shelf = coronal.filter((p) => Math.abs(p[2] - (apex - 8)) < 1);
const breadth = shelf.length
  ? Math.max(...shelf.map((p) => p[0])) - Math.min(...shelf.map((p) => p[0]))
  : NaN;
const soft = ['Soft_palate', 'Uvula_of_palate'].map(load);
const velumPoints = soft.flatMap(points);
const tip = velumPoints.reduce((a, b) => (b[2] < a[2] ? b : a));
const softMid = midSegments(soft);
// Thickness: widest cut of the midsagittal outline across the PNS-tip line.
const axis = [tip[1] - pns[1], tip[2] - pns[2]];
const len = Math.hypot(...axis);
const along = (p) =>
  ((p[1] - pns[1]) * axis[0] + (p[2] - pns[2]) * axis[1]) / len;
const across = (p) =>
  ((p[1] - pns[1]) * -axis[1] + (p[2] - pns[2]) * axis[0]) / len;
let thickness = 0;
for (let t = 0; t < len; t += 0.5) {
  const cut = softMid.filter((p) => Math.abs(along(p) - t) < 0.5).map(across);
  if (cut.length > 1) {
    thickness = Math.max(thickness, Math.max(...cut) - Math.min(...cut));
  }
}
const r = (v) => Math.round(v * 10) / 10;
console.log(
  JSON.stringify(
    {
      vaultLength: r(Math.hypot(pns[1] - orale[1], pns[2] - orale[2])),
      vaultHeightAboveM2Cusps: r(apex - m2occlusal),
      vaultHeightAboveM1Cusps: r(oralAt(m1y) - m1occlusal),
      incisalEdgeToVaultAtM1: r(oralAt(m1y) - edge),
      palateThicknessAtM1: r(nasalAt(m1y) - oralAt(m1y)),
      breadth8mmBelowApexAtM2: r(breadth),
      pnsBehindM2: r(pns[1] - m2y),
      incisorsToM2: r(m2y - incisorY),
      velumLengthStraight: r(len),
      velumThickness: r(thickness),
      uvulaLength: r(meshBounds(soft[1]).max[2] - meshBounds(soft[1]).min[2]),
    },
    null,
    1
  )
);
