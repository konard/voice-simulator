import { describe, expect, it } from 'test-anywhere';

import {
  ARKIT_BLENDSHAPES,
  OVR_VISEMES,
  bindRig,
  characterTrack,
  faceRig,
  prepareUtterance,
  rigFrame,
  sampleState,
  vrmVowelBinds,
} from '../src/index.js';

/** Rig in the middle of the first sound of an IPA string. */
function rigOf(ipa) {
  const { plan, head } = prepareUtterance(ipa, { ipa: true });
  const segment = plan.segments.find((entry) => entry.kind !== 'pause');
  return faceRig(sampleState(plan, (segment.start + segment.end) / 2), head);
}

describe('bindRig', () => {
  it('reads ARKit names as written by MetaHuman, Blender and glTF exporters', () => {
    const names = [
      'CTRL_expressions_jawOpen',
      'blendShape1.mouthClose',
      'Mouth_Funnel',
      'mouthPucker',
      'MouthStretchLeft',
      'mouth_stretch_right',
      'eyeBlinkLeft',
      'hair_long',
    ];
    const binding = bindRig(names);
    expect(binding.format).toBe('arkit');
    expect(binding.targets.map((target) => target.channel)).toEqual([
      'jawOpen',
      'mouthClose',
      'mouthFunnel',
      'mouthPucker',
      'mouthStretchLeft',
      'mouthStretchRight',
      'eyeBlinkLeft',
    ]);
    expect(binding.targets[6].index).toBe(6);
  });

  it('reads Ready Player Me and VRChat visemes', () => {
    const rpm = bindRig(OVR_VISEMES.map((viseme) => `viseme_${viseme}`));
    expect(rpm.format).toBe('oculus');
    expect(rpm.targets.length).toBe(15);
    const vrchat = bindRig(
      OVR_VISEMES.map((viseme) => `vrc.v_${viseme.toLowerCase()}`)
    );
    expect(vrchat.format).toBe('oculus');
    expect(vrchat.targets.length).toBe(15);
  });

  it('reads the vowels of VRM 1.0, VRM 0.x, VRoid and MMD models', () => {
    const cases = [
      ['aa', 'ih', 'ou', 'ee', 'oh'],
      ['A', 'I', 'U', 'E', 'O'],
      ['Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_E', 'Fcl_MTH_O'],
      ['あ', 'い', 'う', 'え', 'お'],
    ];
    for (const names of cases) {
      const binding = bindRig(['Fcl_EYE_Close', ...names]);
      expect(binding.format).toBe('vrm');
      expect(binding.targets.map((target) => target.channel)).toEqual([
        'aa',
        'ih',
        'ou',
        'ee',
        'oh',
      ]);
    }
  });

  it('prefers the richest convention and honours a requested one', () => {
    const names = [
      ...ARKIT_BLENDSHAPES,
      ...OVR_VISEMES.map((viseme) => `viseme_${viseme}`),
    ];
    expect(bindRig(names).format).toBe('arkit');
    expect(bindRig(names, { format: 'oculus' }).targets.length).toBe(15);
    expect(() => bindRig(names, { format: 'fbx' })).toThrow();
  });

  it('binds nothing on a model without mouth shapes', () => {
    expect(bindRig(['Body', 'hair_long', 'smile'])).toEqual({
      format: null,
      targets: [],
    });
    expect(rigFrame(bindRig([]), rigOf('a'))).toEqual({});
  });
});

describe('rigFrame and characterTrack', () => {
  it('drives the same articulation through every convention', () => {
    const arkit = bindRig(ARKIT_BLENDSHAPES.slice(14, 41));
    const oculus = bindRig(OVR_VISEMES.map((viseme) => `viseme_${viseme}`));
    const vroid = bindRig(['Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U']);
    const m = rigOf('m');
    expect(rigFrame(arkit, m).mouthClose).toBeGreaterThan(0);
    expect(rigFrame(oculus, m).viseme_PP).toBeGreaterThan(0.5);
    expect(rigFrame(vroid, m).Fcl_MTH_A).toBeLessThan(0.01);
    expect(rigFrame(vroid, rigOf('ɑ')).Fcl_MTH_A).toBeGreaterThan(0.5);
  });

  it('writes one weight per morph target and frame', () => {
    const { plan, head } = prepareUtterance('ˈmama', { ipa: true });
    const names = ['Body', 'Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_O'];
    const track = characterTrack(plan, head, names, { fps: 30 });
    expect(track.format).toBe('vrm');
    expect(track.names).toEqual(names);
    expect(track.frames.length).toBe(Math.floor(plan.duration * 30) + 1);
    for (const frame of track.frames) {
      expect(frame.weights.length).toBe(names.length);
      expect(frame.weights[0]).toBe(0);
    }
    const open = Math.max(...track.frames.map((frame) => frame.weights[1]));
    expect(open).toBeGreaterThan(0.5);
    expect(() => characterTrack(plan, head, names, { fps: -1 })).toThrow();
  });
});

describe('vrmVowelBinds', () => {
  it('reads the vowel expressions of VRM 1.0 and VRM 0.x files', () => {
    const vrm1 = {
      extensions: {
        VRMC_vrm: {
          expressions: {
            preset: {
              aa: { morphTargetBinds: [{ node: 3, index: 7, weight: 1 }] },
              ou: { morphTargetBinds: [{ node: 3, index: 9 }] },
              happy: { morphTargetBinds: [{ node: 3, index: 1 }] },
            },
          },
        },
      },
    };
    const binds1 = vrmVowelBinds(vrm1);
    expect(binds1.aa).toEqual([{ node: 3, index: 7, weight: 1 }]);
    expect(binds1.ou).toEqual([{ node: 3, index: 9, weight: 1 }]);
    expect(binds1.ih).toEqual([]);
    const vrm0 = {
      extensions: {
        VRM: {
          blendShapeMaster: {
            blendShapeGroups: [
              { presetName: 'a', binds: [{ mesh: 2, index: 5, weight: 100 }] },
              { presetName: 'E', binds: [{ mesh: 2, index: 8, weight: 50 }] },
              { presetName: 'joy', binds: [{ mesh: 2, index: 1 }] },
            ],
          },
        },
      },
    };
    const binds0 = vrmVowelBinds(vrm0);
    expect(binds0.aa).toEqual([{ mesh: 2, index: 5, weight: 1 }]);
    expect(binds0.ee).toEqual([{ mesh: 2, index: 8, weight: 0.5 }]);
    expect(binds0.oh).toEqual([]);
    expect(vrmVowelBinds({ asset: { version: '2.0' } })).toBe(null);
  });
});
