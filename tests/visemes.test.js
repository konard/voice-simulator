import { describe, expect, it } from 'test-anywhere';

import { runCli } from '../bin/voice-simulator.js';
import {
  ARKIT_BLENDSHAPES,
  MAX_OPENING,
  OVR_VISEMES,
  VRM_VISEMES,
  arkitBlendshapes,
  faceRig,
  ovrVisemes,
  prepareUtterance,
  presetHeadConfig,
  sampleState,
  visemeTrack,
  vowelShapes,
  vrmExpressions,
} from '../src/index.js';
import { itUnless, sandboxed } from './helpers/skip.js';
import { withVoiceServer } from './helpers/voice-server.js';

const itNet = itUnless(sandboxed);

/** Rig in the middle of the first sound of an IPA string. */
function rigOf(ipa, head) {
  const { plan, head: resolved } = prepareUtterance(ipa, { ipa: true, head });
  const segment = plan.segments.find((entry) => entry.kind !== 'pause');
  const state = sampleState(plan, (segment.start + segment.end) / 2);
  return faceRig(state, resolved);
}

function strongest(weights) {
  return Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
}

function sum(weights) {
  return Object.values(weights).reduce((total, value) => total + value, 0);
}

describe('faceRig', () => {
  it('opens the jaw with the incisor gap the tract needs', () => {
    const open = rigOf('ɑ');
    const close = rigOf('i');
    expect(open.gap).toBeGreaterThan(1);
    expect(open.jawOpen).toBeGreaterThan(close.jawOpen + 0.1);
    expect(close.jawOpen).toBeLessThan(0.02);
    const wide = faceRig({}, undefined, {
      shape: { teeth: { gap: MAX_OPENING }, lipOpening: 20 },
    });
    expect(wide.jawOpen).toBe(1);
  });

  it('seals the lips for /m/ and puts the lower lip on the teeth for /f/', () => {
    const m = rigOf('m');
    expect(m.lipsSealed).toBeGreaterThan(0.99);
    expect(m.bilabial).toBeGreaterThan(0.8);
    expect(m.labiodental).toBeLessThan(0.05);
    const f = rigOf('f');
    expect(f.labiodental).toBeGreaterThan(0.8);
    expect(f.bilabial).toBeLessThan(0.05);
  });

  it('rounds and narrows the lips for /u/ and spreads them for /i/', () => {
    const u = rigOf('u');
    const i = rigOf('i');
    expect(u.rounding).toBe(1);
    expect(u.protrusion).toBeGreaterThan(0.5);
    expect(u.lipWidth).toBeLessThan(i.lipWidth / 3);
    expect(i.spread).toBeGreaterThan(0.9);
    expect(u.spread).toBe(0);
  });

  it('places the tongue for /θ/, /s/, /ʃ/ and /k/', () => {
    expect(strongest(rigOf('θ').tongue)).toBe('dental');
    expect(strongest(rigOf('s').tongue)).toBe('alveolar');
    expect(strongest(rigOf('ʃ').tongue)).toBe('postalveolar');
    expect(strongest(rigOf('k').tongue)).toBe('velar');
  });

  it('follows the head: a smaller mouth makes a narrower opening', () => {
    const adult = rigOf('ɑ', presetHeadConfig('male'));
    const small = rigOf('ɑ', { ...presetHeadConfig('child'), mouthWidth: 0.8 });
    expect(small.lipWidth).toBeLessThan(adult.lipWidth);
  });
});

describe('vowelShapes', () => {
  it('sums to 1 and names the five vowels', () => {
    const cases = {
      aa: { height: 0, backness: 1, rounding: 0 },
      ih: { height: 1, backness: 0, rounding: 0 },
      ou: { height: 1, backness: 1, rounding: 1 },
      ee: { height: 0.67, backness: 0, rounding: 0 },
      oh: { height: 0.67, backness: 1, rounding: 1 },
    };
    for (const [name, state] of Object.entries(cases)) {
      const shapes = vowelShapes(state);
      expect(strongest(shapes)).toBe(name);
      expect(Math.abs(sum(shapes) - 1)).toBeLessThan(1e-9);
    }
  });
});

describe('Oculus visemes', () => {
  it('picks the viseme of each sound and sums to 1', () => {
    const expected = {
      m: 'PP',
      p: 'PP',
      f: 'FF',
      v: 'FF',
      θ: 'TH',
      t: 'DD',
      k: 'kk',
      ʃ: 'CH',
      s: 'SS',
      n: 'nn',
      l: 'nn',
      ɹ: 'RR',
      ɑ: 'aa',
      e: 'E',
      i: 'ih',
      o: 'oh',
      u: 'ou',
    };
    for (const [ipa, viseme] of Object.entries(expected)) {
      const weights = ovrVisemes(rigOf(ipa));
      expect(`${ipa}:${strongest(weights)}`).toBe(`${ipa}:${viseme}`);
      expect(Math.abs(sum(weights) - 1)).toBeLessThan(1e-9);
      expect(Object.keys(weights)).toEqual([...OVR_VISEMES]);
    }
  });

  it('is silent in a pause', () => {
    const { plan, head } = prepareUtterance('ˈmama', { ipa: true });
    const weights = ovrVisemes(faceRig(sampleState(plan, 0), head));
    expect(weights.sil).toBe(1);
  });
});

