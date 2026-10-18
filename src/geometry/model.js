/**
 * Complete low-poly head model: skin, vocal tract, nasal tract, lips,
 * teeth, tongue, hard and soft palate for a head configuration and an
 * articulator state.
 */

import { noseShape, tractShape } from '../articulation/tract-shape.js';
import { normalizeHeadConfig } from '../head-config.js';
import { anatomyMeshes } from './anatomy.js';
import { composeAnatomy } from './anatomy-sources.js';
import { meshesToGlb } from './gltf.js';
import { nasalCenterline, tractCenterline } from './centerline.js';
import { lipsMesh } from './lips.js';
import {
  MESH_LODS,
  headMesh,
  meshesToObj,
  noseAxes,
  tractAxes,
  tubeMesh,
} from './mesh.js';

/**
 * Build all meshes of the head.
 * @param {Record<string, number>} head
 * @param {{lod?: number, state?: object, anatomy?: string|object, scale?: boolean}} [options]
 *   `state` is an articulator state (see sampleState); `anatomy` takes
 *   articulators from registered sources (see composeAnatomy), `scale`
 *   scales them to the head.
 * @returns {{name: string, positions: Float32Array, indices: Uint32Array}[]}
 */
export function headModel(head, options = {}) {
  const config = normalizeHeadConfig(head);
  const lod = Math.min(MESH_LODS.length - 1, Math.max(0, options.lod ?? 1));
  const shape = tractShape(options.state ?? {}, config);
  const tube = {
    lod,
    axes: tractAxes(config, tractShape({}, config).areas),
  };
  const tractPath = tractCenterline(config, {
    sections: shape.areas.length,
    length: shape.length,
  });
  const nose = noseShape(config);
  const velumDistance =
    ((shape.velumIndex + 0.5) / shape.areas.length) * shape.length;
  const nosePath = nasalCenterline(config, {
    sections: nose.areas.length,
    velumDistance,
    length: nose.length,
    tractLength: shape.length,
  });
  return [
    { name: 'head', ...headMesh(config, { lod }) },
    { name: 'tract', ...tubeMesh(tractPath, shape.areas, tube) },
    {
      name: 'nose',
      ...tubeMesh(nosePath, nose.areas, { lod, axes: noseAxes }),
    },
    {
      name: 'lips',
      ...lipsMesh(config, {
        area: shape.areas.at(-1),
        rounding: options.state?.rounding ?? 0,
        lod,
      }),
    },
    ...(options.anatomy
      ? composeAnatomy(config, {
          lod,
          state: options.state,
          shape,
          anatomy: options.anatomy,
          scale: options.scale,
        })
      : anatomyMeshes(config, { lod, state: options.state, shape })),
  ];
}

/**
 * Wavefront OBJ of the whole head model.
 * @param {Record<string, number>} head
 * @param {{lod?: number, state?: object}} [options]
 */
export function headModelObj(head, options = {}) {
  return meshesToObj(headModel(head, options));
}

/**
 * Binary glTF 2.0 of the whole head model in metres, with a material per
 * part (opens in Blender with File > Import > glTF 2.0).
 * @param {Record<string, number>} head
 * @param {{lod?: number, state?: object}} [options]
 */
export function headModelGlb(head, options = {}) {
  return meshesToGlb(headModel(head, options));
}
