/**
 * Image rendering, rigid alignment and the comparison of the head model
 * with MRI vocal tracts of the Dresden Vocal Tract Dataset
 * (tests/fixtures/dvtd).
 */

import { readFileSync } from 'node:fs';
import { deflateSync, gunzipSync } from 'node:zlib';
import { describe, it, expect } from 'test-anywhere';
import {
  DVTD_TO_HEAD,
  chamferDistance,
  composeTransforms,
  densify,
  resampleCurve,
  rigidFit,
  transformMesh,
  transformPoint,
} from '../src/geometry/align.js';
import {
  DVTD_VOWELS,
  compareWithDvtd,
  modelTract,
} from '../src/geometry/anatomy-compare.js';
import {
  createRaster,
  drawMesh,
  drawText,
  encodePng,
} from '../src/geometry/render.js';
import { tractAreaFunction } from '../src/geometry/dvtd.js';
import { parseStl } from '../src/geometry/stl.js';
import { presetHeadConfig } from '../src/head-config.js';

const FIXTURES = new globalThis.URL('./fixtures/dvtd/', import.meta.url);

function fixture(name) {
  return parseStl(
    gunzipSync(
      readFileSync(new globalThis.URL(`${name}-inner-surface.stl.gz`, FIXTURES))
    )
  );
}

const distance = (a, b) => Math.hypot(...a.map((value, k) => value - b[k]));

describe('software rendering', () => {
  it('shades a triangle facing the viewer and encodes a PNG', () => {
    const raster = createRaster(20, 20);
    const mesh = {
      positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
      indices: [0, 1, 2],
    };
    drawMesh(
      raster,
      mesh,
      {
        right: [1, 0, 0],
        up: [0, 1, 0],
        center: [0, 0, 0],
        scale: 8,
      },
      [200, 0, 0],
      { light: [0, 0, 1] }
    );
    const centre = (10 * 20 + 10) * 4;
    expect(Array.from(raster.color.slice(centre, centre + 3))).toEqual([
      200, 0, 0,
    ]);
    expect(Array.from(raster.color.slice(0, 3))).toEqual([255, 255, 255]);
    const png = encodePng(raster, deflateSync);
    expect(Array.from(png.slice(0, 8))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
  });

  it('writes text', () => {
    const raster = createRaster(40, 20);
    drawText(raster, 'A1', 2, 2, [0, 0, 0], 2);
    const dark = raster.color.filter(
      (value, index) => index % 4 === 0 && value === 0
    );
    expect(dark.length).toBeGreaterThan(20);
  });
});

describe('rigid alignment', () => {
  const curve = Array.from({ length: 30 }, (_, i) => [
    Math.cos(i / 5),
    Math.sin(i / 7) * 2,
    i / 10,
  ]);

  it('recovers a rotation and translation', () => {
    const angle = 0.7;
    const truth = {
      rotation: [
        [Math.cos(angle), -Math.sin(angle), 0],
        [Math.sin(angle), Math.cos(angle), 0],
        [0, 0, 1],
      ],
      translation: [3, -2, 5],
    };
    const fit = rigidFit(
      curve,
      curve.map((point) => transformPoint(point, truth))
    );
    expect(fit.rms).toBeLessThan(1e-9);
    expect(distance(fit.translation, truth.translation)).toBeLessThan(1e-9);
  });

  it('composes transforms in order', () => {
    const second = {
      ...rigidFit(
        curve,
        curve.map(([x, y, z]) => [y, -x, z + 1])
      ),
    };
    const both = composeTransforms(DVTD_TO_HEAD, second);
    const point = [12, -30, 45];
    expect(
      distance(
        transformPoint(point, both),
        transformPoint(transformPoint(point, DVTD_TO_HEAD), second)
      )
    ).toBeLessThan(1e-9);
  });

  it('measures curve distances', () => {
    const line = densify(
      [
        [
          [0, 0, 0],
          [10, 0, 0],
        ],
      ],
      0.1
    );
    const shifted = line.map(([x, y, z]) => [x, y + 0.5, z]);
    expect(chamferDistance(line, line)).toBe(0);
    expect(Math.abs(chamferDistance(line, shifted) - 0.5)).toBeLessThan(1e-9);
    const samples = resampleCurve(
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 3, 0],
      ],
      5
    );
    expect(distance(samples[2], [1, 1, 0])).toBeLessThan(1e-9);
  });
});

describe('model against MRI', () => {
  it('finds the model tract in itself after a change of frame', () => {
    const model = modelTract(
      presetHeadConfig('male'),
      DVTD_VOWELS['ehe-schwa']
    );
    const tube = model.meshes.find((mesh) => mesh.name === 'tract');
    // Head centimetres to dataset millimetres: the rotation is its own
    // inverse.
    const inDvtd = transformMesh(tube, {
      rotation: DVTD_TO_HEAD.rotation,
      translation: [5, -40, 20],
      scale: 10,
    });
    const { metrics } = compareWithDvtd(model, inDvtd);
    expect(metrics.centrelineRms).toBeLessThan(0.15);
    expect(Math.abs(metrics.dvtdLength - metrics.modelLength)).toBeLessThan(
      0.6
    );
    expect(metrics.outlineDistance.midsagittal).toBeLessThan(0.1);
  });

  it('keeps the model within the measured anatomy', () => {
    for (const [name, preset, sound] of [
      ['s1-22-ehe-schwa', 'male', 'ehe-schwa'],
      ['s2-01-bahn-tense-a', 'female', 'bahn-tense-a'],
    ]) {
      const tract = fixture(name);
      const measured = tractAreaFunction(tract);
      // Scaled to the measured length, as scripts/compare-anatomy.mjs
      // does, so the tracts are compared by shape and not size.
      const model = modelTract(presetHeadConfig(preset), DVTD_VOWELS[sound], {
        length: measured.length / 10,
      });
      const { metrics } = compareWithDvtd(model, tract, { measured });
      // The bent MRI template brings the centrelines within 0.3 cm.
      expect(metrics.centrelineRms).toBeLessThan(0.35);
      expect(metrics.areaLogRms).toBeLessThan(1.3);
      expect(metrics.outlineDistance.midsagittal).toBeLessThan(0.5);
      expect(metrics.outlineDistance['oblique 50%']).toBeLessThan(0.45);
    }
  });
});
