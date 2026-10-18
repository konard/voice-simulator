/**
 * Talking character panel of the example app: the demo face names its
 * morph targets after ARKit blendshapes, so the rig bridge drives it the
 * same way as a MetaHuman or Ready Player Me model.
 */

import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import {
  ARKIT_BLENDSHAPES,
  bindRig,
  faceRig,
  prepareUtterance,
  presetHeadConfig,
  rigFrame,
  sampleState,
} from '../src/index.js';

const root = 'examples/universal-app/src';

function readText(path) {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

/** Morph target names the demo face declares. */
function demoMorphNames() {
  const source = readText(`${root}/viewer/demo-face.js`);
  const names = source.match(/'(?:jaw|mouth|tongue)[A-Za-z]*'/gu) ?? [];
  return [...new Set(names.map((name) => name.slice(1, -1)))];
}

describe('example app talking character', () => {
  it('names every demo face morph target after an ARKit blendshape', () => {
    const names = demoMorphNames();
    expect(names.length).toBeGreaterThanOrEqual(17);
    for (const name of names) {
      expect(ARKIT_BLENDSHAPES).toContain(name);
    }
    const binding = bindRig(names);
    expect(binding.format).toBe('arkit');
    expect(binding.targets.length).toBe(names.length);
  });

  it('opens, rounds and seals the demo mouth from the articulation', () => {
    const binding = bindRig(demoMorphNames());
    const head = presetHeadConfig('male');
    const pose = (ipa) => {
      const { plan } = prepareUtterance(ipa, { ipa: true, head });
      const segment = plan.segments.find((entry) => entry.kind !== 'pause');
      const state = sampleState(plan, (segment.start + segment.end) / 2);
      return rigFrame(binding, faceRig(state, head));
    };
    expect(pose('ɑ').jawOpen).toBeGreaterThan(pose('i').jawOpen);
    expect(pose('u').mouthPucker).toBeGreaterThan(pose('ɑ').mouthPucker);
    expect(pose('m').mouthClose).toBeGreaterThan(0);
    expect(pose('f').mouthRollLower).toBeGreaterThan(0);
  });

  it('wires the panel to the running simulation', () => {
    const app = readText(`${root}/App.js`);
    const panel = readText(`${root}/components/CharacterPanel.js`);
    const viewer = readText(`${root}/viewer/character-viewer.js`);
    const simulator = readText(`${root}/engine/use-simulator.js`);

    expect(app).toContain('h(CharacterPanel');
    expect(panel).toContain('simulator.frameRef.current');
    expect(simulator).toContain('frameRef.current = frame');
    expect(viewer).toContain('bindRig(names)');
    expect(viewer).toContain('vrmVowelBinds(gltf.parser.json)');
    expect(viewer).toContain('.vrm');
  });
});