describe('ARKit blendshapes', () => {
  it('writes all 52 curves within 0..1', () => {
    const weights = arkitBlendshapes(rigOf('ɑ'));
    expect(Object.keys(weights)).toEqual([...ARKIT_BLENDSHAPES]);
    expect(ARKIT_BLENDSHAPES.length).toBe(52);
    for (const value of Object.values(weights)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(weights.jawOpen).toBeGreaterThan(0.1);
    expect(weights.mouthLowerDownLeft).toBeGreaterThan(0.3);
    expect(weights.eyeBlinkLeft).toBe(0);
  });

  it('moves the lips and tongue like the articulators', () => {
    const m = arkitBlendshapes(rigOf('m'));
    expect(m.mouthClose).toBeGreaterThan(0.99 * m.jawOpen);
    // Stops press the lips together harder than nasals.
    const b = arkitBlendshapes(rigOf('b'));
    expect(b.mouthPressLeft).toBeGreaterThan(0.3);
    expect(m.mouthPressLeft).toBeLessThan(b.mouthPressLeft / 3);
    expect(arkitBlendshapes(rigOf('f')).mouthRollLower).toBeGreaterThan(0.8);
    expect(arkitBlendshapes(rigOf('θ')).tongueOut).toBeGreaterThan(0.2);
    expect(arkitBlendshapes(rigOf('s')).tongueOut).toBeLessThan(0.02);
    const u = arkitBlendshapes(rigOf('u'));
    expect(u.mouthFunnel + u.mouthPucker).toBeGreaterThan(0.9);
    const i = arkitBlendshapes(rigOf('i'));
    expect(i.mouthStretchLeft).toBeGreaterThan(0.3);
    expect(i.mouthStretchLeft).toBe(i.mouthStretchRight);
  });
});

describe('VRM expressions', () => {
  it('shows the vowel and closes for bilabials', () => {
    expect(strongest(vrmExpressions(rigOf('ɑ')))).toBe('aa');
    expect(strongest(vrmExpressions(rigOf('i')))).toBe('ih');
    expect(strongest(vrmExpressions(rigOf('u')))).toBe('ou');
    expect(strongest(vrmExpressions(rigOf('e')))).toBe('ee');
    expect(strongest(vrmExpressions(rigOf('o')))).toBe('oh');
    expect(sum(vrmExpressions(rigOf('m')))).toBeLessThan(0.01);
    expect(Object.keys(vrmExpressions(rigOf('a')))).toEqual([...VRM_VISEMES]);
  });
});

describe('visemeTrack', () => {
  it('samples the plan at the frame rate in every format', () => {
    const { plan, head } = prepareUtterance('ˈmama', { ipa: true });
    for (const format of ['arkit', 'vrm', 'oculus']) {
      const track = visemeTrack(plan, head, { format, fps: 30 });
      expect(track.format).toBe(format);
      expect(track.frames.length).toBe(Math.floor(plan.duration * 30) + 1);
      expect(track.frames[1].time).toBe(0.033333);
      expect(Object.keys(track.frames[0].weights).length).toBe(
        track.names.length
      );
    }
    const arkit = visemeTrack(plan, head);
    expect(arkit.fps).toBe(60);
    const closed = arkit.frames.filter((frame) => frame.weights.mouthClose > 0);
    expect(closed.length).toBeGreaterThan(0);
  });

  it('rejects unknown formats and frame rates', () => {
    const { plan, head } = prepareUtterance('a', { ipa: true });
    expect(() => visemeTrack(plan, head, { format: 'fbx' })).toThrow();
    expect(() => visemeTrack(plan, head, { fps: 0 })).toThrow();
  });
});

describe('visemes from the CLI and the server', () => {
  it('prints a track as JSON', async () => {
    const stdout = [];
    const code = await runCli(
      ['visemes', 'ˈmama', '--ipa', '-f', 'oculus', '--fps', '20'],
      { stdout: (line) => stdout.push(line), stderr: () => {} }
    );
    expect(code).toBe(0);
    const track = JSON.parse(stdout[0]);
    expect(track.format).toBe('oculus');
    expect(track.fps).toBe(20);
    expect(track.frames.some((frame) => frame.weights.PP > 0.5)).toBe(true);
  });

  itNet('serves a track at /api/visemes', async () => {
    await withVoiceServer({ version: '1', index: '' }, async (base) => {
      const query = new globalThis.URLSearchParams({
        text: 'ˈmama',
        ipa: 'true',
        format: 'vrm',
        fps: '25',
      });
      const track = await fetch(`${base}/api/visemes?${query}`).then((r) =>
        r.json()
      );
      expect(track.names).toEqual([...VRM_VISEMES]);
      expect(track.frames.some((frame) => frame.weights.aa > 0.5)).toBe(true);
      const bad = await fetch(`${base}/api/visemes?text=a&format=fbx`);
      expect(bad.status).toBe(400);
      const fps = await fetch(`${base}/api/visemes?text=a&fps=0`);
      expect(fps.status).toBe(400);
    });
  });
});
