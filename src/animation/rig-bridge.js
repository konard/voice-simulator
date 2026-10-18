/**
 * Bridges from the face rig to the morph targets of any character model.
 *
 * Character models name their mouth shapes after one of a few
 * conventions: the 52 ARKit blendshapes (Apple face tracking, MetaHuman
 * through Live Link Face and its CTRL_expressions_* curves, Ready Player
 * Me), the 15 Oculus visemes (viseme_PP in Ready Player Me, vrc.v_pp in
 * VRChat), the five VRM 1.0 vowels (aa, ih, ou, ee, oh), the VRM 0.x and
 * VRoid vowels (A, I, U, E, O, Fcl_MTH_A, …) and the MMD vowels (あ, い,
 * う, え, お). bindRig reads the morph target names of a model, picks the
 * richest convention it supports and maps each morph target to a channel
 * of arkitBlendshapes, ovrVisemes or vrmExpressions, so one articulatory
 * plan drives every model the same way.
 */

import {
  ARKIT_BLENDSHAPES,
  OVR_VISEMES,
  VRM_VISEMES,
  rigFrames,
  rigWeights,
} from './visemes.js';

/** Vowel names of VRM 0.x, VRoid and MMD models, in VRM_VISEMES order. */
const VOWEL_ALIASES = Object.freeze({
  vrm0: ['a', 'i', 'u', 'e', 'o'],
  vroid: ['fclmtha', 'fclmthi', 'fclmthu', 'fclmthe', 'fclmtho'],
  mmd: ['あ', 'い', 'う', 'え', 'お'],
});

/** Prefixes that namespace curve names in exported models. */
const PREFIXES = [
  'ctrlexpressions',
  'blendshape1',
  'blendshapes',
  'blendshape',
  'arkit',
];

/** Fewest morph targets a model needs for each convention to count. */
const MIN_MATCHES = { arkit: 6, oculus: 5, vowels: 3 };

/** Last segment of a dotted, piped or slashed name. */
function lastSegment(name) {
  return String(name)
    .split(/[.:|/]/u)
    .at(-1);
}

/** Lower case without separators and namespace prefixes. */
function plainName(name) {
  let plain = lastSegment(name)
    .toLowerCase()
    .replace(/[\s_-]/gu, '');
  for (const prefix of PREFIXES) {
    if (plain.startsWith(prefix) && plain.length > prefix.length) {
      plain = plain.slice(prefix.length);
      break;
    }
  }
  return plain;
}

/** Oculus viseme of a name with a viseme_ or v_ prefix, if any. */
function visemeName(name) {
  const match = /^(?:viseme|v)[_\s-]?(.+)$/iu.exec(lastSegment(name));
  if (!match) {
    return null;
  }
  const key = match[1].toLowerCase();
  return OVR_VISEMES.find((viseme) => viseme.toLowerCase() === key) ?? null;
}

function arkitTargets(names) {
  const lookup = new Map(
    ARKIT_BLENDSHAPES.map((shape) => [shape.toLowerCase(), shape])
  );
  return names.flatMap((name, index) => {
    const channel = lookup.get(plainName(name));
    return channel ? [{ name, index, channel }] : [];
  });
}

function oculusTargets(names) {
  return names.flatMap((name, index) => {
    const channel = visemeName(name);
    return channel ? [{ name, index, channel }] : [];
  });
}

function vowelTargets(names) {
  const lookup = new Map();
  for (const [index, channel] of VRM_VISEMES.entries()) {
    lookup.set(channel, channel);
    for (const aliases of Object.values(VOWEL_ALIASES)) {
      lookup.set(aliases[index], channel);
    }
  }
  return names.flatMap((name, index) => {
    const channel = lookup.get(plainName(name));
    return channel ? [{ name, index, channel }] : [];
  });
}

/**
 * Map the morph targets of a character model to face rig channels.
 *
 * @param {string[]} names Morph target names, for example the keys of a
 *   three.js morphTargetDictionary or a glTF mesh's extras.targetNames.
 * @param {{format?: 'arkit'|'oculus'|'vrm'}} [options] Use this
 *   convention even when the model supports a richer one.
 * @returns {{format: 'arkit'|'oculus'|'vrm'|null,
 *   targets: {name: string, index: number, channel: string}[]}}
 *   format is null when the model has no mouth shapes the bridge knows.
 */
