/**
 * The HuBMAP Human Reference Atlas 3D reference organs of the Visible
 * Human male and female (CC BY 4.0): the mouth and larynx parts the head
 * model is compared with and can take articulators from, fetched just in
 * time from the HRA CDN with HTTP range requests for only the bytes of
 * those parts.
 */

import { anatomySource } from './anatomy-sources.js';
import { fetchGlbMeshes } from './gltf-read.js';
import { HRA_PARTS, mirrorX } from './reference-anatomy.js';

const HRA_ORGANS = 'https://cdn.humanatlas.io/digital-objects/ref-organ';

export const HRA = Object.freeze({
  name: 'HuBMAP Human Reference Atlas 3D reference organs (Visible Human)',
  citation:
    'Schlehlein H, Herr BW II, Quardokus EM, Bueckle A, Börner K (2024) HuBMAP CCF 3D Reference Object Library; mouth and larynx: Schlehlein H (2024), Human Reference Atlas, doi:10.48539/HBM568.RFGM.978',
  license: 'CC BY 4.0, HuBMAP',
  urls: Object.freeze({
    male: Object.freeze([
      `${HRA_ORGANS}/mouth-male/v1.0/assets/3d-vh-m-mouth.glb`,
      `${HRA_ORGANS}/larynx-male/v1.1/assets/3d-vh-m-larynx.glb`,
    ]),
    female: Object.freeze([
      `${HRA_ORGANS}/mouth-female/v1.0/assets/3d-vh-f-mouth.glb`,
      `${HRA_ORGANS}/larynx-female/v1.1/assets/3d-vh-f-larynx.glb`,
    ]),
  }),
  units: 'metres; +x body left, +y superior, +z anterior',
});

/**
 * The HRA parts that reference-anatomy.js uses, in millimetres in the
 * head frame (body left at -x).
 * @param {'male'|'female'} sex
 * @param {{fetchFn?: typeof fetch}} [options]
 * @returns {Promise<{name: string, positions: Float64Array, indices: Uint32Array}[]>}
 */
export async function fetchHra(sex, options = {}) {
  const names = (name) => Object.values(HRA_PARTS).some((test) => test(name));
  const meshes = [];
  for (const url of HRA.urls[sex]) {
    meshes.push(
      ...(await fetchGlbMeshes(url, { ...options, names, scale: 1000 }))
    );
  }
  return mirrorX(meshes);
}

/**
 * The HRA Visible Human male or female as an anatomy source named
 * `hra-male` or `hra-female` (see src/geometry/anatomy-sources.js).
 * @param {'male'|'female'} sex
 * @param {{fetchFn?: typeof fetch}} [options]
 */
export async function hraSource(sex, options = {}) {
  return anatomySource(`hra-${sex}`, await fetchHra(sex, options), {
    citation: HRA.citation,
    license: HRA.license,
  });
}