export function bindRig(names, options = {}) {
  const candidates = {
    arkit: arkitTargets(names),
    oculus: oculusTargets(names),
    vrm: vowelTargets(names),
  };
  const minimum = { ...MIN_MATCHES, vrm: MIN_MATCHES.vowels };
  if (options.format) {
    if (!candidates[options.format]) {
      throw new Error(`Unknown rig format: ${options.format}`);
    }
    return { format: options.format, targets: candidates[options.format] };
  }
  for (const format of ['arkit', 'oculus', 'vrm']) {
    if (candidates[format].length >= minimum[format]) {
      return { format, targets: candidates[format] };
    }
  }
  return { format: null, targets: [] };
}

/** VRM 0.x preset names of the five vowels, in VRM_VISEMES order. */
const VRM0_PRESETS = ['a', 'i', 'u', 'e', 'o'];

/**
 * Morph targets behind the vowel expressions of a VRM file. VRM models
 * declare which morph targets make each expression, so the binding does
 * not depend on how the targets are named: VRM 1.0 lists node indices
 * (extensions.VRMC_vrm.expressions.preset), VRM 0.x mesh indices and
 * weights out of 100 (extensions.VRM.blendShapeMaster).
 *
 * @param {object} json glTF JSON of a .vrm file.
 * @returns {Record<string, {node?: number, mesh?: number, index: number, weight: number}[]>|null}
 *   Binds by VRM 1.0 vowel name (aa, ih, ou, ee, oh), weights 0..1, or
 *   null for a glTF file without VRM data.
 */
export function vrmVowelBinds(json) {
  const vrm1 = json?.extensions?.VRMC_vrm?.expressions?.preset;
  if (vrm1) {
    return Object.fromEntries(
      VRM_VISEMES.map((vowel) => [
        vowel,
        (vrm1[vowel]?.morphTargetBinds ?? []).map((bind) => ({
          node: bind.node,
          index: bind.index,
          weight: bind.weight ?? 1,
        })),
      ])
    );
  }
  const groups = json?.extensions?.VRM?.blendShapeMaster?.blendShapeGroups;
  if (!groups) {
    return null;
  }
  return Object.fromEntries(
    VRM_VISEMES.map((vowel, index) => {
      const group = groups.find(
        (entry) => entry.presetName?.toLowerCase() === VRM0_PRESETS[index]
      );
      return [
        vowel,
        (group?.binds ?? []).map((bind) => ({
          mesh: bind.mesh,
          index: bind.index,
          weight: (bind.weight ?? 100) / 100,
        })),
      ];
    })
  );
}

/**
 * Morph target weights of a bound model for one face rig.
 *
 * @param {{format: string|null, targets: {name: string, channel: string}[]}} binding
 * @param {ReturnType<typeof import('./visemes.js').faceRig>} rig
 * @returns {Record<string, number>} Weight 0..1 by morph target name.
 */
export function rigFrame(binding, rig) {
  if (!binding.format) {
    return {};
  }
  const weights = rigWeights(rig, binding.format);
  const frame = {};
  for (const { name, channel } of binding.targets) {
    frame[name] = Math.max(frame[name] ?? 0, weights[channel]);
  }
  return frame;
}

/**
 * Animation of a character model's morph targets over an utterance.
 *
 * @param {{duration: number}} plan Articulation plan (planUtterance).
 * @param {object} head Head configuration.
 * @param {string[]} names Morph target names of the model.
 * @param {{fps?: number, maxOpening?: number, format?: 'arkit'|'oculus'|'vrm'}} [options]
 * @returns {{format: string|null, fps: number, duration: number,
 *   names: string[], frames: {time: number, weights: number[]}[]}}
 *   weights follow names; morph targets the bridge does not drive stay 0.
 */
export function characterTrack(plan, head, names, options = {}) {
  const binding = bindRig(names, options);
  const { fps, frames } = rigFrames(plan, head, options, (rig) => {
    const frame = rigFrame(binding, rig);
    return names.map((name) => Math.round((frame[name] ?? 0) * 1e4) / 1e4);
  });
  return {
    format: binding.format,
    fps,
    duration: plan.duration,
    names: [...names],
    frames,
  };
}
